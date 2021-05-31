require("@nomiclabs/hardhat-waffle")
require("@nomiclabs/hardhat-solhint")

module.exports = {
  solidity: {
    compilers: [
      { version: "0.7.6" },
      { version: "0.8.4" },
    ],
    overrides: {
      "@uniswap/v3-core/contracts/libraries/FullMath.sol": { version: "0.7.6" },
      "@uniswap/v3-core/contracts/libraries/TickMath.sol": { version: "0.7.6" },
      "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol": { version: "0.7.6" },
    }
  },
};
