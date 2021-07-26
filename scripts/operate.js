const chalk = require('chalk')
const readline = require('readline')
const fs = require('fs').promises
const path = require('path')

const log = {
  _indent: 0,

  _write (text) { process.stdout.write('    '.repeat(log._indent) + text + '\n') },

  indent (callback) {
    log._indent++
    return Promise.resolve(callback()).finally(function () {
      log._indent--
    })
  },

  debug (message) { log._write(chalk.gray(`DEBUG: ${message}`)) },
  trace (message) { log._write(chalk.gray(`TRACE: ${chalk.gray(message)}`)) },
  info (message) { log._write(`INFO: ${message}`) },
  warning (message) { log._write(chalk.bold.yellow(`WARN: ${message}`)) },
  error (message) {
    if (message instanceof Error) {
      message = message.message === 'Cancelled' ? message.message : message.stack
    }
    log._write(chalk.bold.red(`ERROR: ${message}`))
  },

  option (key, message) { log._write(`${key}) ${message}`) },
  result (message) { log._write(`<- ${message}`) },
  line () { log._write('') }
}

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ''
})
const readlineInterfaceIterator = readlineInterface[Symbol.asyncIterator]()
let readlineInterfaceIteratorPromise = readlineInterfaceIterator.next()
function readSingleLine (prompt) {
  readlineInterface.setPrompt(`${'    '.repeat(log._indent)}=> ${prompt}`)
  readlineInterface.prompt()

  let sigintPromiseReject
  const sigintListener = function () {
    sigintPromiseReject(new Error('Cancelled'))
  }
  readlineInterface.on('SIGINT', sigintListener)

  return Promise.race([
    readlineInterfaceIteratorPromise.then(function (result) {
      if (result.done) {
        throw new Error('Stream ended')
      } else {
        return result.value
      }
    }),
    new Promise(function (resolve, reject) { sigintPromiseReject = reject })
  ]).then(function (result) {
    readlineInterfaceIteratorPromise = readlineInterfaceIterator.next()
    return result
  }).finally(function () {
    readlineInterface.off('SIGINT', sigintListener)
  })
}

// Utilities

async function ask (question, defaultValue, validator) {
  while (true) {
    let answer
    try {
      answer = await readSingleLine(`${question}? ${defaultValue ? `[${defaultValue}] ` : ''}`)
    } catch (e) {
      if (e.message === 'Stream ended') {
        return defaultValue
      }
      throw e
    }

    if (validator && (answer || !defaultValue)) {
      try {
        answer = await validator(answer)
      } catch (e) {
        log.error(e.message)
        continue
      }
    }
    return answer || defaultValue
  }
}

async function askMenu (question, options, display, extra = [], extraHandler, defaultValue) {
  for (let i = 0; i < options.length; i++) {
    log.option(i + 1, `${display ? display(options[i], i) : options[i]}`)
  }
  const resultHandler = async answer => {
    let result

    if (result === undefined && Number.isFinite(answer - 1)) {
      result = options[answer - 1]
    }
    if (result === undefined && extraHandler) {
      result = await extraHandler(answer)
    }

    if (result === undefined) {
      throw new Error(`Unrecognized option '${answer}'`)
    }
    return result
  }
  const answer = await ask(`${question} (${[`1-${options.length}`].concat(extra).join(', ')})`, defaultValue, async answer => {
    await resultHandler(answer)
    return answer
  })
  return resultHandler(answer)
}

async function getInterface (abiName) {
  return new ethers.utils.Interface((await hre.artifacts.readArtifact(abiName)).abi)
}

const interfaces = {
  TokenAgeToken: getInterface('TokenAgeToken'),
  Vesting: getInterface('Vesting'),
  Voting: getInterface('DeadlineVoting'),
  Group: getInterface('Group'),
  BondingCurve: getInterface('BondingCurve'),
  Allocations: getInterface('Allocations'),
  Fixed: undefined,
  FixedERC20: getInterface('IERC20')
}

