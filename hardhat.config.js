const { EthersProviderWrapper } = require('@nomiclabs/hardhat-ethers/internal/ethers-provider-wrapper')

// No sensible way to override the polling interval, and hardhat-ethers waits for a full polling interval after manually mining a block with transactions
Object.defineProperty(EthersProviderWrapper.prototype, 'pollingInterval', {
  get () {
    return 50
  }
})

require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-solhint')

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
          },
        }
      }
    ]
  },
  networks: {
    hardhat: {
      mining: {
        auto: true,
        interval: 0
      }
    }
  }
}
