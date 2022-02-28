require('dotenv').config()

const { EthersProviderWrapper } = require('@nomiclabs/hardhat-ethers/internal/ethers-provider-wrapper')

if (process.argv.indexOf('--network') === -1) {
  // No sensible way to override the polling interval, and hardhat-ethers waits for a full polling interval after manually mining a block with transactions
  Object.defineProperty(EthersProviderWrapper.prototype, 'pollingInterval', {
    get () {
      return 50
    }
  })
}

require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-solhint')
require('@openzeppelin/hardhat-upgrades')
require('hardhat-gas-reporter')
require('hardhat-deploy')

task('accounts', 'Prints the list of accounts', async () => {
  const accounts = await ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

if (process.env.ETHERAL_WORKSPACE) {
  require('hardhat-ethernal')
  extendEnvironment((hre) => {
    hre.ethernalSync = true
    hre.ethernalWorkspace = `${process.env.ETHERAL_WORKSPACE}`
  })
}

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.4',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      }
    ]
  },
  networks: {
    hardhat: {
      mining: {
        auto: true
      }
    }
  },
  namedAccounts: {
    deployer: { default: 0 },
    updater: {
      default: 1,
      hardhat: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      localhost: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      goerli: '0x7122eD700FE28aE6752A1928f2CDB79c67E91245',
      polygon: '0x972f2A2ce350Ed97488a3a53C03ECB028354049a',
    },
  }
}

if (process.argv.indexOf('node') >= 1) {
  module.exports.networks.hardhat.mining = {
    auto: false,
    interval: 2 * 1000
  }
}

if (process.env.POLYGON_MUMBAI_PRIVATE_KEY) {
  module.exports.networks.polygon_mumbai = {
    url: `${process.env.POLYGON_MUMBAI_URL}`,
    chainId: 80001,
    gas: 'auto',
    gasPrice: 'auto',
    accounts: [`0x${process.env.POLYGON_MUMBAI_PRIVATE_KEY}`],
    timeout: 20000
  }
}

if (process.env.POLYGON_PRIVATE_KEY) {
  module.exports.networks.polygon = {
    url: `${process.env.POLYGON_URL}`,
    chainId: 137,
    gas: 'auto',
    gasPrice: 'auto',
    accounts: [`0x${process.env.POLYGON_PRIVATE_KEY}`],
    timeout: 20000
  }
}

if (process.env.GOERLI_PRIVATE_KEY) {
  module.exports.networks.goerli = {
    url: `${process.env.GOERLI_URL}`,
    chainId: 5,
    gas: 'auto',
    gasPrice: 'auto',
    accounts: [`0x${process.env.GOERLI_PRIVATE_KEY}`],
    timeout: 20000
  }
}

if (process.env.GNOSIS_SOKOL_PRIVATE_KEY) {
  module.exports.networks.gnosis_sokol = {
    url: `${process.env.GNOSIS_SOKOL_URL}`,
    chainId: 77,
    gas: 'auto',
    gasPrice: 'auto',
    accounts: [`0x${process.env.GNOSIS_SOKOL_PRIVATE_KEY}`],
    timeout: 20000
  }
}
