module.exports = async () => {
    const {deployer, comradeBoard: updater} = await getNamedAccounts()
    const ApocryphToken = await ethers.getContractFactory('ApocryphToken', await ethers.getSigner(deployer))

    let proxy = await deployments.getOrNull('ApocryphToken')

    if (proxy) {
      //await deployments.catchUnknownSigner(upgrades.upgradeProxy(proxy, ApocryphToken))

      const implAddress = await upgrades.prepareUpgrade(proxy.address, ApocryphToken)
      await deployments.catchUnknownSigner(deployments.execute('ApocryphToken', {from: updater}, 'upgradeTo', implAddress))
      console.log('Update ApocryphToken Impl  done ->', proxy.address, implAddress)
    } else {
      const proxyContract = await upgrades.deployProxy(ApocryphToken, [updater], {kind: 'uups'})
      await proxyContract.deployTransaction.wait()
      proxy = {
        address: proxyContract.address,
        ...await deployments.getExtendedArtifact('ApocryphToken')
      }
      await deployments.save('ApocryphToken', proxy)
      console.log('Deploy ApocryphToken Proxy done -> ', proxyContract.address)
    }
}

module.exports.tags = ['base', 'ApocryphToken']
