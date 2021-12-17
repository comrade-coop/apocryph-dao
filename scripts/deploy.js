const chalk = require('chalk')
const readline = require('readline')
const fs = require('fs').promises
const path = require('path')
const hre = require("hardhat");
const ethernal = require('hardhat-ethernal');

const log = {
  debug(message) { process.stderr.write(chalk.gray(`DEBUG: ${message}`) + '\n') },
  trace(message) { process.stderr.write(chalk.gray(`TRACE: ${chalk.gray(message)}`) + '\n') },
  info(message) { process.stderr.write(`INFO: ${message}` + '\n') },
  warning(message) { process.stderr.write(chalk.bold.yellow(`WARN: ${message}`) + '\n') },
  error(message) { process.stderr.write(chalk.bold.red(`ERROR: ${message}`) + '\n') }
}

// Utilities

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

function convertTimeToBlocks(time) {
  const [, number, unit] = /(\d+\.?|\d*\.\d+) ?(\w*)/.exec(time)
  const scale = timeUnits[unit] || timeUnits[unit + 's']
  return Math.round(parseFloat(number) * scale)
}

function ask(question, defaultValue, validator) {
  if (process.stdin.readableEnded) {
    process.stderr.write(`=> ${question}? ${defaultValue ? `[${defaultValue}] ${defaultValue}` : ''}\n`)
    return Promise.resolve(defaultValue)
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr
    })

    let resolved = false
    function _resolve(result) {
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
    rl.on('SIGINT', function () {
      if (!resolved) {
        reject(new Error('Cancelled'))
      }
    })

    function callback(answer) {
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

function processRelations(relations, resolve) {
  let totalAmount = ethers.BigNumber.from(0)
  const initialParties = []
  const initialAmounts = []
  let postDeployAmount = ethers.BigNumber.from(0)
  const postDeployRelations = []

  for (const [party, amount, data] of relations) {
    const resolvedParty = resolve(party)
    if (resolvedParty.address && data === undefined) {
      initialParties.push(resolvedParty.address)
      initialAmounts.push(amount)
    } else {
      postDeployAmount = postDeployAmount.add(amount)
      postDeployRelations.push([party, amount, data])
    }
    totalAmount = totalAmount.add(amount)
  }

  return {
    totalAmount,
    initialParties,
    initialAmounts,
    postDeployAmount,
    postDeployRelations,
    async postDeployHelper(handler) {
      for (const [party, amount, data] of postDeployRelations) {
        const resolvedParty = resolve(party)
        await handler(resolvedParty, amount, data)
      }
    }
  }
}

const deployFunctions = {
  // [type]: (config, signer: Signer, resolve: String => {address, config, ..}) => Promise<{address: String, ..} }>
  TokenAgeToken: async function ({
    tokenName = 'Apocryph',
    tokenSymbol = 'CRYPH',
    decimals = '10',
    tokenHolders = [], // [?address, amount]
    totalSupply = undefined
  }, signer, resolve) {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken', signer)

    let { initialParties, initialAmounts, postDeployAmount, postDeployHelper, totalAmount } = processRelations(tokenHolders, resolve, totalSupply)

    if (totalSupply !== undefined) {
      const supplyDifference = ethers.BigNumber.from(totalSupply).sub(totalAmount)
      if (supplyDifference.gt(0)) {
        postDeployAmount = postDeployAmount.add(supplyDifference)
        log.warning(`Fixed supply of ${totalSupply} ${tokenSymbol} is ${supplyDifference} ${tokenSymbol} more than total assignment of ${totalSupply} ${tokenSymbol}; reassigning the rest to signer`)
      } else if (supplyDifference.lt(0)) {
        throw new Error(`Total assignment of ${totalAmount} ${tokenSymbol} is ${supplyDifference} ${tokenSymbol} less than fixed supply of ${totalSupply} ${tokenSymbol}`)
      }
    }

    if (postDeployAmount.gt(0)) {
      initialParties.push(signer.address)
      initialAmounts.push(postDeployAmount)
    }

    const tokenContract = await TokenAgeToken.deploy(tokenName, tokenSymbol, decimals, initialParties, initialAmounts)

    return {
      address: tokenContract.address,
      contractName: "TokenAgeToken",
      deployed: tokenContract.deployTransaction.wait(),
      async postDeploy() {
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
      contractName: "Vesting",
      deployed: vestingContract.deployTransaction.wait(),
      async handleTransfer(tokenContract, amount, [target, delayBlocks = '6 months', periodCount = '6', periodBlocks = '6 months']) {
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

    const resolvedWeights = resolve(weights).address
    const resolvedOwner = owner === '(self)' ? nilAddress : resolve(owner).address
    const resolvedProposer = proposer === '(any)' ? nilAddress : proposer === '(members)' ? oneAddress : resolve(proposer).address
    const resolvedEnacter = proposer === '(any)' ? nilAddress : proposer === '(members)' ? oneAddress : resolve(enacter).address

    const votingContract = await DeadlineVoting.deploy(resolvedOwner, resolvedProposer, resolvedEnacter, resolvedWeights, convertTimeToBlocks(deadline))

    return {
      address: votingContract.address,
      contractName: "DeadlineVoting",
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
      contractName: "Group",
      deployed: groupContract.deployTransaction.wait(),
      async postDeploy() {
        await postDeployHelper((resolvedMember, weight) => groupContract.setWeightOf(resolvedMember.address, weight))
        if (groupOwnerAddress === signer.address) {
          const resolvedOwner = resolve(owner)
          await groupContract.setOwner(resolvedOwner.address)
        }
      }
    }
  },

  DelegatedGroup: async function ({
    owner,
    members = []
  }, signer, resolve) {
    const Group = await ethers.getContractFactory('DelegatedGroup', signer)

    const { initialParties, initialAmounts, postDeployRelations, postDeployHelper } = processRelations(members, resolve)
    const groupOwnerAddress = postDeployRelations.length ? signer.address : (resolve(owner).address || signer.address)

    const groupContract = await Group.deploy(initialParties, initialAmounts, groupOwnerAddress)

    return {
      address: groupContract.address,
      contractName: "DelegatedGroup",
      deployed: groupContract.deployTransaction.wait(),
      async postDeploy() {
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
      price = ['3', '100', '1'],
      tax = ['1', '100'],
      threshold = ['1', '100'],
      thresholdDeadline = '3 days'
    } = config

    const BondingCurve = await ethers.getContractFactory('BondingCurve', signer)

    const resolvedTokenA = resolve(tokenA)
    const initialTokenA = resolvedTokenA.config.tokenHolders
      .filter(x => resolve(x[0]).config === config)
      .reduce((a, x) => a.add(x[1]), ethers.BigNumber.from(0))

    const bondingCurveContract = await BondingCurve.deploy(
      resolvedTokenA.address, resolve(tokenB).address, resolve(beneficiary).address,
      initialTokenA, price[0], price[1], price[2],
      tax[0], tax[1],
      initialTokenA.mul(threshold[0]).div(threshold[1]), convertTimeToBlocks(thresholdDeadline)
    )

    return {
      address: bondingCurveContract.address,
      contractName: "BondingCurve",
      deployed: bondingCurveContract.deployTransaction.wait()
    }
  },

  Allocations: async function ({
    owner,
    claimLockTime = '3 days',
    globalSupervisors = []
  }, signer, resolve) {
    const Allocations = await ethers.getContractFactory('Allocations', signer)

    const allocationsContract = await Allocations.deploy(
      resolve(owner).address, convertTimeToBlocks(claimLockTime), globalSupervisors.map(x => resolve(x).address)
    )

    return {
      address: allocationsContract.address,
      contractName: "Allocations",
      deployed: allocationsContract.deployTransaction.wait()
    }
  },

  Fixed: async function ({ name }, signer, resolve) {
    let address = await ask(`Address for ${name}`, '(use dummy)', ethers.utils.getAddress)

    if (address === '(use dummy)') {
      log.warning(`Using dummy address for ${name}`)
      deployFunctions.Fixed._dummyAddress = (deployFunctions.Fixed._dummyAddress || 0) + 1
      address = (await ethers.getSigners())[deployFunctions.Fixed._dummyAddress].address
    }

    return { address }
  },

  FixedERC20: async function ({ name, initialBalance }, signer, resolve) {
    const address = await ask(`Address for ${name}`, '(deploy TestERC20)', ethers.utils.getAddress)

    if (address === '(deploy TestERC20)') {
      log.warning(`Deploying dummy contract for ${name}`)
      const TestERC20 = await ethers.getContractFactory('TestERC20', signer)

      const tokenContract = await TestERC20.deploy(name, [signer.address], [initialBalance])

      return {
        address: tokenContract.address,
        contractName: "TestERC20",
        deployed: tokenContract.deployTransaction.wait()
      }
    }

    return { address }
  }
}

function createGasTrackingSigner(signer) {
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

function formatWei(weiAmount) {
  const paddedWei = weiAmount.toString().padStart(19, '0').padStart(19 + 5)

  return `${paddedWei.slice(0, -18)}.${paddedWei.slice(-18)} ETH`
}

function formatGasUsed(oldGasUsed, newGasUsed) {
  const gasUsed = newGasUsed[0].sub(oldGasUsed[0])
  const weiUsed = newGasUsed[1].sub(oldGasUsed[1])

  return `${gasUsed.toString().padStart(7)} = ${formatWei(weiUsed)}`
}

async function deployConfig(config, signer) {
  signer = signer || (await ethers.getSigners())[0]
  signer = createGasTrackingSigner(signer)

  const startGas = signer.gasUsed

  log.info('Deploying contracts...')

  const resolved = Object.create(null)
  const deployment = {
    configFile: config.configFile,
    network: network.name,
    startBlock: (await ethers.provider.getBlock()).number,
    contracts: {
      deployer: { type: 'Fixed', name: 'Deployer', address: signer.address }
    }
  }

  function resolve(key) {
    if (resolved[key]) {
      return resolved[key]
    } else if (config.contracts[key]) {
      return { config: config.contracts[key] }
    } else {
      return { address: key || nilAddress }
    }
  }

  let tableSize = 0
  for (const key in config.contracts) {
    config.contracts[key].name = config.contracts[key].name || key
    config.contracts[key].type = config.contracts[key].type || 'Fixed'

    tableSize = Math.max(tableSize, config.contracts[key].name.length + config.contracts[key].type.length)
  }

  log.info(`Signer address is ${' '.repeat(tableSize - 2)} ${signer.address} ${chalk.gray(`(balance:       ${formatWei(await signer.getBalance())})`)}`)

  for (const key in config.contracts) {
    const name = config.contracts[key].name
    const type = config.contracts[key].type

    let result

    if (config.contracts[key].address) {
      result = { address: config.contracts[key].address }
      log.info(`Found ${chalk.bold(name)} (${type})    ${' '.repeat(tableSize - name.length - type.length)} at ${result.address}`)
    } else {
      log.trace(`Deploying ${name} (${type})...`)

      const startGas = signer.gasUsed

      result = await deployFunctions[type](config.contracts[key], signer, resolve)
      if (result.deployed) await result.deployed

      log.info(`Deployed ${chalk.bold(name)} (${type}) ${' '.repeat(tableSize - name.length - type.length)} at ${result.address} ${chalk.gray(`(gas: ${formatGasUsed(startGas, signer.gasUsed)})`)}`)

      if(result.contractName){
        log.info(`DEBUGGING !! ${name} ${type} ${key} ${result.address}`)
        await hre.ethernal.push({
          name: result.contractName,
          address: `${result.address}`
        });
      }

    }

    result.config = config.contracts[key]

    resolved[key] = result
    deployment.contracts[key] = { type, name, address: result.address }
  }

  log.info('Deployed all contracts')

  for (const key in resolved) {
    if (resolved[key].postDeploy) {
      const name = resolved[key].config.name
      const type = resolved[key].config.type

      log.trace(`Initializing ${name} (${type}) ...`)

      const startGas = signer.gasUsed

      await resolved[key].postDeploy()

      log.info(`Initialized ${name} (${type}) ${' '.repeat(tableSize + 43 - name.length - type.length)} ${chalk.gray(`(gas: ${formatGasUsed(startGas, signer.gasUsed)})`)}`)
    }
  }

  log.info(`Finished deployment! ${' '.repeat(tableSize + 36)} ${chalk.gray(`(total: ${formatGasUsed(startGas, signer.gasUsed)})`)}`)

  return deployment
}

async function readConfig(configFile) {
  configFile = configFile || (await ask(`Config file to deploy on '${network.name}'`, 'config/apocryph.json'))

  const config = JSON.parse(await fs.readFile(configFile, 'utf8'))
  config.configFile = configFile
  return config
}

async function writeDeployment(config, deployment) {
  config.deploymentFile = config.deploymentFile || (await ask('Deployment file to write', `deployment/${path.basename(config.configFile, '.json')}-${Date.now()}.json`))

  await fs.mkdir(path.dirname(config.deploymentFile), { recursive: true })
  await fs.writeFile(config.deploymentFile, JSON.stringify(deployment, null, 2))
  log.info(`Wrote deployment data to ${config.deploymentFile}`)
  //   process.stdout.write(JSON.stringify(deployment))
}

async function main() {
  try {
    const config = await readConfig()
    const deployment = await deployConfig(config)
    await writeDeployment(config, deployment)
    process.exit(0)
  } catch (e) {
    log.error(e.stack)
    process.exit(1)
  }
}

main()
