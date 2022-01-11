const fs = require('fs').promises
const path = require('path')
const utils = require('./_utils')
const log = utils.log

async function getInterface (abiName) {
  return new ethers.utils.Interface((await hre.artifacts.readArtifact(abiName)).abi)
}

const interfaces = {
  TokenAgeToken: getInterface('TokenAgeToken'),
  Vesting: getInterface('Vesting'),
  Voting: getInterface('DeadlineQuorumVoting'),
  Group: getInterface('Group'),
  BondingCurve: getInterface('BondingCurve'),
  Allocations: getInterface('Allocations'),
  Fixed: undefined,
  FixedERC20: getInterface('IERC20')
}

async function selectContract (deployment, requireAbi) {
  let options = Object.entries(deployment.contracts)
  if (requireAbi) options = options.filter(x => interfaces[x[1].type] !== undefined)

  const result = await utils.askMenu(
    'Choose a contract',
    options,
    entry => `${entry[0]} = ${entry[1].name} (${entry[1].type}) at ${entry[1].address}`,
    ['key'], (answer) => deployment.contracts[answer] ? [answer, deployment.contracts[answer]] : undefined
  )
  return result[1]
}

async function selectFragment (contractInterface) {
  const result = await utils.askMenu(
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
    const answer = await utils.ask(`Choose a sender (me 1-${signers.length}, address)`, 'me', async answer => {
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
    values.fromBlock = await utils.ask('From block', 'deployment', async answer => ethers.BigNumber.from(answer))
    if (values.fromBlock === 'deployment') {
      values.fromBlock = deployment.startBlock
    }
    values.toBlock = await utils.ask('To block', 'latest', async answer => ethers.BigNumber.from(answer))
  }

  if (fragment.stateMutability === 'payable') { // NOTE: untested
    values.value = await utils.ask('Transaction value', undefined, async answer => ethers.BigNumber.from(answer))
  }

  return values
}

async function readInput (input, deployment, allowAny = false, baseName = '') {
  const askDefaultValue = allowAny ? '(any)' : undefined

  const name = input.name === null ? baseName : baseName ? `${baseName}.${input.name}` : input.name

  let value

  if (input.type === 'address') {
    value = await utils.ask(`'${name}' (${input.type}) (deployment | me 1-20)`, askDefaultValue, async answer => {
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
    value = await utils.ask(`'${name}' (${input.type} | transaction)`, askDefaultValue, async answer => {
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
    value = await utils.ask(`'${name}' (${input.type} | hash | keccak256)`, askDefaultValue, async answer => {
      if (answer === 'hash' || answer === 'keccak256') return 'keccak256'
      return ethers.BigNumber.from(answer)
    })

    if (value === 'keccak256') {
      let inputType = await utils.ask(`'${name}#hash' type`, 'bytes', async answer => ethers.utils.ParamType.from(answer))
      if (inputType === 'bytes') inputType = ethers.utils.ParamType.from(inputType)

      const valueToEncode = await readInput(inputType, deployment, false, `${name}#hash`)
      const valueToHash = ethers.utils.defaultAbiCoder.encode([inputType], [valueToEncode])
      value = ethers.utils.keccak256(valueToHash)
      log.result(`hash${utils.prettyValues([valueToEncode], [inputType], deployment)} = ${value}`)
    }
  } else if (input.type.match(/^u?int\d+$|^u?bytes\d+$/)) {
    value = await utils.ask(`'${name}' (${input.type})`, askDefaultValue, async answer => ethers.BigNumber.from(answer))
  } else {
    log.warning(`Type ${input.type} unimplemented`)
    value = JSON.parse(await utils.ask(`'${name}' (${input.type}) as JSON`, askDefaultValue))
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
      log.result(`Calling ${fragment.name}${utils.prettyValues(inputs, fragment.inputs, deployment)}`)
      log.result(`    on   ${utils.prettyAddress(contract.address, deployment)}`)
      log.result(`    from ${utils.prettyAddress(signer.address, deployment)}`)
      log.result(`Result: ${utils.prettyValues(results.slice(), fragment.outputs, deployment)}`)
    } else {
      log.result(`Executing ${fragment.name}${utils.prettyValues(inputs, fragment.inputs, deployment)}`)
      log.result(`    on   ${utils.prettyAddress(contract.address, deployment)}`)
      log.result(`    from ${utils.prettyAddress(signer.address, deployment)}`)

      if (!(await utils.ask('Continue with execution', 'y')).match(/^\s*y(es)?\s*$/i)) throw new Error('Cancelled')

      signer = utils.createGasTrackingSigner(signer)
      const startGas = signer.gasUsed

      const tx = await signer.sendTransaction(transaction)
      const receipt = await tx.wait()

      log.result(`Transaction: ${receipt.transactionHash} in block #${receipt.blockNumber} (gas: ${utils.formatGasUsed(startGas, signer.gasUsed)})`)

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

    log.result(`Querying ${fragment.name}${utils.prettyValues(inputs, fragment.inputs, deployment)}, blocks ${inputs.fromBlock}...${inputs.toBlock}`)

    await logEvents(await signer.provider.getLogs(filter), deployment, contract.address)
  }
}

async function logEvents (logDatas, deployment, thisAddress) {
  for (const logData of logDatas) {
    const logAddress = logData.address === thisAddress ? '' : ` from ${utils.prettyAddress(logData.address, deployment)}`
    if (deployment.addresses[logData.address]) {
      const eventContractInterface = await interfaces[deployment.contracts[deployment.addresses[logData.address]].type]
      if (eventContractInterface) {
        const eventData = eventContractInterface.parseLog(logData)
        if (eventData) {
          log.result(`event ${eventData.name}${utils.prettyValues(eventData.args.slice(), eventData.eventFragment.inputs, deployment)}${logAddress}`)
          continue
        }
      }
    }

    log.result(`unknown event [${logData.topics.join(', ')}] (${logData.data})${logAddress}`)
  }
}
async function readDeployment (deploymentFile) {
  if (!deploymentFile) {
    const deploymentsDir = 'deployment'
    const files = (await fs.readdir(deploymentsDir))
      .sort((a, b) => (b.match(/-(\d+).json/) || [undefined, 0])[1] - (a.match(/-(\d+).json/) || [undefined, 0])[1])
      .map(x => path.join(deploymentsDir, x))
    deploymentFile = await utils.askMenu('Deployment file to use', files, option => option, 'path', answer => answer, '1')
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

module.exports = {
  interfaces,
  selectContract,
  selectFragment,
  selectSigner,
  selectInputs,
  readInput,
  executeTransaction,
  logEvents
}

if (require.main === module) {
  main()
}
