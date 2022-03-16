const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('Vesting', function () { // TODO: Use mock instead of actual wizard files
  async function advanceTimestamp (toTimestamp) {
    const currentTimestamp = (await ethers.provider.getBlock()).timestamp
    expect(toTimestamp).to.be.gte(currentTimestamp)
    await network.provider.send('evm_mine', [toTimestamp]) // hardhat_mine
  }

  async function deploy (owner) {
    const ApocryphToken = await ethers.getContractFactory('ApocryphToken')
    const ApocryphVesting = await ethers.getContractFactory('ApocryphVesting')

    const apocryphToken = await upgrades.deployProxy(ApocryphToken, [owner])
    // await upgrades.prepareUpgrade(ApocryphVesting)

    return { token: apocryphToken, deployVestingContract: (beneficiary, start, duration, installments) => upgrades.deployProxy(ApocryphVesting, [owner, beneficiary, start, duration, installments]) }
  }

  it('Basic deploy', async function () {
    const [deployer] = await ethers.getSigners()
    await deploy(deployer.address)
  })

  it('Vest', async function () {
    const [deployer, owner, receiver] = await ethers.getSigners()
    const { token, deployVestingContract } = await deploy(owner.address)

    const startTimestamp = (await ethers.provider.getBlock()).timestamp

    const freq = 8
    const duration = 200
    const installments = 7
    const amount = 1000000000

    const vestingReceiver = await deployVestingContract(receiver.address, startTimestamp, duration, installments)

    await token.connect(owner).transfer(vestingReceiver.address, amount)

    const testStartTimestamp = (await ethers.provider.getBlock()).timestamp

    expect(await token.balanceOf(receiver.address)).to.eq(0)
    expect(await token.balanceOf(vestingReceiver.address)).to.eq(amount)

    for (let timestamp = testStartTimestamp + freq; timestamp < startTimestamp + duration + 3 * freq; timestamp += freq) {
      await advanceTimestamp(timestamp)

      await vestingReceiver['release(address)'](token.address);

      const currentTimestamp = (await ethers.provider.getBlock()).timestamp

      const timePassed = currentTimestamp - startTimestamp
      const installment = Math.floor(timePassed / duration * installments)
      const cappedInstallment = installment > installments ? installments : installment
      const amountTransferred = Math.floor(amount * cappedInstallment / installments)

      // console.log(timePassed, installment, amountTransferred)

      expect(await token.balanceOf(receiver.address)).to.eq(amountTransferred)
      expect(await token.balanceOf(vestingReceiver.address)).to.eq(amount - amountTransferred)

    }
  })
})

