async function deployVesting(deploymentName, {deployer, updater, beneficiary, start, duration, installments}) {
  if (!beneficiary) {
    console.log(`Beneficiary not configured for ${deploymentName}`)
    return
  }
  const ApocryphVesting = await ethers.getContractFactory('ApocryphVesting', await ethers.getSigner(deployer))
  let proxyAddress

  let proxy = await deployments.getOrNull(deploymentName)
  if (proxy) {
    //await deployments.catchUnknownSigner(upgrades.upgradeProxy(proxy, ApocryphVesting))

    const implAddress = await upgrades.prepareUpgrade(proxy.address, ApocryphVesting)
    const currentAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)

    if (implAddress != currentAddress) {
      await deployments.catchUnknownSigner(deployments.execute(deploymentName, {from: updater}, 'upgradeTo', implAddress))
      console.log(`Update ${deploymentName} Impl done ->`, proxy.address, implAddress)
    } else {
      console.log(`Up to date ${deploymentName} Impl --`)
    }
    proxyAddress = proxy.address
  } else {
    const proxyContract = await upgrades.deployProxy(ApocryphVesting, [updater, beneficiary, start, duration, installments], {kind: 'uups'})
    await proxyContract.deployTransaction.wait()
    console.log(`Deploy ${deploymentName} Proxy done -> `, proxyContract.address)
    proxyAddress = proxyContract.address
  }

  await deployments.save(deploymentName, {
    address: proxyAddress,
    ...await deployments.getExtendedArtifact('ApocryphVesting')
  })
}

module.exports = async () => {
  const {deployer, updater, comradeBoard, coreTeam, comradeAssembly} = await getNamedAccounts()
  const common = {
    deployer: deployer,
    updater: updater,
    start: Math.floor(new Date("2022-04-01T00:00:00Z").valueOf() / 1000),
    duration: 60 * 60 * 24 * 365 * 4, // 4 years
    installments: 4
  }

  console.log(`Vesting config:
    starting on:          ${new Date(common.start * 1000).toISOString()}
    ending at:            ${new Date((common.start + common.duration) * 1000).toISOString()}
    first installment at: ${new Date((common.start + common.duration / common.installments) * 1000).toISOString()}`)

  await deployVesting('ApocryphVesting-comradeAssembly',{...common, beneficiary: comradeAssembly})
  await deployVesting('ApocryphVesting-coreTeam', {...common, beneficiary: coreTeam})
  await deployVesting('ApocryphVesting-comradeBoard', {...common, beneficiary: comradeBoard})
}

module.exports.tags = ['base', 'ApocryphVesting']
