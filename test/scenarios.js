const { expect } = require('chai')
const chalk = require('chalk')
const utils = require('../scripts/_utils')

describe('Gas usage scenarios', function () {
  async function advanceToBlock (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine')
    }
  }

  beforeEach('prepare signers', async function () {
    this.signers = (await ethers.getSigners()).map(x => utils.createGasTrackingSigner(x))
    this.snapshot = await network.provider.send('evm_snapshot')
  })

  afterEach('print gas usage', async function () {
    const totalGas = this.signers.map(x => x.gasUsed[0]).reduce((a, b) => a.add(b))
    const deploymentGas = this.signers[0].gasUsed[0]
    const operationGas = totalGas.sub(deploymentGas)
    // console.log(`${'  '.repeat(3)}• ${chalk.gray(`Deployment gas used: ${deploymentGas}`)}`)
    console.log(`${'  '.repeat(3)}• ${chalk.gray(`Operations gas used: ${operationGas}`)} ${chalk.bold.gray(`(${operationGas.mul(10000).div(this.targetOperationsGas).toString().replace(/(..)$/, '.$1')}%)`)}`)
    await network.provider.send('evm_revert', [this.snapshot])
  })

  it('DAO Scenario', async function () {
    this.targetOperationsGas = ethers.BigNumber.from('1610523')
    // Deploy contracts

    const initialBalance = ethers.BigNumber.from('10000000000000000')
    const transferAmount = ethers.BigNumber.from('1000000000000000')

    const [_deployer, userA, userB, userC, supervisor] = this.signers
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken', _deployer)
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting', _deployer)
    const Allocations = await ethers.getContractFactory('Allocations', _deployer)

    const token = await TokenAgeToken.deploy('Test Apocryph', 'TCRYPH', 10, [_deployer.address, userA.address, userB.address, userC.address], [initialBalance, initialBalance, initialBalance, initialBalance])
    await token.deployTransaction.wait()

    const voting = await DeadlineQuorumVoting.deploy(utils.nilAddress, utils.oneAddress, utils.nilAddress, token.address, 30, 30, 0)
    await voting.deployTransaction.wait()

    const allocations = await Allocations.deploy(voting.address, 10, [supervisor.address])
    await allocations.deployTransaction.wait()

    token.connect(_deployer).transfer(allocations.address, initialBalance)

    const increaseAllocationData = allocations.interface.encodeFunctionData('increaseAllocation', [userC.address, token.address, transferAmount])
    const actions = [[allocations.address, increaseAllocationData]]
    const actionsBytes = ethers.utils.defaultAbiCoder.encode(['(address,bytes)[]'], [actions])
    const actionsHash = ethers.utils.keccak256(actionsBytes)
    const rationaleHash = ethers.utils.id('Example rationale')
    const voteId = ethers.utils.keccak256(ethers.utils.concat([rationaleHash, actionsHash]))

    // Do some transactions

    const startBlock = (await ethers.provider.getBlock()).number

    await advanceToBlock(startBlock + 0)
    await (await token.connect(userA).transfer(userB.address, transferAmount.mul(2))).wait()
    await (await token.connect(userA).delegate(userC.address)).wait()

    await advanceToBlock(startBlock + 10)
    await (await voting.connect(userA).propose(rationaleHash, actionsHash)).wait()

    await advanceToBlock(startBlock + 15)
    await (await voting.connect(userA).vote(voteId, 1)).wait()

    await advanceToBlock(startBlock + 20)
    await (await token.connect(userB).transfer(userC.address, transferAmount)).wait()

    await advanceToBlock(startBlock + 25)
    await (await voting.connect(userB).vote(voteId, 2)).wait()

    await advanceToBlock(startBlock + 30)
    await (await voting.connect(userC).vote(voteId, 1)).wait()

    await advanceToBlock(startBlock + 40)
    await (await voting.connect(userC).enact(rationaleHash, actions)).wait()

    await advanceToBlock(startBlock + 50)
    await (await allocations.connect(userC).increaseClaim(token.address, transferAmount.div(2))).wait()

    await advanceToBlock(startBlock + 60)
    await (await allocations.connect(userC).enactClaim(token.address)).wait()
  })

  it('BCO Scenario', async function () {
    this.targetOperationsGas = ethers.BigNumber.from('2171564')

    // Deploy contracts

    const initialCryphBalance = ethers.BigNumber.from('10000000000000000')
    const initialTestBalance = ethers.BigNumber.from('100000000000000000000')

    const [_deployer, beneficiary, userA, userB, userC] = this.signers
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken', _deployer)
    const TestERC20 = await ethers.getContractFactory('TestERC20', _deployer)
    const BondingCurve = await ethers.getContractFactory('BondingCurve', _deployer)

    const cryphToken = await TokenAgeToken.deploy('Test Apocryph', 'TCRYPH', 10, [_deployer.address], [initialCryphBalance])
    await cryphToken.deployTransaction.wait()

    const testToken = await TestERC20.deploy('Test Token', [userA.address, userB.address], [initialTestBalance, initialTestBalance])
    await testToken.deployTransaction.wait()

    const bondingCurve = await BondingCurve.deploy(
      cryphToken.address, testToken.address, beneficiary.address,
      initialCryphBalance,
      10, 10000, 1, // price=10 to 10000
      1, 100, // tax=1/100
      initialCryphBalance.div(100), 10)
    await bondingCurve.deployTransaction.wait()

    cryphToken.connect(_deployer).transfer(bondingCurve.address, initialCryphBalance)

    // Do some transactions

    await (await testToken.connect(userA).approve(bondingCurve.address, initialTestBalance)).wait()
    await (await testToken.connect(userB).approve(bondingCurve.address, initialTestBalance)).wait()
    await (await testToken.connect(userC).approve(bondingCurve.address, initialTestBalance)).wait()
    await (await cryphToken.connect(userA).approve(bondingCurve.address, initialCryphBalance)).wait()
    await (await cryphToken.connect(userB).approve(bondingCurve.address, initialCryphBalance)).wait()

    const startBlock = (await ethers.provider.getBlock()).number

    await advanceToBlock(startBlock + 0)
    await (await bondingCurve.connect(userA).buy(initialCryphBalance.mul(40).div(100), initialTestBalance, utils.nilAddress)).wait()

    await advanceToBlock(startBlock + 10)
    await (await bondingCurve.connect(userB).buy(initialCryphBalance.mul(30).div(100), initialTestBalance, utils.nilAddress)).wait()

    await advanceToBlock(startBlock + 15)
    await (await bondingCurve.connect(userA).sell(initialCryphBalance.mul(20).div(100), 0, userC.address)).wait()

    await advanceToBlock(startBlock + 20)
    await (await bondingCurve.connect(userB).sell(initialCryphBalance.mul(10).div(100), 0, userC.address)).wait()

    await advanceToBlock(startBlock + 30)
    await (await bondingCurve.connect(userB).buy(initialCryphBalance.mul(59).div(100).add(1), initialTestBalance, utils.nilAddress)).wait()

    await advanceToBlock(startBlock + 35)
    await (await bondingCurve.connect(userC).buy(initialCryphBalance, initialTestBalance, utils.nilAddress)).wait()

    await advanceToBlock(startBlock + 40)
    await (await bondingCurve.connect(userC).enactTransition()).wait()

    await advanceToBlock(startBlock + 50)

    await (await bondingCurve.connect(beneficiary).withdraw(utils.nilAddress, '0x' + 'ff'.repeat(32))).wait()
  })
})
