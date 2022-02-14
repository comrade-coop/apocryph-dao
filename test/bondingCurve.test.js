const { expect } = require('chai')

const nilAddress = '0x' + '00'.repeat(20)

describe('Bonding curve', function () {
  async function advanceTime (toBlock) {
    const currentBlock = (await ethers.provider.getBlock()).number
    expect(toBlock).to.be.gte(currentBlock)
    for (let i = currentBlock; i < toBlock; i++) {
      await network.provider.send('evm_mine')
    }
  }

  it('Basic deploy', async function () {
    const TestERC20 = await ethers.getContractFactory('TestERC20')
    const BondingCurve = await ethers.getContractFactory('BondingCurve')
    const [accountA, accountBeneficiary] = await ethers.getSigners()
    const tokenASupply = 100000

    const tokenA = await TestERC20.deploy('Test1', [accountA.address], [tokenASupply])
    await tokenA.deployTransaction.wait()

    const tokenB = await TestERC20.deploy('Test2', [], [])
    await tokenB.deployTransaction.wait()

    const bondingCurve = await BondingCurve.deploy(
      tokenA.address, tokenB.address, accountBeneficiary.address,
      tokenASupply,
      10, 33, 1, // from price=10 to price=33
      1, 100, // tax=1/100
      tokenASupply * 0.01, 30)
    await bondingCurve.deployTransaction.wait()

    await tokenA.connect(accountA).transfer(bondingCurve.address, tokenASupply)
  })

  it('Price is linear', async function () {
    const TestERC20 = await ethers.getContractFactory('TestERC20')
    const BondingCurve = await ethers.getContractFactory('BondingCurve')
    const [accountA] = await ethers.getSigners()

    const tokenA = await TestERC20.deploy('Test1', [accountA.address], [100000000])
    await tokenA.deployTransaction.wait()

    const tokenB = await TestERC20.deploy('Test2', [], [])
    await tokenB.deployTransaction.wait()

    await Promise.all([[53, 3, 10], [103, 5, 23], [20, 0, 20]].map(
      async ([tokenASupply, initialPrice, finalPrice]) => {
        const bondingCurve = await BondingCurve.deploy(
          tokenA.address, tokenB.address, accountA.address,
          tokenASupply,
          initialPrice, finalPrice, 1,
          0, 1, // tax=0/1
          0, 30)
        await bondingCurve.deployTransaction.wait()
        await tokenA.connect(accountA).transfer(bondingCurve.address, tokenASupply)

        let lastValue
        for (let i = 0; i <= tokenASupply; i++) {
          const value = await bondingCurve.calculateDueBalanceB(tokenASupply - i)
          if (lastValue !== undefined) {
            const price = (lastValue - value)
            const interpolatedPrice = (initialPrice + (finalPrice - initialPrice) * i / tokenASupply)
            expect(Math.abs(price - interpolatedPrice)).to.be.at.most(1)
          }
          lastValue = value
        }
        expect(lastValue).to.equal(0)
      }
    ))
  })

  it('Buy/sell', async function () {
    const TestERC20 = await ethers.getContractFactory('TestERC20')
    const BondingCurve = await ethers.getContractFactory('BondingCurve')
    const [accountA, accountB, accountBeneficiary] = await ethers.getSigners()
    const tokenASupply = 20
    const initialBalanceB = tokenASupply * (tokenASupply + 1) / 2

    const tokenA = await TestERC20.deploy('Test1', [accountA.address], [tokenASupply])
    await tokenA.deployTransaction.wait()
    const tokenB = await TestERC20.deploy('Test2', [accountB.address], [initialBalanceB])
    await tokenB.deployTransaction.wait()
    const bondingCurve = await BondingCurve.deploy(
      tokenA.address, tokenB.address, accountBeneficiary.address,
      tokenASupply,
      0, tokenASupply, 1,
      0, 1, // tax=0/1
      0, 30)
    await bondingCurve.deployTransaction.wait()
    await tokenA.connect(accountA).transfer(bondingCurve.address, tokenASupply)

    let balanceB = initialBalanceB

    await tokenB.connect(accountB).approve(bondingCurve.address, balanceB)

    console.log("Buying")
    for (let i = 1; i <= tokenASupply; i++) {

      var buyAmount = 1
      var balanceA =  await bondingCurve.connect(accountB).balanceA()
      var price = await bondingCurve.connect(accountB).getBuyPrice()
      var buyPrice = await bondingCurve.connect(accountB).getBuyTotal(buyAmount)

      console.log(
        "| Remaining balance: " + ethers.FixedNumber.fromValue(balanceA, 0).toString() +
        "| Price: " + ethers.FixedNumber.fromValue(price, 0).toString() +
        "| Buy Amount: " + buyAmount +
        "| Total Price: " + ethers.FixedNumber.fromValue(buyPrice, 0).toString())

      balanceB -= i

      await expect(bondingCurve.connect(accountB).buy(1, i, nilAddress))
        .to.emit(bondingCurve, 'Buy').withArgs(accountB.address, 1, i)

      expect(await tokenB.balanceOf(accountB.address)).to.equal(balanceB)
    }

    expect(await tokenB.balanceOf(accountB.address)).to.equal(0) // Sanity check

    await tokenA.connect(accountB).approve(bondingCurve.address, tokenASupply)

    console.log("Selling")
    for (let i = tokenASupply; i >= 1; i--) {

      var sellAmount = 1
      var balanceA =  await bondingCurve.connect(accountB).balanceA()
      var price = await bondingCurve.connect(accountB).getSellPrice()
      var buyPrice = await bondingCurve.connect(accountB).getSellTotal(sellAmount)

      console.log(
        "| Remaining balance: " + ethers.FixedNumber.fromValue(balanceA, 0).toString() +
        "| Price: " + ethers.FixedNumber.fromValue(price, 0).toString() +
        "| Sell Amount: " + sellAmount +
        "| Total Price: " + ethers.FixedNumber.fromValue(buyPrice, 0).toString())

      balanceB += i

      await expect(bondingCurve.connect(accountB).sell(1, i, nilAddress))
        .to.emit(bondingCurve, 'Sell').withArgs(accountB.address, 1, i)

      expect(await tokenB.balanceOf(accountB.address)).to.equal(balanceB)
    }

    expect(await tokenB.balanceOf(accountB.address)).to.equal(balanceB)
  })

  it('Tax/withdraw', async function () {
    const TestERC20 = await ethers.getContractFactory('TestERC20')
    const BondingCurve = await ethers.getContractFactory('BondingCurve')
    const [accountA, accountB, accountBeneficiary] = await ethers.getSigners()
    const tokenASupply = 2000000
    const initialBalanceB = 50000000

    const tokenA = await TestERC20.deploy('Test1', [accountA.address], [tokenASupply])
    await tokenA.deployTransaction.wait()
    const tokenB = await TestERC20.deploy('Test2', [accountB.address], [initialBalanceB])
    await tokenB.deployTransaction.wait()
    const bondingCurve = await BondingCurve.deploy(
      tokenA.address, tokenB.address, accountBeneficiary.address,
      tokenASupply,
      300, 10000, 1, // price = 300...10000
      1, 100, // tax = 1%
      0, 30)
    await bondingCurve.deployTransaction.wait()
    await tokenA.connect(accountA).transfer(bondingCurve.address, tokenASupply)

    const balanceBPre = await tokenB.balanceOf(accountB.address)

    await tokenB.connect(accountB).approve(bondingCurve.address, initialBalanceB)
    await bondingCurve.connect(accountB).buy(100, initialBalanceB, nilAddress)

    const balanceBPost = await tokenB.balanceOf(accountB.address)

    const preTaxAmountB = balanceBPre.sub(balanceBPost)

    const tax = await bondingCurve.withdrawableAmount()

    expect(tax).to.equal(preTaxAmountB.div(100))
    expect(await tokenB.balanceOf(bondingCurve.address)).to.equal(preTaxAmountB)

    await bondingCurve.connect(accountBeneficiary).withdraw(nilAddress, tax)
    expect(await tokenB.balanceOf(accountBeneficiary.address)).to.equal(tax)

    await tokenA.connect(accountB).approve(bondingCurve.address, 100)
    await bondingCurve.connect(accountB).sell(100, 0, nilAddress)

    expect(await tokenB.balanceOf(bondingCurve.address)).to.equal(0)
    expect(await tokenB.balanceOf(accountB.address)).to.equal(balanceBPre.sub(tax))
    expect(await tokenB.balanceOf(accountBeneficiary.address)).to.equal(tax)
  })

  it('Transition/withdraw', async function () {
    const TestERC20 = await ethers.getContractFactory('TestERC20')
    const BondingCurve = await ethers.getContractFactory('BondingCurve')
    const [accountA, accountB, accountBeneficiary] = await ethers.getSigners()

    const initialSupply = 200
    const transitionAmount = 10
    const transitionBlocks = 10

    const tokenA = await TestERC20.deploy('Test1', [accountA.address], [initialSupply])
    await tokenA.deployTransaction.wait()
    const tokenB = await TestERC20.deploy('Test2', [accountB.address], [initialSupply])
    await tokenB.deployTransaction.wait()
    const bondingCurve = await BondingCurve.deploy(
      tokenA.address, tokenB.address, accountBeneficiary.address,
      initialSupply,
      1, 1, 1, // price = 1 always
      0, 1, // tax = 0
      transitionAmount, transitionBlocks)
    await bondingCurve.deployTransaction.wait()
    await tokenA.connect(accountA).transfer(bondingCurve.address, initialSupply)

    await tokenB.connect(accountB).approve(bondingCurve.address, initialSupply + 1)
    await tokenA.connect(accountB).approve(bondingCurve.address, 1)

    let startBlock = (await ethers.provider.getBlock()).number
    await expect(bondingCurve.connect(accountB).buy(initialSupply - transitionAmount, initialSupply - transitionAmount, nilAddress))
      .to.emit(bondingCurve, 'TransitionStart')

    expect(await tokenB.balanceOf(accountBeneficiary.address)).to.equal(0)

    await advanceTime(startBlock + transitionBlocks / 2)

    await expect(bondingCurve.enactTransition())
      .to.be.reverted

    await advanceTime(startBlock + transitionBlocks + 1)

    await expect(bondingCurve.enactTransition())
      .to.be.reverted // We still have 10 A tokens to sell

    await expect(bondingCurve.connect(accountB).sell(1, 1, nilAddress))
      .to.emit(bondingCurve, 'TransitionCancel')

    startBlock = (await ethers.provider.getBlock()).number
    await expect(bondingCurve.connect(accountB).buy(transitionAmount + 1, transitionAmount + 1, nilAddress))
      .to.emit(bondingCurve, 'TransitionStart')

    await advanceTime(startBlock + transitionBlocks + 1)

    await expect(bondingCurve.enactTransition())
      .to.emit(bondingCurve, 'TransitionEnd')

    await bondingCurve.connect(accountBeneficiary).withdraw(nilAddress, initialSupply)
    expect(await tokenB.balanceOf(accountBeneficiary.address)).to.equal(initialSupply)
  })
})
