module.exports = async () => {
    const {deployer, comradeBoard: updater} = await getNamedAccounts()
    const ApocryphToken = await ethers.getContractFactory('ApocryphToken', await ethers.getSigner(deployer))

    let proxyAddress

    let proxy = await deployments.getOrNull('ApocryphToken')
    if (proxy) {
      //await deployments.catchUnknownSigner(upgrades.upgradeProxy(proxy, ApocryphToken))

      const implAddress = await upgrades.prepareUpgrade(proxy.address, ApocryphToken)
      const currentAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)

      if (implAddress != currentAddress) {
        await deployments.catchUnknownSigner(deployments.execute('ApocryphToken', {from: updater}, 'upgradeTo', implAddress))
        console.log('Update ApocryphToken Impl  done ->', proxy.address, implAddress)
      } else {
        console.log('Up to date ApocryphToken Impl   --')
      }
      proxyAddress = proxy.address
    } else {
      const proxyContract = await upgrades.deployProxy(ApocryphToken, [updater], {kind: 'uups'})
      await proxyContract.deployTransaction.wait()
      console.log('Deploy ApocryphToken Proxy done -> ', proxyContract.address)
      proxyAddress = proxyContract.address
    }

    await deployments.save('ApocryphToken', {
      address: proxyAddress,
      ...await deployments.getExtendedArtifact('ApocryphToken')
    })
}

module.exports.tags = ['base', 'ApocryphToken']