function createGasTrackingSigner (signer) {
  const resultSigner = Object.create(signer)
  resultSigner.sendTransaction = async function () {
    const transaction = await signer.sendTransaction.apply(this, arguments)
    transaction.wait().then((transactionReceipt) => {
      this.gasUsed = [
        this.gasUsed[0].add(transactionReceipt.gasUsed),
        this.gasUsed[1].add(transactionReceipt.gasUsed.mul(transaction.gasPrice))
      ]
    })
    return transaction
  }
  resultSigner.gasUsed = [ethers.BigNumber.from(0), ethers.BigNumber.from(0)]
  return resultSigner
}

function formatGasUsed (oldGasUsed, newGasUsed) {
  const gasUsed = newGasUsed[0].sub(oldGasUsed[0])
  const weiUsed = newGasUsed[1].sub(oldGasUsed[1])
  const paddedWei = weiUsed.toString().padStart(19, '0')

  return `${gasUsed.toString().padStart(7)} = ${paddedWei.slice(0, -18)}.${paddedWei.slice(-18)} ETH`
}

async function selectContract (deployment, requireAbi) {
  let options = Object.entries(deployment.contracts)
  if (requireAbi) options = options.filter(x => interfaces[x[1].type] !== undefined)

  const result = await askMenu(
    'Choose a contract',
    options,
    entry => `${entry[0]} = ${entry[1].name} (${entry[1].type}) at ${entry[1].address}`,
    ['key'], (answer) => deployment.contracts[answer] ? [answer, deployment.contracts[answer]] : undefined
  )
  return result[1]
}

async function selectFragment (contractInterface) {
  const result = await askMenu(
    'Choose an operation',
    Object.values(contractInterface.fragments).filter(x => x.type !== 'constructor').sort((a, b) => (b.type === 'event') - (a.type === 'event') || b.constant - a.constant),
    frag => `${frag.type === 'event' ? 'event' : frag.constant ? 'view' : 'function'} ${frag.name}(${frag.inputs.map(x => `${x.type}${x.indexed ? ' indexed' : ''}${x.name ? ` ${x.name}` : ''}`).join(', ')})${frag.outputs ? ` returns (${frag.outputs.map(x => x.format(ethers.utils.FormatTypes.minimal)).join(', ')})` : ''}${frag.anonymous ? ' anonymous' : ''}`,
    ['name'], (answer) => contractInterface.getFunction(answer)
  )
  log.result(result.format(ethers.utils.FormatTypes.full))
  return result
}

async function selectSigner (fragment) {
  if (fragment.type === 'function') {
    const signers = await ethers.getSigners()
    const answer = await ask(`Choose a sender (me 1-${signers.length}, address)`, 'me', async answer => {
      const match = answer.match(/^me ?(\d*)$|^(\d+)$/)
      if (match) return match[1]

      const index = signers.map(x => x.address.toLowerCase()).indexOf(answer.toLowerCase())
      if (index >= 0) return index + 1

      throw new Error('Expected the id of a signer')
    })
    const match = answer.match(/(\d*)/)
    const signer = signers[((match && match[1]) || 1) - 1]
    log.result(signer.address)
    return signer
  } else if (fragment.type === 'event') {
    return (await ethers.getSigners())[0]
  }
}

async function selectInputs (fragment, deployment) {
  const values = []

  for (const input of fragment.inputs) {
    if (fragment.type === 'event' && !input.indexed) {
      values.push(undefined)
      continue
    }

    const value = await readInput(input, deployment, fragment.type === 'event')

    values.push(value)
  }

  if (fragment.type === 'event') {
    values.fromBlock = await ask('From block', 'deployment', async answer => ethers.BigNumber.from(answer))
    if (values.fromBlock === 'deployment') {
      values.fromBlock = deployment.startBlock
    }
    values.toBlock = await ask('To block', 'latest', async answer => ethers.BigNumber.from(answer))
  }

  if (fragment.stateMutability === 'payable') { // NOTE: untested
    values.value = await ask('Transaction value', undefined, async answer => ethers.BigNumber.from(answer))
  }

  return values
}

