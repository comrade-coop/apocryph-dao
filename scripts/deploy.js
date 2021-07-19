const chalk = require('chalk')
const readline = require('readline')
const fs = require('fs').promises

const log = {
  debug (message) { process.stderr.write(chalk.gray(`DEBUG: ${message}`) + '\n') },
  trace (message) { process.stderr.write(chalk.gray(`TRACE: ${chalk.gray(message)}`) + '\n') },
  info (message) { process.stderr.write(`INFO: ${message}` + '\n') },
  warning (message) { process.stderr.write(chalk.bold.yellow(`WARN: ${message}`) + '\n') },
  error (message) { process.stderr.write(chalk.bold.red(`ERROR: ${message}`) + '\n') }
}

// Utilities

const nilAddress = '0x' + '00'.repeat(20)
const oneAddress = '0x' + '00'.repeat(19) + '01'

const secondsPerBlock = 13
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
  const [, number, unit] = /(\d+\.?|\d*\.\d+) ?(\w*)/.exec(time)
  const scale = timeUnits[unit] || timeUnits[unit + 's']
  return Math.round(parseFloat(number) * scale)
}

function formatWeiToEth (wei) {
  const padded = wei.toString().padStart(19, '0')
  return `${padded.slice(0, -18)}.${padded.slice(-18)} ETH`
}

function ask (question, defaultValue, validator) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr
    })

    let resolved = false
    function _resolve (result) {
      resolved = true
      rl.close()
      resolve(result)
    }
    rl.on('close', function () {
      if (!resolved) {
        process.stderr.write(defaultValue + '\n')
        resolve(defaultValue)
      }
    })

    function callback (answer) {
      if (validator && answer) {
        Promise.resolve(validator(answer))
          .then(_resolve)
          .catch(function (e) {
            log.error(e.message)
            rl.question(`=> ${question}? ${defaultValue ? `[${defaultValue}] ` : ''}`, callback)
          })
      } else {
        _resolve(answer || defaultValue)
      }
    }

    rl.question(`=> ${question}? ${defaultValue ? `[${defaultValue}] ` : ''}`, callback)
  })
}

// Deployment helpers

function processRelations (relations, resolve) {
  let totalAmount = 0
  const initialParties = []
  const initialAmounts = []
  let postDeployAmount = 0
  const postDeployRelations = []

  for (const [party, amount, data] of relations) {
    const resolvedParty = resolve(party)
    if (resolvedParty.address && data === undefined) {
      initialParties.push(resolvedParty.address)
      initialAmounts.push(amount)
    } else {
      postDeployAmount += amount
      postDeployRelations.push([party, amount, data])
    }
    totalAmount += amount
  }

  return {
    totalAmount,
    initialParties,
    initialAmounts,
    postDeployAmount,
    postDeployRelations,
    postDeployHelper (handler) {
      const promises = []
      for (const [party, amount, data] of postDeployRelations) {
        const resolvedParty = resolve(party)
        promises.push(handler(resolvedParty, amount, data))
      }
      return Promise.all(promises)
    }
  }
}

