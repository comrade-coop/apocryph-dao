const chalk = require('chalk')
const readline = require('readline')

// Logging

let logIndent = 0
function writeLog (text) {
  process.stderr.write('    '.repeat(logIndent) + text + '\n')
}

const log = {
  indent (callback) {
    logIndent++
    return Promise.resolve(callback()).finally(function () {
      logIndent--
    })
  },

  debug (message) { writeLog(chalk.gray(`DEBUG: ${message}`)) },
  trace (message) { writeLog(chalk.gray(`TRACE: ${chalk.gray(message)}`)) },
  info (message) { writeLog(`INFO: ${message}`) },
  warning (message) { writeLog(chalk.bold.yellow(`WARN: ${message}`)) },
  error (message) {
    if (message instanceof Error) {
      message = message.message === 'Cancelled' ? message.message : message.stack
    }
    writeLog(chalk.bold.red(`ERROR: ${message}`))
  },

  option (key, message) { writeLog(`${key}) ${message}`) },
  result (message) { writeLog(`<- ${message}`) },
  line () { process.stderr.write('\n') }
}

// Input

let readlineInterface, readlineInterfaceIterator, readlineInterfaceIteratorPromise

function readSingleLine (prompt) {
  if (readlineInterface === undefined) {
    readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    })
    readlineInterfaceIterator = readlineInterface[Symbol.asyncIterator]()
    readlineInterfaceIteratorPromise = readlineInterfaceIterator.next()
  }

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

// General utilities

const nilAddress = '0x' + '00'.repeat(20)
const oneAddress = '0x' + '00'.repeat(19) + '01'

const secondsPerBlock =
  network.name === 'localhost' || network.name === 'hardhat'
    ? 130
    : network.name.startsWith('polygon')
      ? 2
      : 13

const timeUnits = {
  '': 1,
  blocks: 1,
  seconds: 1 / secondsPerBlock,
  minutes: 60 / secondsPerBlock,
  hours: 60 * 60 / secondsPerBlock,
  days: 24 * 60 * 60 / secondsPerBlock,
  months: 356 / 12 * 24 * 60 * 60 / secondsPerBlock,
  years: 356 * 24 * 60 * 60 / secondsPerBlock
}

function convertTimeToBlocks (time) {
  const [, number, unit] = /^(\d+\.?|\d*\.\d+) ?(\w*)$/.exec(time)
  const scale = timeUnits[unit] || timeUnits[unit + 's']
  return Math.round(parseFloat(number) * scale)
}

function parseFraction (fraction) {
  if (Array.isArray(fraction)) return fraction

  const [, numerator, denomerator, percentSign] = /^(\d+)\s*(?:\/\s*(\d+)|(%)|)$/.exec(fraction)
  if (percentSign) {
    return [numerator, '100']
  }
  return [numerator, denomerator]
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

function formatWei (weiAmount) {
  const paddedWei = weiAmount.toString().padStart(19, '0').padStart(19 + 5)

  return `${paddedWei.slice(0, -18)}.${paddedWei.slice(-18)} ETH`
}

function formatGasUsed (oldGasUsed, newGasUsed) {
  const gasUsed = newGasUsed[0].sub(oldGasUsed[0])
  const weiUsed = newGasUsed[1].sub(oldGasUsed[1])

  return `${gasUsed.toString().padStart(7)} = ${formatWei(weiUsed)}`
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

module.exports = {
  log,
  readSingleLine,
  ask,
  askMenu,

  nilAddress,
  oneAddress,
  convertTimeToBlocks,
  parseFraction,
  createGasTrackingSigner,
  formatWei,
  formatGasUsed,
  prettyValues,
  prettyAddress
}
