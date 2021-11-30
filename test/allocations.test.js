const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('Allocations', function () {
  async function advanceTime (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine')
    }
  }

  it('Basic deploy', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20') // TODO: Use TestERC20
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting] = await ethers.getSigners()

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, token.address, 10, [])
    await allocations.deployTransaction.wait()
  })

  it('Change parameters', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB, accountC, accountSupervisor] = await ethers.getSigners()

    const allocationAmount = 100

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, token.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationAmount)

    async function votingOnlySetterHelper (f) {
      await expect(f(accountA)).to.be.reverted
      await expect(f(accountVoting)).to.not.be.reverted
      await expect(f(accountSupervisor)).to.be.reverted
    }

    expect(await allocations.isSupervisor(accountB.address, accountSupervisor.address)).to.be.false
    expect(await allocations.isSupervisorFor(accountB.address, accountSupervisor.address)).to.be.false
    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(nilAddress, accountSupervisor.address, true)) // First so we test global supervisor too

    expect(await allocations.isSupervisor(accountB.address, accountSupervisor.address)).to.be.false
    expect(await allocations.isSupervisorFor(accountB.address, accountSupervisor.address)).to.be.true
    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(accountB.address, accountSupervisor.address, true))
    expect(await allocations.isSupervisor(accountB.address, accountSupervisor.address)).to.be.true
    expect(await allocations.isSupervisorFor(accountB.address, accountSupervisor.address)).to.be.true

    expect(await allocations.lockDurationRaw(accountB.address)).to.equal(0)
    expect(await allocations.lockDuration(accountB.address)).to.equal(10)
    await votingOnlySetterHelper(account => allocations.connect(account).setLockDuration(accountB.address, '0x' + 'FF'.repeat(96/8)))
    expect(await allocations.lockDuration(accountB.address)).to.equal(0)
    await votingOnlySetterHelper(account => allocations.connect(account).setLockDuration(accountB.address, 11))
    expect(await allocations.lockDuration(accountB.address)).to.equal(11)

    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(accountB.address, accountSupervisor.address, false))

    expect(await allocations.lockDuration(accountC.address)).to.equal(10)
    await votingOnlySetterHelper(account => allocations.connect(account).setLockDuration(nilAddress, 12))
    expect(await allocations.lockDuration(accountB.address)).to.equal(11)
    expect(await allocations.lockDuration(accountC.address)).to.equal(12)

    await votingOnlySetterHelper(account => allocations.connect(account).setSupervisor(nilAddress, accountSupervisor.address, false))
  })

  it('Create and revoke allocation', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB] = await ethers.getSigners()

    const allocationAmount = 100
    const allocationDecreaseAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, token.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationAmount)

    await expect(allocations.connect(accountVoting).revokeAllocation(accountB.address, allocationDecreaseAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationAmount - allocationDecreaseAmount)

    expect(await allocations.allocation(accountB.address)).to.equal(allocationAmount - allocationDecreaseAmount)

    await expect(allocations.connect(accountVoting).revokeAllocation(accountB.address, allocationAmount - allocationDecreaseAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, 0)

    expect(await allocations.allocation(accountB.address)).to.equal(0)

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, allocationDecreaseAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationDecreaseAmount)
    expect(await allocations.allocation(accountB.address)).to.equal(allocationDecreaseAmount)

    await expect(allocations.connect(accountVoting).revokeAllocation(accountB.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, 0)
    expect(await allocations.allocation(accountB.address)).to.equal(0)
  })

  it('Create and enact claim', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB] = await ethers.getSigners()

    const allocationAmount = 100
    const claimAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, token.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationAmount)

    const startBlock = (await ethers.provider.getBlock()).number
    await expect(allocations.connect(accountB).increaseClaim(claimAmount))
      .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, claimAmount)

    await expect(allocations.connect(accountB).enactClaim())
      .to.be.reverted

    await advanceTime(startBlock + 10 + 2) // +2 to make sure the to.be.reverted checks aren't triggered by block number

    await token.mock.transfer.withArgs(accountB.address, claimAmount).reverts()
    await expect(allocations.connect(accountB).enactClaim())
      .to.be.reverted

    await token.mock.transfer.withArgs(accountB.address, claimAmount).returns(true)

    await expect(allocations.connect(accountA).enactClaim())
      .to.be.reverted
    await expect(allocations.connect(accountVoting).enactClaim())
      .to.be.reverted

    await expect(allocations.connect(accountB).enactClaim())
      .to.emit(allocations, 'ClaimEnacted').withArgs(accountB.address, claimAmount)
  })

  it('Create and revoke claim', async function () {
    const IERC20 = await hre.artifacts.readArtifact('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20')
    const Allocations = await ethers.getContractFactory('Allocations')
    const [accountA, accountVoting, accountB, accountGlobalSupervisor, accountSupervisor, accountC] = await ethers.getSigners()

    const allocationAmount = 100
    const claimAmount = 10

    const token = await waffle.deployMockContract(accountA, IERC20.abi)
    const allocations = await Allocations.deploy(accountVoting.address, token.address, 10, [accountGlobalSupervisor.address])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationAmount)
    await expect(allocations.connect(accountVoting).setSupervisor(accountB.address, accountSupervisor.address, true))
      .to.not.be.reverted

    for (const revoker of [accountGlobalSupervisor, accountSupervisor, accountVoting, accountB]) {
      const startBlock = (await ethers.provider.getBlock()).number
      await expect(allocations.connect(accountB).increaseClaim(claimAmount))
        .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, claimAmount)

      await advanceTime(startBlock + 5)

      await expect(allocations.connect(revoker).revokeClaim(accountB.address))
        .to.emit(allocations, 'ClaimRevoked').withArgs(accountB.address, claimAmount)

      await advanceTime(startBlock + 10)

      await expect(allocations.connect(accountB).enactClaim())
        .to.be.reverted
    }

    {
      const startBlock = (await ethers.provider.getBlock()).number
      await expect(allocations.connect(accountB).increaseClaim(claimAmount))
        .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, claimAmount)

      await advanceTime(startBlock + 5)

      await expect(allocations.connect(accountC).revokeClaim(accountB.address))
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
    const allocations = await Allocations.deploy(accountVoting.address, token.address, 10, [])
    await allocations.deployTransaction.wait()

    await expect(allocations.connect(accountVoting).setLockDuration(accountB.address, '0x' + 'FF'.repeat(256/8)))
      .to.not.be.reverted

    await expect(allocations.connect(accountVoting).increaseAllocation(accountB.address, allocationAmount))
      .to.emit(allocations, 'AllocationChanged').withArgs(accountB.address, allocationAmount)

    const startBlock = (await ethers.provider.getBlock()).number
    await expect(allocations.connect(accountB).increaseClaim(claimAmount))
      .to.emit(allocations, 'ClaimProposed').withArgs(accountB.address, claimAmount)

    await token.mock.transfer.withArgs(accountB.address, claimAmount).returns(true)
    await expect(allocations.connect(accountB).enactClaim())
      .to.emit(allocations, 'ClaimEnacted').withArgs(accountB.address, claimAmount)
  })
})
