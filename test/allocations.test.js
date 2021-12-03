const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('Allocations', function () { // TODO: Use TestERC20 instead of IERC20 mocks
  async function advanceTime (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine')
    }
  }

  it('Basic deploy', async function () {
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountVoting] = await ethers.getSigners()

    const allocations = await Allocations.deploy(accountVoting.address, 10, [])
    await allocations.deployTransaction.wait()
  })

  it('Change parameters', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB, accountC, accountSupervisor] = await ethers.getSigners()

    const allocationAmount = 100

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, token.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationAmount)

    async function votingOnlySetterHelper (f) {
      await expect(f(accountA)).to.be.reverted
      await expect(f(accountVoting)).to.not.be.reverted
      await expect(f(accountSupervisor)).to.be.reverted
    }

    expect(await allocations.isSupervisor(accountB.address, accountSupervisor.address)).to.equal(false)
    expect(await allocations.isSupervisorFor(accountB.address, accountSupervisor.address)).to.equal(false)
    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(nilAddress, accountSupervisor.address, true)) // First so we test global supervisor too

    expect(await allocations.isSupervisor(accountB.address, accountSupervisor.address)).to.equal(false)
    expect(await allocations.isSupervisorFor(accountB.address, accountSupervisor.address)).to.equal(true)
    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(accountB.address, accountSupervisor.address, true))
    expect(await allocations.isSupervisor(accountB.address, accountSupervisor.address)).to.equal(true)
    expect(await allocations.isSupervisorFor(accountB.address, accountSupervisor.address)).to.equal(true)

    expect(await allocations.lockDurationRaw(accountB.address, token.address)).to.equal(0)
    expect(await allocations.lockDuration(accountB.address, token.address)).to.equal(10)
    await votingOnlySetterHelper(account => allocations.connect(account).setLockDuration(accountB.address, token.address, '0x' + 'FF'.repeat(12)))
    expect(await allocations.lockDuration(accountB.address, token.address)).to.equal(0)
    await votingOnlySetterHelper(account => allocations.connect(account).setLockDuration(accountB.address, token.address, 11))
    expect(await allocations.lockDuration(accountB.address, token.address)).to.equal(11)

    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(accountB.address, accountSupervisor.address, false))

    expect(await allocations.lockDuration(accountC.address, token.address)).to.equal(10)
    await votingOnlySetterHelper(account => allocations.connect(account).setLockDuration(nilAddress, nilAddress, 12))
    expect(await allocations.lockDuration(accountB.address, token.address)).to.equal(11)
    expect(await allocations.lockDuration(accountC.address, token.address)).to.equal(12)

    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(nilAddress, accountSupervisor.address, false))
  })

  it('Create and revoke allocation', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB] = await ethers.getSigners()

    const allocationAmount = 100
    const allocationDecreaseAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, token.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationAmount)

    await expect(allocations.connect(accountVoting).revokeAllocation(accountB.address, token.address, allocationDecreaseAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationAmount - allocationDecreaseAmount)

    expect(await allocations.allocation(accountB.address, token.address)).to.equal(allocationAmount - allocationDecreaseAmount)

    await expect(allocations.connect(accountVoting).revokeAllocation(accountB.address, token.address, allocationAmount - allocationDecreaseAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, 0)

    expect(await allocations.allocation(accountB.address, token.address)).to.equal(0)

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, token.address, allocationDecreaseAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationDecreaseAmount)
    expect(await allocations.allocation(accountB.address, token.address)).to.equal(allocationDecreaseAmount)

    await expect(allocations.connect(accountVoting).revokeAllocation(accountB.address, token.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, 0)
    expect(await allocations.allocation(accountB.address, token.address)).to.equal(0)
  })

  it('Create and enact claim', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB] = await ethers.getSigners()

    const allocationAmount = 100
    const claimAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, token.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationAmount)

    const startBlock = (await ethers.provider.getBlock()).number
    await expect(allocations.connect(accountB).increaseClaim(token.address, claimAmount))
      .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, token.address, claimAmount)

    await expect(allocations.connect(accountB).enactClaim(token.address))
      .to.be.reverted

    await advanceTime(startBlock + 10 + 2) // +2 to make sure the to.be.reverted checks aren't triggered by block number

    await token.mock.transfer.withArgs(accountB.address, claimAmount).reverts()
    await expect(allocations.connect(accountB).enactClaim(token.address))
      .to.be.reverted

    await token.mock.transfer.withArgs(accountB.address, claimAmount).returns(true)

    await expect(allocations.connect(accountA).enactClaim(token.address))
      .to.be.reverted
    await expect(allocations.connect(accountVoting).enactClaim(token.address))
      .to.be.reverted

    await expect(allocations.connect(accountB).enactClaim(token.address))
      .to.emit(allocations, 'ClaimEnacted').withArgs(accountB.address, token.address, claimAmount)
  })

  it('Create and revoke claim', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB, accountGlobalSupervisor, accountSupervisor, accountC] = await ethers.getSigners()

    const allocationAmount = 100
    const claimAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, 10, [accountGlobalSupervisor.address])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, token.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationAmount)
    await expect(allocations.connect(accountVoting).setSupervisor(accountB.address, accountSupervisor.address, true))
      .to.not.be.reverted

    for (const revoker of [accountGlobalSupervisor, accountSupervisor, accountVoting, accountB]) {
      const startBlock = (await ethers.provider.getBlock()).number
      await expect(allocations.connect(accountB).increaseClaim(token.address, claimAmount))
        .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, token.address, claimAmount)

      await advanceTime(startBlock + 5)

      await expect(allocations.connect(revoker).revokeClaim(accountB.address, token.address))
        .to.emit(allocations, 'ClaimRevoked').withArgs(accountB.address, token.address, claimAmount)

      await advanceTime(startBlock + 10)

      await expect(allocations.connect(accountB).enactClaim(token.address))
        .to.be.reverted
    }

    {
      const startBlock = (await ethers.provider.getBlock()).number
      await expect(allocations.connect(accountB).increaseClaim(token.address, claimAmount))
        .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, token.address, claimAmount)

      await advanceTime(startBlock + 5)

      await expect(allocations.connect(accountC).revokeClaim(token.address, accountB.address))
        .to.be.reverted
    }
  })

  it('Create and enact instant claim', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB] = await ethers.getSigners()

    const allocationAmount = 100
    const claimAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).setLockDuration(accountB.address, token.address, '0x' + 'FF'.repeat(12)))
      .to.not.be.reverted

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, token.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, token.address, allocationAmount)

    await token.mock.transfer.withArgs(accountB.address, claimAmount).returns(true)

    const startBlock = (await ethers.provider.getBlock()).number

    await network.provider.send('evm_setAutomine', [false])

    const proposeClaim = allocations.connect(accountB).increaseClaim(token.address, claimAmount)
    const enactClaim = allocations.connect(accountB).enactClaim(token.address)

    await new Promise(resolve => setTimeout(resolve, 10))
    await network.provider.send('evm_mine')
    await network.provider.send('evm_setAutomine', [true])

    const endBlock = (await ethers.provider.getBlock()).number

    await expect(proposeClaim).to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, token.address, claimAmount)
    await expect(enactClaim).to.emit(allocations, 'ClaimEnacted').withArgs(accountB.address, token.address, claimAmount)

    const finalBlock = (await ethers.provider.getBlock()).number

    expect(finalBlock).to.equal(endBlock)
    expect(startBlock).to.equal(endBlock - 1)
  })
})