const deployFunctions = {
  // [type]: (config, signer: Signer, resolve: String => {address, config, ..}) => Promise<{address: String, ..} }>
  TokenAgeToken: async function ({
    tokenName = 'Apocryph',
    tokenSymbol = 'CRYPH',
    decimals = 10,
    tokenHolders = [], // [?address, amount]
    totalSupply = undefined
  }, signer, resolve) {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken', signer)

    let { initialParties, initialAmounts, postDeployAmount, postDeployHelper, totalAmount } = processRelations(tokenHolders, resolve, totalSupply)

    if (totalSupply !== undefined && totalSupply !== totalAmount) {
      postDeployAmount += totalSupply - totalAmount
      if (totalSupply > totalAmount) {
        log.warning(`Fixed supply of ${totalSupply} ${tokenSymbol} is ${totalSupply - totalAmount} ${tokenSymbol} more than total assignment of ${totalSupply} ${tokenSymbol}; reassigning the rest to signer`)
      } else {
        throw new Error(`Total assignment of ${totalAmount} ${tokenSymbol} is ${totalAmount - totalSupply} ${tokenSymbol} less than fixed supply of ${totalSupply} ${tokenSymbol}`)
      }
    }

    if (postDeployAmount > 0) {
      initialParties.push(signer.address)
      initialAmounts.push(postDeployAmount)
    }

    const tokenContract = await TokenAgeToken.deploy(tokenName, tokenSymbol, decimals, initialParties, initialAmounts)

    return {
      address: tokenContract.address,
      deployed: tokenContract.deployTransaction.wait(),
      async postDeploy () {
        await postDeployHelper((resolvedOwner, amount, data) =>
          resolvedOwner.handleTransfer
            ? resolvedOwner.handleTransfer(tokenContract, amount, data)
            : tokenContract.transfer(resolvedOwner.address, amount)
        )

        const leftoverBalance = await tokenContract.balanceOf(signer.address)
        if (!leftoverBalance.isZero()) {
          log.warning(`Leftover ${leftoverBalance} ${tokenSymbol} on the signer address`)
        }
      }
    }
  },

  Vesting: async function ({
    token, nftName = undefined, nftSymbol = undefined
  }, signer, resolve) {
    const Vesting = await ethers.getContractFactory('Vesting', signer)

    const resolvedToken = resolve(token)
    nftName = nftName || 'Vested ' + (resolvedToken.config.tokenName || 'Apocryph')
    nftSymbol = nftSymbol || 'V' + (resolvedToken.config.tokenSymbol || 'CRYPH')

    const vestingContract = await Vesting.deploy(resolvedToken.address, nftName, nftSymbol)

    const currentBlock = (await ethers.provider.getBlock()).number

    return {
      address: vestingContract.address,
      deployed: vestingContract.deployTransaction.wait(),
      async handleTransfer (tokenContract, amount, [target, delayBlocks = '6 months', periodCount = 6, periodBlocks = '6 months']) {
        const startBlock = currentBlock + convertTimeToBlocks(delayBlocks)
        const resolvedTarget = resolve(target)
        const data = ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint128', 'uint64', 'uint64'],
          [resolvedTarget.address, startBlock, periodCount, convertTimeToBlocks(periodBlocks)])
        await tokenContract['transferAndCall(address,uint256,bytes)'](vestingContract.address, amount, data)
      }
    }
  },

  Voting: async function ({
    weights,
    owner = '(self)',
    proposer = '(any)',
    enacter = '(any)',
    deadline = '3 days'
  }, signer, resolve) {
    const DeadlineVoting = await ethers.getContractFactory('DeadlineVoting', signer)

    console.log(weights, owner, proposer, enacter)
    const resolvedWeights = resolve(weights).address
    const resolvedOwner = owner == '(self)' ? nilAddress : resolve(owner).address
    const resolvedProposer = proposer == '(any)' ? nilAddress : proposer == '(members)' ? oneAddress : resolve(proposer).address
    const resolvedEnacter = proposer == '(any)' ? nilAddress : proposer == '(members)' ? oneAddress : resolve(enacter).address

    const votingContract = await DeadlineVoting.deploy(resolvedOwner, resolvedProposer, resolvedEnacter, resolvedWeights, convertTimeToBlocks(deadline))

    return {
      address: votingContract.address,
      deployed: votingContract.deployTransaction.wait()
    }
  },

  Group: async function ({
    owner,
    members = []
  }, signer, resolve) {
    const Group = await ethers.getContractFactory('Group', signer)

    const { initialParties, initialAmounts, postDeployRelations, postDeployHelper } = processRelations(members, resolve)
    const groupOwnerAddress = postDeployRelations.length ? signer.address : (resolve(owner).address || signer.address)

    const groupContract = await Group.deploy(initialParties, initialAmounts, groupOwnerAddress)

    return {
      address: groupContract.address,
      deployed: groupContract.deployTransaction.wait(),
      async postDeploy () {
        await postDeployHelper((resolvedMember, weight) => groupContract.setWeightOf(resolvedMember.address, weight))
        if (groupOwnerAddress === signer.address) {
          const resolvedOwner = resolve(owner)
          await groupContract.setOwner(resolvedOwner.address)
        }
      }
    }
  },

  BondingCurve: async function (config, signer, resolve) {
    const {
      tokenA,
      tokenB,
      beneficiary,
      price = [3, 100, 1],
      tax = [1, 100],
      threshold = 0.01,
      thresholdDeadline = '3 days'
    } = config

    const BondingCurve = await ethers.getContractFactory('BondingCurve', signer)

    const resolvedTokenA = resolve(tokenA)
    const initialTokenA = resolvedTokenA.config.tokenHolders
      .filter(x => resolve(x[0]).config === config)
      .reduce((a, x) => a + x[1], 0)

    const bondingCurveContract = await BondingCurve.deploy(
      resolvedTokenA.address, resolve(tokenB).address, resolve(beneficiary).address,
      initialTokenA, price[0], price[1], price[2],
      tax[0], tax[1],
      Math.round(initialTokenA * threshold), convertTimeToBlocks(thresholdDeadline)
    )

    return {
      address: bondingCurveContract.address,
      deployed: bondingCurveContract.deployTransaction.wait()
    }
  },

  Allocations: async function ({
    token,
    owner,
    claimLockTime = '3 days',
    globalSupervisors = []
  }, signer, resolve) {
    const Allocations = await ethers.getContractFactory('Allocations', signer)

    const allocationsContract = await Allocations.deploy(
      resolve(owner).address, resolve(token).address, convertTimeToBlocks(claimLockTime), globalSupervisors.map(x => resolve(x).address)
    )

    return {
      address: allocationsContract.address,
      deployed: allocationsContract.deployTransaction.wait()
    }
  },

  Fixed: async function ({ address, name }, signer, resolve) {
    address = address || await ask(`Address for ${name}`, '(use dummy)', ethers.utils.getAddress)

    if (address === '(use dummy)') {
      log.warning(`Using dummy address for ${name}`)
      deployFunctions.Fixed._dummyAddress = (deployFunctions.Fixed._dummyAddress || 0) + 1
      address = (await ethers.getSigners())[deployFunctions.Fixed._dummyAddress].address
    }

    return { address }
  },

  FixedERC20: async function ({ address, name, initialBalance }, signer, resolve) {
    address = address || await ask(`Address for ${name}`, '(deploy TestERC20)', ethers.utils.getAddress)

    if (address === '(deploy TestERC20)') {
      log.warning(`Deploying dummy contract for ${name}`)
      const TestERC20 = await ethers.getContractFactory('TestERC20', signer)

      const tokenContract = await TestERC20.deploy(name, [signer.address], [initialBalance])

      return {
        address: tokenContract.address,
        deployed: tokenContract.deployTransaction.wait()
      }
    }

    return { address }
  }
}

