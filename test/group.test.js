const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('DelegatedGroup', function () {
  it('Basic deployment', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const [accountA, accountB, accountC] = await ethers.getSigners()

    const group = await DelegatedGroup.deploy([accountA.address, accountB.address], [3], nilAddress)
    await group.deployTransaction.wait()

    expect(await group.weightOf(accountA.address)).to.equal(3)
    expect(await group.weightOf(accountB.address)).to.equal(1)
    expect(await group.weightOf(accountC.address)).to.equal(0)
  })

  it('Modify weight', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await DelegatedGroup.deploy([], [], nilAddress)
    await group.deployTransaction.wait()

    await expect(group.modifyWeightOf(accountA.address, 3)).to.emit(group, 'WeightChanged').withArgs(accountA.address, 3)
    await expect(group.modifyWeightOf(accountA.address, 2)).to.emit(group, 'WeightChanged').withArgs(accountA.address, 5)
    await expect(group.modifyWeightOf(accountA.address, -4)).to.emit(group, 'WeightChanged').withArgs(accountA.address, 1)
    await expect(group.modifyWeightOf(accountA.address, -8)).to.be.reverted
    expect(await group.weightOf(accountA.address)).to.equal(1)
    await expect(group.connect(accountB).modifyWeightOf(accountA.address, 3)).to.be.reverted
  })

  it('Delegate weight', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const [accountA, accountB, accountC, accountD] = await ethers.getSigners()

    const group = await DelegatedGroup.deploy([accountA.address, accountB.address, accountC.address], [1, 2, 3], nilAddress)
    await group.deployTransaction.wait()

    const tx1 = group.connect(accountA).delegate(accountB.address)
    await expect(tx1).to.emit(group, 'DelegateChanged').withArgs(accountA.address, accountB.address)
    await expect(tx1).to.emit(group, 'WeightChanged').withArgs(accountB.address, 3)

    const tx2 = group.connect(accountB).delegate(accountD.address)
    await expect(tx2).to.emit(group, 'DelegateChanged').withArgs(accountB.address, accountD.address)
    await expect(tx2).to.emit(group, 'WeightChanged').withArgs(accountD.address, 3)

    const tx3 = group.connect(accountC).delegate(accountB.address)
    await expect(tx3).to.emit(group, 'DelegateChanged').withArgs(accountC.address, accountB.address)
    await expect(tx3).to.emit(group, 'WeightChanged').withArgs(accountB.address, 6)
    await expect(tx3).to.emit(group, 'WeightChanged').withArgs(accountD.address, 6)
  })

  it('Modify delegated weight', async function () {
    const DelegatedGroup = await ethers.getContractFactory('DelegatedGroup')
    const [accountA, accountB] = await ethers.getSigners()

    const group = await DelegatedGroup.deploy([accountA.address, accountB.address], [7, 6], nilAddress)
    await group.deployTransaction.wait()

    const tx1 = group.modifyWeightOf(accountA.address, -4)
    await expect(tx1).to.emit(group, 'WeightChanged').withArgs(accountA.address, 3)

    const tx2 = group.connect(accountA).delegate(accountB.address)
    await expect(tx2).to.emit(group, 'DelegateChanged').withArgs(accountA.address, accountB.address)
    await expect(tx2).to.emit(group, 'WeightChanged').withArgs(accountB.address, 9)

    const tx3 = group.modifyWeightOf(accountA.address, 4)
    await expect(tx3).to.emit(group, 'WeightChanged').withArgs(accountA.address, 7)
    await expect(tx3).to.emit(group, 'WeightChanged').withArgs(accountB.address, 13)
  })

  // NOTE: Edge case intentionally not tested: It is currently possible to modify the weight of a group member in such a way that other members cannot un-delegate from him; a negative own weight. As the code required to safeguard against such misuse will require extra gas, and group is supposed to be as lightweight, it is the responsibility of the owner of the group to make sure this does not occur.
})
