const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('Locker', function () { // TODO: Use mock instead of actual wizard files
  async function advanceTime (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine') // hardhat_mine
    }
  }

  async function deploy () {
    const LockedApocryphToken = await ethers.getContractFactory('LockedApocryphToken')
    const ApocryphToken = await ethers.getContractFactory('ApocryphToken')
    const ApocryphLocker = await ethers.getContractFactory('ApocryphLocker')

    const apocryphToken = await upgrades.deployProxy(ApocryphToken)
    const lockedApocryphToken = await upgrades.deployProxy(LockedApocryphToken)
    const apocryphLocker = await upgrades.deployProxy(ApocryphLocker, [apocryphToken.address, lockedApocryphToken.address])

    await lockedApocryphToken.grantRole(ethers.utils.id('MINTER_ROLE'), apocryphLocker.address)

    return { locker: apocryphLocker, token: apocryphToken, lockedToken: lockedApocryphToken }
  }

  it('Basic deploy', async function () {
    await deploy()
  })

  it('Lock / unlock', async function () {
    const { locker, token, lockedToken } = await deploy()
    const [deployer, user] = await ethers.getSigners()

    await locker.setLockTime(100)
    await token.connect(deployer).transfer(user.address, ethers.FixedNumber.from('4'))
    await token.connect(user).approve(locker.address, ethers.FixedNumber.from('2'))
    await lockedToken.connect(user).approve(locker.address, ethers.FixedNumber.from('2'))

    const lockStartBlock = (await ethers.provider.getBlock()).number

    const tx1 = locker.connect(user).lock(ethers.FixedNumber.from('1.5'))
    await expect(tx1).to.emit(locker, 'Locked').withArgs(user.address, ethers.FixedNumber.from('1.5'))
    await expect(tx1).to.emit(token, 'Transfer').withArgs(user.address, locker.address, ethers.FixedNumber.from('1.5'))
    await expect(tx1).to.emit(lockedToken, 'Transfer').withArgs(nilAddress, user.address, ethers.FixedNumber.from('1.5'))

    expect(await token.allowance(user.address, locker.address)).to.equal(ethers.FixedNumber.from('0.5'))
    expect(await lockedToken.balanceOf(user.address)).to.equal(ethers.BigNumber.from(ethers.FixedNumber.from('1.5')))
    expect(await token.balanceOf(user.address)).to.equal(ethers.BigNumber.from(ethers.FixedNumber.from('2.5')))

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('1.5'))).to.be.reverted

    await advanceTime((await locker.lockTime()).add(lockStartBlock))

    const tx2 = locker.connect(user).unlock(ethers.FixedNumber.from('1'))
    await expect(tx2).to.emit(locker, 'Unlocked').withArgs(user.address, ethers.FixedNumber.from('1'))
    await expect(tx2).to.emit(token, 'Transfer').withArgs(locker.address, user.address, ethers.FixedNumber.from('1'))
    await expect(tx2).to.emit(lockedToken, 'Transfer').withArgs(user.address, nilAddress, ethers.FixedNumber.from('1'))

    expect(await lockedToken.allowance(user.address, locker.address)).to.equal(ethers.FixedNumber.from('1'))
    expect(await lockedToken.balanceOf(user.address)).to.equal(ethers.BigNumber.from(ethers.FixedNumber.from('0.5')))
    expect(await token.balanceOf(user.address)).to.equal(ethers.BigNumber.from(ethers.FixedNumber.from('3.5')))

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('0.5'))).to.emit(locker, 'Unlocked', [user.address, ethers.FixedNumber.from('0.5')])

    expect(await lockedToken.allowance(user.address, locker.address)).to.equal(ethers.FixedNumber.from('0.5'))
    expect(await lockedToken.balanceOf(user.address)).to.equal(ethers.BigNumber.from(ethers.FixedNumber.from('0')))
    expect(await token.allowance(user.address, locker.address)).to.equal(ethers.FixedNumber.from('0.5'))
    expect(await token.balanceOf(user.address)).to.equal(ethers.BigNumber.from(ethers.FixedNumber.from('4')))
  })

  it('Overlapping Lock / unlock', async function () {
    const { locker, token, lockedToken } = await deploy()
    const [deployer, user] = await ethers.getSigners()

    await locker.setLockTime(100)
    await token.connect(deployer).transfer(user.address, ethers.FixedNumber.from('4'))
    await token.connect(user).approve(locker.address, ethers.FixedNumber.from('2'))
    await lockedToken.connect(user).approve(locker.address, ethers.FixedNumber.from('2'))

    const lock1StartBlock = (await ethers.provider.getBlock()).number
    await expect(locker.connect(user).lock(ethers.FixedNumber.from('1'))).to.not.be.reverted

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('1'))).to.be.reverted

    await advanceTime((await locker.lockTime()).div(2).add(lock1StartBlock))

    const lock2StartBlock = (await ethers.provider.getBlock()).number
    await expect(locker.connect(user).lock(ethers.FixedNumber.from('0.5'))).to.not.be.reverted

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('0.5'))).to.be.reverted

    await advanceTime((await locker.lockTime()).add(lock1StartBlock))

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('0.3'))).to.not.be.reverted
    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('0.7'))).to.not.be.reverted

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('0.5'))).to.be.reverted

    await advanceTime((await locker.lockTime()).add(lock2StartBlock))

    await expect(locker.connect(user).unlock(ethers.FixedNumber.from('0.5'))).to.not.be.reverted
  })
})
