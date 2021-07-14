const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('DeadlingVoting', function () {
  async function advanceTime (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine')
    }
  }

  it('Basic deployment', async function () {
    const Group = await ethers.getContractFactory('Group')
    const DeadlineVoting = await ethers.getContractFactory('DeadlineVoting')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await Group.deploy([accountA.address, accountB.address], [], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10)
    await voting.deployTransaction.wait()

    await expect(group.connect(accountA).setOwner(voting.address))
      .to.not.be.reverted
  })

  it('Propose/Enact setDeadline', async function () {
    const Group = await ethers.getContractFactory('Group')
    const DeadlineVoting = await ethers.getContractFactory('DeadlineVoting')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await Group.deploy([accountA.address, accountB.address], [], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10)
    await voting.deployTransaction.wait()

    const setVoteDeadlineData = voting.interface.encodeFunctionData('setVoteDeadline', [15])
    const actions = [[voting.address, setVoteDeadlineData]]
    const actionsBytes = ethers.utils.defaultAbiCoder.encode(['(address,bytes)[]'], [actions])
    const actionsHash = ethers.utils.keccak256(actionsBytes)
    const rationaleHash = ethers.utils.id('Test rationale') // <- should be stored in IPFS

    const voteStart = (await ethers.provider.getBlock()).number
    await expect(voting.propose(rationaleHash, actionsHash))
      .to.emit(voting, 'Proposal').withArgs(1)

    expect(await voting.voteDeadline()).to.equal(10)

    await expect(voting.connect(accountA).vote(1, 1))
      .to.emit(voting, 'Vote').withArgs(1, accountA.address, 1)

    await expect(voting.enact(1, actions))
      .to.be.reverted // Too early

    await advanceTime(voteStart + 10)

    await expect(voting.connect(accountB).vote(1, 1))
      .to.be.reverted // Too late

    await expect(voting.enact(1, actions))
      .to.emit(voting, 'Enaction').withArgs(1)

    await expect(voting.enact(1, actions))
      .to.be.reverted // Reentrancy check

    expect(await voting.voteDeadline()).to.equal(15)
  })

  it('Uses checkpointed weights', async function () {
    const Group = await ethers.getContractFactory('Group')
    const DeadlineVoting = await ethers.getContractFactory('DeadlineVoting')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await Group.deploy([accountA.address], [], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10)
    await voting.deployTransaction.wait()

    await expect(voting.propose(ethers.utils.id('Test rationale'), ethers.utils.id('Invalid actions hash')))
      .to.emit(voting, 'Proposal').withArgs(1)

    await expect(voting.connect(accountA).vote(1, 1))
      .to.emit(voting, 'Vote').withArgs(1, accountA.address, 1)

    await expect(voting.connect(accountB).vote(1, 1))
      .to.be.reverted

    await expect(group.connect(accountA).setWeightOf(accountB.address, 1))
      .to.not.be.reverted

    await expect(voting.connect(accountB).vote(1, 1))
      .to.be.reverted
  })

  it('Uses delegated weights', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const DeadlineVoting = await ethers.getContractFactory('DeadlineVoting')
    const [accountA, accountB, accountC, accountD] = await ethers.getSigners()

    const group = await DelegatedGroup.deploy([accountA.address, accountB.address, accountC.address, accountD.address], [11, 12, 13, 14], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10)
    await voting.deployTransaction.wait()

    // A -> B, B -> D, C -> D => A=11, B=23, C=13, D=50

    await expect(group.connect(accountA).delegate(accountB.address))
      .to.not.be.reverted
    await expect(group.connect(accountB).delegate(accountD.address))
      .to.not.be.reverted
    await expect(group.connect(accountC).delegate(accountD.address))
      .to.not.be.reverted

    await expect(group.connect(accountD).delegate(accountC.address))
      .to.be.reverted // Smoke test for DelegatedGroup

    await expect(voting.propose(ethers.utils.id('Test rationale'), ethers.utils.id('Invalid actions hash')))
      .to.emit(voting, 'Proposal').withArgs(1)

    await expect(voting.connect(accountB).vote(1, 2))
      .to.emit(voting, 'Vote').withArgs(1, accountB.address, 2)
    expect((await voting.voteCounts(1)).toString()).to.equal([0, 11+12].toString())

    await expect(voting.connect(accountA).vote(1, 1))
      .to.emit(voting, 'Vote').withArgs(1, accountA.address, 1)
    expect((await voting.voteCounts(1)).toString()).to.equal([11, 12].toString())

    await expect(voting.connect(accountD).vote(1, 2))
      .to.emit(voting, 'Vote').withArgs(1, accountD.address, 2)
    expect((await voting.voteCounts(1)).toString()).to.equal([11, 12+13+14].toString())

    await expect(voting.connect(accountC).vote(1, 1))
      .to.emit(voting, 'Vote').withArgs(1, accountC.address, 1)
    expect((await voting.voteCounts(1)).toString()).to.equal([11+13, 12+14].toString())
  })
})
