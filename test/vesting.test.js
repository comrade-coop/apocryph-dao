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
      .to.emit(vesting, 'Transfer').withArgs(nilAddress, accountA.address, 1)
  })

  it('Create ERC20 vesting', async function () {
    const TestERC20 = await ethers.getContractFactory('TestERC20')
    const Vesting = await ethers.getContractFactory('Vesting')
    const [accountA, accountB] = await ethers.getSigners()

    const vestingAmount = 100
    const startBlock = (await ethers.provider.getBlock()).number

    const token = await TestERC20.deploy('Test', [accountA.address], [vestingAmount * 2])
    await token.deployTransaction.wait()
    const vesting = await Vesting.deploy(token.address, 'Vested TEST', 'VTEST')
    await vesting.deployTransaction.wait()

    await token.connect(accountA).approve(vesting.address, vestingAmount * 2)

    await expect(vesting.connect(accountA).mint(accountB.address, vestingAmount, startBlock + 100, 5, 10))
      .to.emit(vesting, 'Transfer').withArgs(nilAddress, accountB.address, 0)
      .to.emit(token, 'Transfer').withArgs(accountA.address, vesting.address, vestingAmount)

    await expect(vesting.connect(accountA).mint(nilAddress, vestingAmount, startBlock + 100, 5, 10))
      .to.emit(vesting, 'Transfer').withArgs(nilAddress, accountA.address, 1)
      .to.emit(token, 'Transfer').withArgs(accountA.address, vesting.address, vestingAmount)
  })

  it('Claim vesting', async function () {
    const IERC1363 = await hre.artifacts.readArtifact('IERC1363')
    const Vesting = await ethers.getContractFactory('Vesting')
    const [accountA, accountB] = await ethers.getSigners()

    const vestingAmount = 100
    const startBlock = (await ethers.provider.getBlock()).number
    const vestingStartBlock = startBlock + 7
    const periodCount = 4
    const periodBlocks = 10
    const vestingData = getVestingData(accountB.address, vestingStartBlock, periodCount, periodBlocks)

    const token = await waffle.deployMockContract(accountA, IERC1363.abi)
    const vesting = await Vesting.deploy(token.address, 'Vested TEST', 'VTEST')
    await vesting.deployTransaction.wait()

    await expect(token.call(vesting, 'onTransferReceived', accountA.address, accountA.address, vestingAmount, vestingData))
      .to.emit(vesting, 'Transfer').withArgs('0x' + '0'.repeat(40), accountB.address, 0) // 0 is the token ID

    await token.mock.transfer.withArgs(accountB.address, 0).returns(true)
    await expect(vesting.connect(accountB).claim(0, nilAddress)).to.not.be.reverted
    await token.mock.transfer.withArgs(accountB.address, 0).reverts()

    let totalTransferred = 0
    for (let i = 0; i < periodCount + 1; i++) {
      await advanceTime(vestingStartBlock + i * periodBlocks + 3) // +3 to avoid issue with claim happening too early..

      await token.mock.transfer.withArgs(accountB.address, vestingAmount / (periodCount + 1)).returns(true)

      const tx = vesting.connect(accountB).claim(0, nilAddress)
      await expect(tx).to.not.be.reverted
      totalTransferred += vestingAmount / (periodCount + 1)

      if (i < periodCount) {
        await expect(tx).to.not.emit(vesting, 'Transfer').withArgs(accountB.address, nilAddress, 0)

        await token.mock.transfer.withArgs(accountB.address, vestingAmount / (periodCount + 1)).reverts()
        await expect(vesting.connect(accountB).claim(0, nilAddress)).to.not.be.reverted
      } else {
        await expect(tx).to.emit(vesting, 'Transfer').withArgs(accountB.address, nilAddress, 0)

        await expect(vesting.connect(accountB).claim(0, nilAddress)).to.be.reverted // Burnt token
      }
    }
    expect(totalTransferred).to.equal(vestingAmount)
  })
})
