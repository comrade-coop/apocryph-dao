const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)
const oneAddress = '0x' + '00'.repeat(19) + '01'

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
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await Group.deploy([accountA.address, accountB.address], [], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineQuorumVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10, 10, 0)
    await voting.deployTransaction.wait()

    await expect(group.connect(accountA).setOwner(voting.address))
      .to.not.be.reverted
  })

  it('Proposer ACL', async function () {
    const Group = await ethers.getContractFactory('Group')
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountOwner, accountMember, accountOther] = await ethers.getSigners()

    const group = await Group.deploy([accountMember.address], [], accountOwner.address)
    await group.deployTransaction.wait()

    const actionsBytes = ethers.utils.defaultAbiCoder.encode(['(address,bytes)[]'], [[]])
    const actionsHash = ethers.utils.keccak256(actionsBytes)
    const rationaleHash = ethers.utils.id('Test rationale')

    for (const [acl, notRevert, revert] of [
      [nilAddress, [accountOwner, accountMember, accountOther], []],
      [oneAddress, [accountMember], [accountOwner, accountOther]],
      [accountOther.address, [accountOther], [accountOwner, accountMember]]
    ]) {
      const voting = await DeadlineQuorumVoting.deploy(accountOwner.address, acl, nilAddress, group.address, 10, 10, 0)
      await voting.deployTransaction.wait()

      for (const account of notRevert) {
        await expect(voting.connect(account).propose(rationaleHash, actionsHash))
          .to.not.be.reverted
      }

      for (const account of revert) {
        await expect(voting.connect(account).propose(rationaleHash, actionsHash))
          .to.be.reverted
      }
    }
  })

  it('Propose/Enact setDeadline', async function () {
    const Group = await ethers.getContractFactory('Group')
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await Group.deploy([accountA.address, accountB.address], [], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineQuorumVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10, 20, 0)
    await voting.deployTransaction.wait()

    const setVoteDeadlineData = voting.interface.encodeFunctionData('setVoteDeadline', [15])
    const actions = [[voting.address, setVoteDeadlineData]]
    const actionsBytes = ethers.utils.defaultAbiCoder.encode(['(address,bytes)[]'], [actions])
    const actionsHash = ethers.utils.keccak256(actionsBytes)
    const rationaleHash = ethers.utils.id('Test rationale') // <- should be stored in IPFS

    const voteStart = (await ethers.provider.getBlock()).number
    await expect(voting.propose(rationaleHash, actionsHash))
      .to.emit(voting, 'Proposal').withArgs(0, rationaleHash)

    expect(await voting.voteDeadline()).to.equal(10)

    await expect(voting.connect(accountA).vote(0, 1))
      .to.emit(voting, 'Vote').withArgs(0, accountA.address, 1)
    await expect(voting.enact(0, actions))
      .to.be.reverted // Too early

    await advanceTime(voteStart + 10)

    await expect(voting.connect(accountB).vote(0, 1))
      .to.be.reverted // Too late
    await expect(voting.enact(0, actions))
      .to.be.reverted // Too early

    await advanceTime(voteStart + 20)

    await expect(voting.enact(0, actions))
      .to.emit(voting, 'Enaction').withArgs(0)
    await expect(voting.enact(0, actions))
      .to.be.reverted // Reentrancy check

    expect(await voting.voteDeadline()).to.equal(15)
  })

  it('Uses checkpointed weights', async function () {
    const Group = await ethers.getContractFactory('Group')
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountOwner, accountA, accountB] = await ethers.getSigners()

    const group = await Group.deploy([accountA.address], [], accountOwner.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineQuorumVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10, 10, 0)
    await voting.deployTransaction.wait()
    const rationaleHash = ethers.utils.id('Test rationale')

    await expect(voting.propose(rationaleHash, ethers.utils.id('Invalid actions hash')))
      .to.emit(voting, 'Proposal').withArgs(0, rationaleHash)

    await expect(voting.connect(accountA).vote(0, 1))
      .to.emit(voting, 'Vote').withArgs(0, accountA.address, 1)

    await expect(voting.connect(accountB).vote(0, 1))
      .to.be.reverted

    await expect(group.connect(accountOwner).modifyWeightOf(accountB.address, 1))
      .to.not.be.reverted

    await expect(voting.connect(accountB).vote(0, 1))
      .to.be.reverted
  })

  it('Uses delegated weights', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountA, accountB, accountC, accountD] = await ethers.getSigners()

    const group = await DelegatedGroup.deploy([accountA.address, accountB.address, accountC.address, accountD.address], [11, 12, 13, 14], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineQuorumVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 10, 10, 0)
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

    const rationaleHash = ethers.utils.id('Test rationale')
    await expect(voting.propose(rationaleHash, ethers.utils.id('Invalid actions hash')))
      .to.emit(voting, 'Proposal').withArgs(0, rationaleHash)

    await expect(voting.connect(accountB).vote(0, 2))
      .to.emit(voting, 'Vote').withArgs(0, accountB.address, 2)
    expect((await voting.voteCounts(0)).toString()).to.equal([0, 11 + 12].toString())

    await expect(voting.connect(accountA).vote(0, 1))
      .to.emit(voting, 'Vote').withArgs(0, accountA.address, 1)
    expect((await voting.voteCounts(0)).toString()).to.equal([11, 12].toString())

    await expect(voting.connect(accountD).vote(0, 2))
      .to.emit(voting, 'Vote').withArgs(0, accountD.address, 2)
    expect((await voting.voteCounts(0)).toString()).to.equal([11, 12 + 13 + 14].toString())

    await expect(voting.connect(accountC).vote(0, 1))
      .to.emit(voting, 'Vote').withArgs(0, accountC.address, 1)
    expect((await voting.voteCounts(0)).toString()).to.equal([11 + 13, 12 + 14].toString())
  })

  it('Requires majority weight', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountA, accountB, accountC, accountD] = await ethers.getSigners()

    const emptyActionsBytes = ethers.utils.defaultAbiCoder.encode(['(address,bytes)[]'], [[]])
    const emptyActionsHash = ethers.utils.keccak256(emptyActionsBytes)
    const rationaleHash = ethers.utils.id('Test rationale')

    const group = await DelegatedGroup.deploy([accountA.address, accountB.address, accountC.address, accountD.address], [1, 1, 1, 100], accountA.address)
    await group.deployTransaction.wait()
    const voting = await DeadlineQuorumVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 0, 0, 0)
    await voting.deployTransaction.wait()

    await expect(voting.propose(rationaleHash, emptyActionsHash))
      .to.emit(voting, 'Proposal').withArgs(0, rationaleHash)

    await expect(voting.connect(accountA).vote(0, 1)).to.emit(voting, 'Vote').withArgs(0, accountA.address, 1)

    await expect(voting.connect(accountB).vote(0, 2)).to.emit(voting, 'Vote').withArgs(0, accountB.address, 2)

    await expect(voting.enact(0, [])).to.be.reverted

    await expect(voting.connect(accountC).vote(0, 1)).to.emit(voting, 'Vote').withArgs(0, accountC.address, 1)

    await expect(voting.enact(0, [])).to.emit(voting, 'Enaction').withArgs(0)
  })

  it('Requires quorum weights', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const DeadlineQuorumVoting = await ethers.getContractFactory('DeadlineQuorumVoting')
    const [accountA, accountB, accountC] = await ethers.getSigners()

    const emptyActionsBytes = ethers.utils.defaultAbiCoder.encode(['(address,bytes)[]'], [[]])
    const emptyActionsHash = ethers.utils.keccak256(emptyActionsBytes)
    const rationaleHash = ethers.utils.id('Test rationale')

    const pow2_256 = ethers.BigNumber.from('0x1' + '00'.repeat(32))

    for (let [totalWeight, requiredWeight] of [['1000', '10'], ['100000001', '1000003'], ['289316867188186346105704724647', '840137318418557180096497']]) {

      totalWeight = ethers.BigNumber.from(totalWeight)
      requiredWeight = ethers.BigNumber.from(requiredWeight)

      const requiredQuorum = pow2_256.mul(requiredWeight.add(1)).div(totalWeight)

      const roundedRequiredWeight = totalWeight.mul(requiredQuorum).div(pow2_256)

      expect(roundedRequiredWeight).to.lte(requiredWeight)
      expect(roundedRequiredWeight).to.gte(requiredWeight.sub(1))

      const group = await DelegatedGroup.deploy([accountA.address, accountB.address, accountC.address], [roundedRequiredWeight.sub(1), 1, totalWeight.sub(roundedRequiredWeight)], accountA.address)
      await group.deployTransaction.wait()
      expect(await group.totalWeightAt((await ethers.provider.getBlock()).number)).to.equal(totalWeight)
      const voting = await DeadlineQuorumVoting.deploy(nilAddress, nilAddress, nilAddress, group.address, 0, 0, requiredQuorum)
      await voting.deployTransaction.wait()

      await expect(voting.propose(rationaleHash, emptyActionsHash))
        .to.emit(voting, 'Proposal').withArgs(0, rationaleHash)

      expect(await voting.requiredQuorum(0)).to.equal(roundedRequiredWeight)

      await expect(voting.connect(accountA).vote(0, 1)).to.emit(voting, 'Vote').withArgs(0, accountA.address, 1)

      await expect(voting.enact(0, [])).to.be.reverted

      await expect(voting.connect(accountB).vote(0, 2)).to.emit(voting, 'Vote').withArgs(0, accountB.address, 2)

      await expect(voting.enact(0, [])).to.emit(voting, 'Enaction').withArgs(0)
    }
  })
})