async function readInput (input, deployment, allowAny = false, baseName = '') {
  const askDefaultValue = allowAny ? '(any)' : undefined

  const name = input.name === null ? baseName : baseName ? `${baseName}.${input.name}` : input.name

  let value

  if (input.type === 'address') {
    value = await ask(`'${name}' (${input.type}) (deployment | me 1-20)`, askDefaultValue, async answer => {
      if (answer === 'deployment') return answer
      if (deployment.contracts[answer]) return deployment.contracts[answer].address

      const match = answer.match(/^me ?(\d*)$/)
      if (match) return (await ethers.getSigners())[(match[1] || 1) - 1].address

      return ethers.utils.getAddress(answer)
    })

    if (value === 'deployment') {
      value = (await log.indent(() => selectContract(deployment))).address
    }
  } else if (input.baseType === 'array') {
    // TODO: implement (any) for arrays
    value = []
    try {
      for (let i = 0; i < input.arrayLength || input.arrayLength === -1; i++) {
        value.push(await readInput(input.arrayChildren, deployment, false, `${name}[${i}]`))
      }
    } catch (e) {
      if (e.message !== 'Cancelled') throw e
    }
  } else if (input.baseType === 'tuple') {
    // TODO: implement (any) for tuples
    value = []
    for (const component of input.components) {
      value.push(await readInput(component, deployment, false, name))
    }
  } else if (input.baseType === 'bytes') {
    value = await ask(`'${name}' (${input.type} | transaction)`, askDefaultValue, async answer => {
      if (answer === 'transaction') return answer
      return ethers.BigNumber.from(answer)
    })

    if (value === 'transaction') {
      const contract = await selectContract(deployment, true)
      const contractInterface = await interfaces[contract.type]
      const fragment = await selectFragment(contractInterface)
      const inputs = await selectInputs(fragment, deployment)

      value = contractInterface.encodeFunctionData(fragment, inputs)
    }
  } else if (input.baseType === 'bytes32') {
    value = await ask(`'${name}' (${input.type} | hash | keccak256)`, askDefaultValue, async answer => {
      if (answer === 'hash' || answer === 'keccak256') return 'keccak256'
      return ethers.BigNumber.from(answer)
    })

    if (value === 'keccak256') {
      let inputType = await ask(`'${name}#hash' type`, 'bytes', async answer => ethers.utils.ParamType.from(answer))
      if (inputType === 'bytes') inputType = ethers.utils.ParamType.from(inputType)

      const valueToEncode = await readInput(inputType, deployment, false, `${name}#hash`)
      const valueToHash = ethers.utils.defaultAbiCoder.encode([inputType], [valueToEncode])
      value = ethers.utils.keccak256(valueToHash)
      log.result(`hash${prettyValues([valueToEncode], [inputType], deployment)} = ${value}`)
    }
  } else if (input.type.match(/^u?int\d+$|^u?bytes\d+$/)) {
    value = await ask(`'${name}' (${input.type})`, askDefaultValue, async answer => ethers.BigNumber.from(answer))
  } else {
    log.warning(`Type ${input.type} unimplemented`)
    value = JSON.parse(await ask(`'${name}' (${input.type}) as JSON`, askDefaultValue))
  }

  if (allowAny && value === askDefaultValue) {
    value = undefined
  }

  return value
}

async function executeTransaction (contract, signer, fragment, inputs, deployment) {
  const contractInterface = await interfaces[contract.type]

  if (fragment.type === 'function') {
    const transaction = {
      to: contract.address,
      data: contractInterface.encodeFunctionData(fragment, inputs),
      value: inputs.value
    }

    if (fragment.constant) {
      const result = await signer.call(transaction)
      const results = contractInterface.decodeFunctionResult(fragment, result)
      log.result(`Calling ${fragment.name}${prettyValues(inputs, fragment.inputs, deployment)}`)
      log.result(`    on   ${prettyAddress(contract.address, deployment)}`)
      log.result(`    from ${prettyAddress(signer.address, deployment)}`)
      log.result(`Result: ${prettyValues(results.slice(), fragment.outputs, deployment)}`)
    } else {
      log.result(`Executing ${fragment.name}${prettyValues(inputs, fragment.inputs, deployment)}`)
      log.result(`    on   ${prettyAddress(contract.address, deployment)}`)
      log.result(`    from ${prettyAddress(signer.address, deployment)}`)

      if (!(await ask('Continue with execution', 'y')).match(/^\s*y(es)?\s*$/i)) throw new Error('Cancelled')

      signer = createGasTrackingSigner(signer)
      const startGas = signer.gasUsed

      const tx = await signer.sendTransaction(transaction)
      const receipt = await tx.wait()

      log.result(`Transaction: ${receipt.transactionHash} in block #${receipt.blockNumber} (gas: ${formatGasUsed(startGas, signer.gasUsed)})`)

      await logEvents(receipt.logs, deployment, contract.address)
    }
  } else if (fragment.type === 'event') {
    const filterInputs = inputs.filter((x, i) => fragment.inputs[i].indexed).map(x => x === undefined ? null : x)
    const filter = {
      address: contract.address,
      topics: contractInterface.encodeFilterTopics(fragment, filterInputs),
      fromBlock: inputs.fromBlock,
      toBlock: inputs.toBlock
    }

    log.result(`Querying ${fragment.name}${prettyValues(inputs, fragment.inputs, deployment)}, blocks ${inputs.fromBlock}...${inputs.toBlock}`)

    await logEvents(await signer.provider.getLogs(filter), deployment, contract.address)
  }
}