function createGasTrackingSigner (signer) {
  const resultSigner = Object.create(signer)
  resultSigner.sendTransaction = async function () {
    const transaction = await signer.sendTransaction.apply(this, arguments)
    transaction.wait().then(function (transactionReceipt) {
      resultSigner.gasUsed = resultSigner.gasUsed.add(transactionReceipt.gasUsed)
      resultSigner.gasPaid = resultSigner.gasPaid.add(transactionReceipt.gasUsed.mul(transaction.gasPrice))
    })
    return transaction
  }
  resultSigner.gasUsed = ethers.BigNumber.from(0)
  resultSigner.gasPaid = ethers.BigNumber.from(0)
  return resultSigner
}

async function deployConfig (config, signer) {
  signer = signer || (await ethers.getSigners())[0]
  signer = createGasTrackingSigner(signer)

  const startGasUsed = signer.gasUsed
  const startGasPaid = signer.gasPaid

  log.info('Deploying contracts...')

  const deployed = {}
  const addresses = {}

  function resolve (key) {
    if (deployed[key]) {
      return deployed[key]
    } else if (config[key]) {
      return { config: config[key] }
    } else {
      return { address: key || nilAddress }
    }
  }

  let tableSize = 0
  for (const key in config) {
    config[key].name = config[key].name || key
    config[key].type = config[key].type || 'Fixed'

    tableSize = Math.max(tableSize, config[key].name.length + config[key].type.length)
  }

  for (const key in config) {
    const name = config[key].name
    const type = config[key].type

    log.trace(`Deploying ${name} (${type})...`)

    const startGasUsed = signer.gasUsed
    const startGasPaid = signer.gasPaid

    const result = await deployFunctions[type](config[key], signer, resolve)
    result.config = config[key]

    deployed[key] = result
    addresses[key] = result.address

    if (result.deployed) await result.deployed

    const gasCosts = `(gas: ${(signer.gasUsed - startGasUsed).toString().padStart(7)} = ${formatWeiToEth(signer.gasPaid - startGasPaid)})`

    log.info(`Deployed ${chalk.bold(name)} (${type}) ${' '.repeat(tableSize - name.length - type.length)} at ${result.address} ${chalk.gray(gasCosts)}`)
  }

  log.info('Deployed all contracts')

  for (const key in deployed) {
    if (deployed[key].postDeploy) {
      const name = deployed[key].config.name
      const type = deployed[key].config.type

      log.trace(`Initializing ${name} (${type}) ...`)

      const startGasUsed = signer.gasUsed
      const startGasPaid = signer.gasPaid

      await deployed[key].postDeploy()

      log.info(`Initialized ${name} (${type}) ${' '.repeat(tableSize + 43 - name.length - type.length)} ${chalk.gray(`(gas: ${(signer.gasUsed - startGasUsed).toString().padStart(7)} = ${formatWeiToEth(signer.gasPaid - startGasPaid)})`)}`)
    }
  }

  log.info(`Finished deployment! ${' '.repeat(tableSize + 36)} ${chalk.gray(`(total: ${(signer.gasUsed - startGasUsed).toString().padStart(7)} = ${formatWeiToEth(signer.gasPaid - startGasPaid)})`)}`)

  return addresses
}

async function readConfig (configFile) {
  configFile = configFile || (await ask('Config file to deploy', 'config/apocryph.json'))

  return JSON.parse(await fs.readFile(configFile, 'utf8'))
}

async function main () {
  try {
    const config = await readConfig()
    const result = await deployConfig(config)
    process.stdout.write(JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (e) {
    log.error(e)
    process.exit(1)
  }
}

main()
