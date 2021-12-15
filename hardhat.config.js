require('hardhat-ethernal')
require('dotenv').config()

const { EthersProviderWrapper } = require('@nomiclabs/hardhat-ethers/internal/ethers-provider-wrapper')

// No sensible way to override the polling interval, and hardhat-ethers waits for a full polling interval after manually mining a block with transactions
Object.defineProperty(EthersProviderWrapper.prototype, 'pollingInterval', {
  get () {
    return 50
  }
})

require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-solhint')

require('hardhat-gas-reporter')

task('accounts', 'Prints the list of accounts', async () => {
  const accounts = await ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

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
        auto: true,
        interval: process.argv.indexOf('node') >= 0 ? 50 : 0
      }
    }
  }
}
if (process.env.POLYGON_PRIVATE_KEY) {
  module.exports.networks.polygon_mumbai = {
    url: `${process.env.POLYGON_UR}`,
    chainId: 80001,
    gas: 'auto',
    gasPrice: 'auto',
    accounts: [`0x${process.env.POLYGON_PRIVATE_KEY}`],
    timeout: 20000
  }
}