async function logEvents (logDatas, deployment, thisAddress) {
  for (const logData of logDatas) {
    const logAddress = logData.address === thisAddress ? '' : ` from ${prettyAddress(logData.address, deployment)}`
    if (deployment.addresses[logData.address]) {
      const eventContractInterface = await interfaces[deployment.contracts[deployment.addresses[logData.address]].type]
      if (eventContractInterface) {
        const eventData = eventContractInterface.parseLog(logData)
        if (eventData) {
          log.result(`event ${eventData.name}${prettyValues(eventData.args.slice(), eventData.eventFragment.inputs, deployment)}${logAddress}`)
          continue
        }
      }
    }

    log.result(`unknown event [${logData.topics.join(', ')}] (${logData.data})${logAddress}`)
  }
}

function prettyValues (values, paramFragments, deployment) {
  if (values.length !== paramFragments.length) log.error('Array length mismatch')

  const transformed = new Array(paramFragments.length)
  for (let i = 0; i < paramFragments.length; i++) {
    if (values[i] === undefined) {
      transformed[i] = '*'
    } else if (paramFragments[i].type === 'address') {
      transformed[i] = prettyAddress(values[i], deployment)
    } else {
      transformed[i] = typeof values[i] === 'object' && !(values[i] instanceof ethers.BigNumber) ? JSON.stringify(values[i]) : values[i]
    }
    if (paramFragments[i].name) {
      transformed[i] = `${paramFragments[i].name} = ${transformed[i]}`
    }
  }
  return `${values.value ? `{value: ${values.value}}` : ''}(${transformed.join(', ')})`
}

function prettyAddress (address, deployment) {
  if (deployment.addresses[address]) {
    return `[${deployment.addresses[address]}] ${address}`
  }
  return address
}

async function readDeployment (deploymentFile) {
  if (!deploymentFile) {
    const deploymentsDir = 'deployment'
    const files = (await fs.readdir(deploymentsDir))
      .sort((a, b) => (b.match(/-(\d+).json/) || [undefined, 0])[1] - (a.match(/-(\d+).json/) || [undefined, 0])[1])
      .map(x => path.join(deploymentsDir, x))
    deploymentFile = await askMenu('Deployment file to use', files, option => option, 'path', answer => answer, '1')
  }

  const deployment = JSON.parse(await fs.readFile(deploymentFile, 'utf8'))

  if (deployment.network !== network.name) log.warning(`${deploymentFile} was deployed on ${deployment.network}, but we are operating on ${network.name}!`)

  return deployment
}

function enrichDeployment (deployment) {
  deployment.addresses = {}
  for (const key in deployment.contracts) {
    deployment.addresses[deployment.contracts[key].address] = key
  }
}

async function main () {
  try {
    const deployment = await readDeployment()
    enrichDeployment(deployment)
    while (true) {
      log.line()
      const contract = await selectContract(deployment, true)
      try {
        await log.indent(async () => {
          while (true) {
            const fragment = await selectFragment(await interfaces[contract.type])
            try {
              let signer, inputs
              await log.indent(async () => {
                signer = await selectSigner(fragment)
                inputs = await selectInputs(fragment, deployment)
              })
              await executeTransaction(contract, signer, fragment, inputs, deployment)
            } catch (e) {
              log.error(e)
            }
            log.line()
          }
        })
      } catch (e) {
        log.error(e)
      }
    }
  } catch (e) {
    log.error(e)
    process.exit(0)
  }
}

main()
