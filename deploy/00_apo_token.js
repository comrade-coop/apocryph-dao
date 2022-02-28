module.exports = async () => {
    const {deployer, updater} = await getNamedAccounts()
    const ApocryphToken = await ethers.getContractFactory('ApocryphToken', await ethers.getSigner(deployer))

    let proxy = await deployments.getOrNull('ApocryphToken')

    if (proxy) {
      //await deployments.catchUnknownSigner(upgrades.upgradeProxy(proxy, ApocryphToken))

      const implAddress = await upgrades.prepareUpgrade(proxy.address, ApocryphToken)
      await deployments.catchUnknownSigner(deployments.execute('ApocryphToken', {from: updater}, 'upgradeTo', implAddress))
      console.log('Update ApocryphToken Impl  done ->', proxy.address, implAddress)
    } else {
      const proxyContract = await upgrades.deployProxy(ApocryphToken, {kind: 'uups'})
      await proxyContract.deployTransaction.wait()
      proxy = {
        address: proxyContract.address,
        ...await deployments.getExtendedArtifact('ApocryphToken')
      }
      await deployments.save('ApocryphToken', proxy)
      console.log('Deploy ApocryphToken Proxy done -> ', proxyContract.address)

      await deployments.execute('ApocryphToken', {from: deployer}, 'grantRole', ethers.utils.id('UPGRADER_ROLE'), updater)
      await deployments.execute('ApocryphToken', {from: deployer}, 'grantRole', ethers.utils.id('MINTER_ROLE'), updater)
      await deployments.execute('ApocryphToken', {from: deployer}, 'grantRole', '0x'+'0'.repeat(64), updater)
      await deployments.execute('ApocryphToken', {from: deployer}, 'renounceRole', '0x'+'0'.repeat(64), deployer)
      console.log('Configure ApocryphToken    done -> ', proxy.address)
    }
}

module.exports.tags = ['base', 'ApocryphToken']
