const { expect } = require('chai')

describe('TokenAgeToken', function () {
  it('Basic deployment', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const accounts = await ethers.getSigners()

    const initialBalances = Object.fromEntries(accounts.map((a, i) => [a.address, i * 100000]))

    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, Object.keys(initialBalances), Object.values(initialBalances))
    await token.deployTransaction.wait()

    expect(await token.name()).to.equal('Test Token')
    expect(await token.symbol()).to.equal('TEST')
    expect(await token.decimals()).to.equal(6)
    expect(await token.totalSupply()).to.equal(Object.values(initialBalances).reduce((a, b) => a + b))
    for (const [k, v] of Object.entries(initialBalances)) {
      expect(await token.balanceOf(k)).to.equal(v)
    }
  })
  it('ERC20 Transfer', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB] = await ethers.getSigners()

    const initialBalanceA = 1000
    const transferAmount = 400
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address], [initialBalanceA])
    await token.deployTransaction.wait()

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA)
    expect(await token.balanceOf(accountB.address)).to.equal(0)

    await expect(token.connect(accountB).transfer(accountA.address, transferAmount))
      .to.be.reverted

    await expect(token.connect(accountA).transfer(accountB.address, transferAmount))
      .to.emit(token, 'Transfer').withArgs(accountA.address, accountB.address, transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA - transferAmount)
    expect(await token.balanceOf(accountB.address)).to.equal(0 + transferAmount)

    await expect(token.connect(accountA).transfer(accountB.address, initialBalanceA))
      .to.be.reverted

    await expect(token.connect(accountA).transfer(accountB.address, initialBalanceA - transferAmount))
      .to.emit(token, 'Transfer').withArgs(accountA.address, accountB.address, initialBalanceA - transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(0)
    expect(await token.balanceOf(accountB.address)).to.equal(0 + initialBalanceA)
  })
  it('ERC20 Approve', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB, accountC] = await ethers.getSigners()

    const initialBalanceA = 1000
    const transferAmount = 400
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address], [initialBalanceA])
    await token.deployTransaction.wait()

    await expect(token.connect(accountA).approve(accountB.address, transferAmount))
      .to.emit(token, 'Approval').withArgs(accountA.address, accountB.address, transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA)
    expect(await token.balanceOf(accountB.address)).to.equal(0)
    expect(await token.balanceOf(accountC.address)).to.equal(0)
    expect(await token.allowance(accountA.address, accountB.address)).to.equal(transferAmount)

    await expect(token.connect(accountB).transferFrom(accountA.address, accountC.address, transferAmount))
      .to.emit(token, 'Transfer').withArgs(accountA.address, accountC.address, transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA - transferAmount)
    expect(await token.balanceOf(accountB.address)).to.equal(0)
    expect(await token.balanceOf(accountC.address)).to.equal(0 + transferAmount)
    expect(await token.allowance(accountA.address, accountB.address)).to.equal(0)

    await expect(token.connect(accountB).transferFrom(accountA.address, accountC.address, transferAmount))
      .to.be.reverted
  })

  it('ERC20+ Safe Approve', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB, accountC] = await ethers.getSigners()

    const initialBalanceA = 1000
    const transferAmount1 = 300
    const transferAmount2 = 400
    const transferAmount3 = 500
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address], [initialBalanceA])
    await token.deployTransaction.wait()

    await expect(token.connect(accountA).safeApprove(accountB.address, transferAmount1, 0))
      .to.emit(token, 'Approval').withArgs(accountA.address, accountB.address, transferAmount1)

    expect(await token.allowance(accountA.address, accountB.address)).to.equal(transferAmount1)

    await expect(token.connect(accountA).safeApprove(accountB.address, transferAmount2, 0))
      .to.be.reverted

    await expect(token.connect(accountA).safeApprove(accountB.address, transferAmount2, transferAmount1))
      .to.emit(token, 'Approval').withArgs(accountA.address, accountB.address, transferAmount2)

    expect(await token.allowance(accountA.address, accountB.address)).to.equal(transferAmount2)

    await expect(token.connect(accountB).transferFrom(accountA.address, accountC.address, transferAmount2))
      .to.emit(token, 'Transfer').withArgs(accountA.address, accountC.address, transferAmount2)

    await expect(token.connect(accountA).safeApprove(accountB.address, transferAmount3, transferAmount2))
      .to.be.reverted
  })

  it('ERC1363 TransferAndCall', async function () {
    const IERC1363Receiver = await hre.artifacts.readArtifact('IERC1363Receiver')
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA] = await ethers.getSigners()

    const initialBalanceA = 1000
    const transferAmount = 400
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address], [initialBalanceA])
    await token.deployTransaction.wait()

    const receiver = await waffle.deployMockContract(accountA, IERC1363Receiver.abi)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA)
    expect(await token.balanceOf(receiver.address)).to.equal(0)

    await receiver.mock.onTransferReceived.withArgs(accountA.address, accountA.address, transferAmount, '0x').returns('0x00000000')
    await expect(token.connect(accountA)['transferAndCall(address,uint256)'](receiver.address, transferAmount))
      .to.be.reverted

    await receiver.mock.onTransferReceived.withArgs(accountA.address, accountA.address, transferAmount, '0x').returns('0x88a7ca5c')
    await expect(token.connect(accountA)['transferAndCall(address,uint256)'](receiver.address, transferAmount))
      .to.emit(token, 'Transfer').withArgs(accountA.address, receiver.address, transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA - transferAmount)
    expect(await token.balanceOf(receiver.address)).to.equal(0 + transferAmount)
  })

  it('ERC1363 TransferFromAndCall', async function () {
    const IERC1363Receiver = await hre.artifacts.readArtifact('IERC1363Receiver')
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB] = await ethers.getSigners()

    const initialBalanceA = 1000
    const transferAmount = 400
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address], [initialBalanceA])
    await token.deployTransaction.wait()

    const receiver = await waffle.deployMockContract(accountA, IERC1363Receiver.abi)

    await expect(token.connect(accountA).approve(accountB.address, transferAmount))
      .to.emit(token, 'Approval').withArgs(accountA.address, accountB.address, transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA)
    expect(await token.balanceOf(accountB.address)).to.equal(0)
    expect(await token.balanceOf(receiver.address)).to.equal(0)
    expect(await token.allowance(accountA.address, accountB.address)).to.equal(transferAmount)

    await receiver.mock.onTransferReceived.withArgs(accountB.address, accountA.address, transferAmount, '0x').returns('0x00000000')
    await expect(token.connect(accountB)['transferFromAndCall(address,address,uint256)'](accountA.address, receiver.address, transferAmount))
      .to.be.reverted

    await receiver.mock.onTransferReceived.withArgs(accountB.address, accountA.address, transferAmount, '0x').returns('0x88a7ca5c')
    await expect(token.connect(accountB)['transferFromAndCall(address,address,uint256)'](accountA.address, receiver.address, transferAmount))
      .to.emit(token, 'Transfer').withArgs(accountA.address, receiver.address, transferAmount)

    expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA - transferAmount)
    expect(await token.balanceOf(accountB.address)).to.equal(0)
    expect(await token.balanceOf(receiver.address)).to.equal(0 + transferAmount)
    expect(await token.allowance(accountA.address, accountB.address)).to.equal(0)
  })

  it('ERC1363 ApproveAndCall', async function () {
    const IERC1363Spender = await hre.artifacts.readArtifact('IERC1363Spender')
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA] = await ethers.getSigners()

    const initialBalanceA = 1000
    const transferAmount = 400
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address], [initialBalanceA])
    await token.deployTransaction.wait()

    const spender = await waffle.deployMockContract(accountA, IERC1363Spender.abi)

    await spender.mock.onApprovalReceived.withArgs(accountA.address, transferAmount, '0x').returns('0x00000000')
    await expect(token.connect(accountA)['approveAndCall(address,uint256)'](spender.address, transferAmount))
      .to.be.reverted

    await spender.mock.onApprovalReceived.withArgs(accountA.address, transferAmount, '0x').returns('0x7b04a2d0')
    await expect(token.connect(accountA)['approveAndCall(address,uint256)'](spender.address, transferAmount))
      .to.emit(token, 'Approval').withArgs(accountA.address, spender.address, transferAmount)

    expect(await token.allowance(accountA.address, spender.address)).to.equal(transferAmount)
  })

  async function testHistory (history) {
    const startBlock = (await ethers.provider.getBlock()).number
    await network.provider.send('evm_setAutomine', [false])
    let i = 0
    for (let [blockOffset, funcMod, funcCheck] of history) {
      if (!funcCheck) {
        funcCheck = funcMod
        funcMod = undefined
      }

      if (funcMod) i++

      for (; i < blockOffset; i++) {
        await network.provider.send('evm_mine')
      }

      if (funcMod) {
        const modPromise = funcMod()
        await new Promise(resolve => setTimeout(resolve, 100))
        await network.provider.send('evm_mine')
        // await network.provider.send("evm_setAutomine", [true]);
        await modPromise
        // await network.provider.send("evm_setAutomine", [false]);
        // expect((await ethers.provider.getBlock()).number).to.equal(startBlock + blockOffset)
      }

      await funcCheck()
    }

    await network.provider.send('evm_setAutomine', [true])

    for (let [blockOffset, funcMod, funcCheck] of history) {
      if (!funcCheck) {
        funcCheck = funcMod
        funcMod = undefined
      }
      await funcCheck(startBlock + blockOffset)
    }
  }

  it('Basic Token age/History', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [account] = await ethers.getSigners()

    const initialBalance = 1000
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [account.address], [initialBalance])

    await token.deployTransaction.wait()

    const weightWrapper = (address, block) => block === undefined ? token.weightOf(address) : token.weightOfAt(address, block)

    await testHistory([0, 2, 5].map(i => [
      i,
      async block => expect(await weightWrapper(account.address, block)).to.equal(initialBalance * i)
    ]))
  })

  it('Transfer Token age/History', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB] = await ethers.getSigners()

    const initialBalanceA = 1000
    const initialBalanceB = 500
    const transferAmount = 300
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address, accountB.address], [initialBalanceA, initialBalanceB])
    await token.deployTransaction.wait()

    const weightWrapper = (address, block) => block === undefined ? token.weightOf(address) : token.weightOfAt(address, block)
    const balanceWrapper = (address, block) => block === undefined ? token.delegatedBalanceOf(address) : token.delegatedBalanceOfAt(address, block)

    await testHistory([
      [1, async block => {
        expect(await balanceWrapper(accountA.address, block)).to.equal(initialBalanceA)
        expect(await balanceWrapper(accountB.address, block)).to.equal(initialBalanceB)
        expect(await weightWrapper(accountA.address, block)).to.equal(initialBalanceA * 1)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 1)
      }],
      [3, async _ => {
        await expect(token.connect(accountA).transfer(accountB.address, transferAmount))
          .to.emit(token, 'Transfer').withArgs(accountA.address, accountB.address, transferAmount)
      }, async block => {
        expect(await balanceWrapper(accountA.address, block)).to.equal(initialBalanceA - transferAmount)
        expect(await balanceWrapper(accountB.address, block)).to.equal(initialBalanceB + transferAmount)
        expect(await weightWrapper(accountA.address, block)).to.equal((initialBalanceA - transferAmount) * 3)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 3)
      }],
      [5, async _ => {
        await expect(token.connect(accountB).transfer(accountA.address, transferAmount))
          .to.emit(token, 'Transfer').withArgs(accountB.address, accountA.address, transferAmount)
      }, async block => {
        expect(await balanceWrapper(accountA.address, block)).to.equal(initialBalanceA)
        expect(await balanceWrapper(accountB.address, block)).to.equal(initialBalanceB)
        expect(await weightWrapper(accountA.address, block)).to.equal((initialBalanceA - transferAmount) * 5)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 5)
      }]
    ])
  })

  it('Flash Transfer Token age/History', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB] = await ethers.getSigners()

    const initialBalanceA = 1000
    const initialBalanceB = 500
    const transferAmount = 300
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address, accountB.address], [initialBalanceA, initialBalanceB])
    await token.deployTransaction.wait()

    const weightWrapper = (address, block) => block === undefined ? token.weightOf(address) : token.weightOfAt(address, block)
    const balanceWrapper = (address, block) => block === undefined ? token.delegatedBalanceOf(address) : token.delegatedBalanceOfAt(address, block)

    await testHistory([
      [1, async _ => {
        const promises = []
        promises.push(expect(token.connect(accountA).transfer(accountB.address, transferAmount))
          .to.emit(token, 'Transfer').withArgs(accountA.address, accountB.address, transferAmount))
        promises.push(expect(token.connect(accountB).transfer(accountA.address, transferAmount))
          .to.emit(token, 'Transfer').withArgs(accountB.address, accountA.address, transferAmount))
        await Promise.all(promises)
      }, async block => {
        expect(await balanceWrapper(accountA.address, block)).to.equal(initialBalanceA)
        expect(await balanceWrapper(accountB.address, block)).to.equal(initialBalanceB)
        expect(await weightWrapper(accountA.address, block)).to.equal((initialBalanceA - transferAmount) * 1) // Flash tansfers "reset" the tokens
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 1)
      }]
    ])
  })

  it('Delegate Token age/History', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB, accountC] = await ethers.getSigners()

    const initialBalanceA = 1000
    const initialBalanceB = 500
    const transferAmount = 300
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address, accountB.address], [initialBalanceA, initialBalanceB])
    await token.deployTransaction.wait()

    const weightWrapper = (address, block) => block === undefined ? token.weightOf(address) : token.weightOfAt(address, block)
    const delegatedBalanceWrapper = (address, block) => block === undefined ? token.delegatedBalanceOf(address) : token.delegatedBalanceOfAt(address, block)

    await testHistory([
      [1, async block => {
        expect(await delegatedBalanceWrapper(accountA.address, block)).to.equal(initialBalanceA)
        expect(await delegatedBalanceWrapper(accountB.address, block)).to.equal(initialBalanceB)
        expect(await delegatedBalanceWrapper(accountC.address, block)).to.equal(0)
        expect(await weightWrapper(accountA.address, block)).to.equal(initialBalanceA * 1)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 1)
      }],
      [3, async _ => {
        await expect(token.connect(accountA).delegate(accountC.address))
          .to.emit(token, 'Delegate').withArgs(accountA.address, accountC.address)
      }, async block => {
        if (block === undefined) expect(await token.balanceOf(accountA.address)).to.equal(initialBalanceA)
        if (block === undefined) expect(await token.balanceOf(accountC.address)).to.equal(0)

        expect(await delegatedBalanceWrapper(accountA.address, block)).to.equal(initialBalanceA)
        expect(await delegatedBalanceWrapper(accountC.address, block)).to.equal(initialBalanceA)
        expect(await delegatedBalanceWrapper(accountB.address, block)).to.equal(initialBalanceB)
        expect(await weightWrapper(accountA.address, block)).to.equal(initialBalanceA * 3)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 3)
        expect(await weightWrapper(accountC.address, block)).to.equal(initialBalanceA * 3)
      }],
      [5, async _ => {
        await Promise.all([
          expect((await token.connect(accountC).transfer(accountB.address, transferAmount)).wait()) // What on earth
            .to.be.reverted,
          expect(token.connect(accountA).transfer(accountB.address, transferAmount))
            .to.emit(token, 'Transfer').withArgs(accountA.address, accountB.address, transferAmount)
        ])
      }, async block => {
        expect(await delegatedBalanceWrapper(accountA.address, block)).to.equal(initialBalanceA - transferAmount)
        expect(await delegatedBalanceWrapper(accountC.address, block)).to.equal(initialBalanceA - transferAmount)
        expect(await delegatedBalanceWrapper(accountB.address, block)).to.equal(initialBalanceB + transferAmount)
        expect(await weightWrapper(accountA.address, block)).to.equal((initialBalanceA - transferAmount) * 5)
        expect(await weightWrapper(accountC.address, block)).to.equal((initialBalanceA - transferAmount) * 5)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 5)
      }],
      [7, async _ => {
        await expect(token.connect(accountB).delegate(accountC.address))
          .to.emit(token, 'Delegate').withArgs(accountB.address, accountC.address)
      }, async block => {
        expect(await delegatedBalanceWrapper(accountA.address, block)).to.equal(initialBalanceA - transferAmount)
        expect(await delegatedBalanceWrapper(accountB.address, block)).to.equal(initialBalanceB + transferAmount)
        expect(await delegatedBalanceWrapper(accountC.address, block)).to.equal(initialBalanceA + initialBalanceB)
        expect(await weightWrapper(accountA.address, block)).to.equal((initialBalanceA - transferAmount) * 7)
        expect(await weightWrapper(accountC.address, block)).to.equal((initialBalanceA - transferAmount) * 7 + initialBalanceB * 7 + transferAmount * 2)
        expect(await weightWrapper(accountB.address, block)).to.equal(initialBalanceB * 7 + transferAmount * 2)
      }]
    ])
  })

  it('Delegate recursive', async function () {
    const TokenAgeToken = await ethers.getContractFactory('TokenAgeToken')
    const [accountA, accountB] = await ethers.getSigners()

    const initialBalanceA = 1000
    const initialBalanceB = 500
    const token = await TokenAgeToken.deploy('Test Token', 'TEST', 6, [accountA.address, accountB.address], [initialBalanceA, initialBalanceB])
    await token.deployTransaction.wait()

    await expect(token.connect(accountA).delegate(accountB.address))
      .to.emit(token, 'Delegate').withArgs(accountA.address, accountB.address)

    await expect(token.connect(accountB).delegate(accountA.address))
      .to.be.reverted
  })
})
