const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('Vesting', function () {
  async function advanceTime (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine')
    }
  }

  it('Basic deployment', async function () {
    const IERC1363 = await hre.artifacts.readArtifact('IERC1363')
    const Vesting = await ethers.getContractFactory('Vesting')
    const [accountA] = await ethers.getSigners()

    const token = await waffle.deployMockContract(accountA, IERC1363.abi)
    const vesting = await Vesting.deploy(token.address, 'Vested TEST', 'VTEST')
    await vesting.deployTransaction.wait()

    expect(await vesting.name()).to.equal('Vested TEST')
    expect(await vesting.symbol()).to.equal('VTEST')
  })

  function getVestingData (targetAddress, startBlock, periodCount, periodBlocks) {
    return ethers.utils.defaultAbiCoder.encode(['address', 'uint128', 'uint64', 'uint64'], [targetAddress, startBlock, periodCount, periodBlocks])
  }

  it('Create vesting', async function () {
    const IERC1363 = await hre.artifacts.readArtifact('IERC1363')
    const Vesting = await ethers.getContractFactory('Vesting')
    const [accountA, accountB] = await ethers.getSigners()

    const vestingAmount = 100
    const startBlock = (await ethers.provider.getBlock()).number
    const vestingData = getVestingData(accountB.address, startBlock + 100, 5, 10)
    const vestingDataNoAddress = getVestingData(nilAddress, startBlock + 100, 5, 10)

    const token = await waffle.deployMockContract(accountA, IERC1363.abi)
    const vesting = await Vesting.deploy(token.address, 'Vested TEST', 'VTEST')
    await vesting.deployTransaction.wait()

    await expect(accountA.call(vesting, 'onTransferReceived', accountA.address, accountA.address, vestingAmount, vestingData))
      .to.be.reverted // Only token can call that

    await expect(token.call(vesting, 'onTransferReceived', accountA.address, accountA.address, vestingAmount, vestingData))
      .to.emit(vesting, 'Transfer').withArgs(nilAddress, accountB.address, 0) // 0 is the token ID

    await expect(token.call(vesting, 'onTransferReceived', accountA.address, accountA.address, vestingAmount, vestingDataNoAddress))
      .to.emit(vesting, 'Transfer').withArgs(nilAddress, accountA.address, 1) // 0 is the token ID
  })

  it('Claim vesting', async function () {
    const IERC1363 = await hre.artifacts.readArtifact('IERC1363')
    const Vesting = await ethers.getContractFactory('Vesting')
    const [accountA, accountB] = await ethers.getSigners()

    const vestingAmount = 100
    const startBlock = (await ethers.provider.getBlock()).number
    const vestingData = getVestingData(accountB.address, startBlock + 7, 5, 10)

    const token = await waffle.deployMockContract(accountA, IERC1363.abi)
    const vesting = await Vesting.deploy(token.address, 'Vested TEST', 'VTEST')
    await vesting.deployTransaction.wait()

    await expect(token.call(vesting, 'onTransferReceived', accountA.address, accountA.address, vestingAmount, vestingData))
      .to.emit(vesting, 'Transfer').withArgs('0x' + '0'.repeat(40), accountB.address, 0) // 0 is the token ID

    await token.mock.transfer.withArgs(accountB.address, 0).returns(true)
    await expect(vesting.connect(accountB)['claim(uint256)'](0)).to.not.be.reverted
    await token.mock.transfer.withArgs(accountB.address, 0).reverts()

    let totalTransferred = 0
    for (let i = 0; i < 5; i++) {
      await advanceTime(startBlock + 7 + i * 10 + 3) // +3 to avoid issue with claim happening too early..

      await token.mock.transfer.withArgs(accountB.address, vestingAmount / 5).returns(true)
      await expect(vesting.connect(accountB)['claim(uint256)'](0)).to.not.be.reverted
      await token.mock.transfer.withArgs(accountB.address, vestingAmount / 5).reverts()
      await expect(vesting.connect(accountB)['claim(uint256)'](0)).to.not.be.reverted
      totalTransferred += vestingAmount / 5
    }
    expect(totalTransferred).to.equal(vestingAmount)
  })
})
