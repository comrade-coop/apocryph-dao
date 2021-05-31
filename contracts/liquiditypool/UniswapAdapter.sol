// SPDX-License-Identifier: GPL-2.0-or-later
//  via https://github.com/Uniswap/uniswap-v3-periphery/blob/b6b885569786a319d853acc610ed03884fda9bee/contracts/base/LiquidityManagement.sol
//  via https://github.com/Uniswap/uniswap-v3-periphery/blob/b6b885569786a319d853acc610ed03884fda9bee/contracts/SwapRouter.sol

// solhint-disable-next-line
pragma solidity ^0.7.0;
//pragma abicoder v2;

import "@openzeppelin/contracts-0.7/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";

contract UniswapAdapter is IUniswapV3MintCallback, IUniswapV3SwapCallback {
    address internal _voting;
    IUniswapV3Pool internal _pool;
    IERC20 internal _token0;
    IERC20 internal _token1;

    struct PositionData {
        bytes6 key;
        uint128 liquidity;
    }

    PositionData[] internal _positions;
    mapping(bytes6 => uint256) internal _positionIndices;

    constructor(address voting_, IUniswapV3Pool pool_, IERC20 token0_, IERC20 token1_) {
        _voting = voting_;
        _pool = pool_;
        _token0 = token0_;
        _token1 = token1_;
    }

    function swap(bool zeroForOne, int256 amountIn, int256 amountOut, uint160 sqrtPriceLimitX96) external {
        require(msg.sender == _voting);

        (int256 amount0, int256 amount1) = _pool.swap(
            address(this),
            zeroForOne,
            amountIn,
            (sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96),
            ""
        );

        require(amountOut >= (zeroForOne ? amount1 : amount0)); // price slippage check
    }

    function mintPosition(int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min) external {
        require(msg.sender == _voting);

        (uint160 sqrtPriceX96, , , , , , ) = _pool.slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            amount0Desired,
            amount1Desired
        );

        (uint256 amount0, uint256 amount1) = _pool.mint(
            address(this),
            tickLower,
            tickUpper,
            liquidity,
            ""
        );
        require(amount0 >= amount0Min && amount1 >= amount1Min); // price slippage check

        bytes6 key = bytes6(bytes3(tickLower)) | (bytes6(bytes3(tickUpper)) << 24);
        if (_positionIndices[key] == 0) {
            _positions.push().key = key;
            _positionIndices[key] = _positions.length;
        }
        PositionData storage position = _positions[_positionIndices[key]];
        position.liquidity = position.liquidity + liquidity;
    }

    function burnPosition(int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amount0Min, uint256 amount1Min) external {
        require(msg.sender == _voting);

        (uint256 amount0, uint256 amount1) = _pool.burn(tickLower, tickUpper, liquidity);
        require(amount0 >= amount0Min && amount1 >= amount1Min); // price slippage check

        bytes6 key = bytes6(bytes3(tickLower)) | (bytes6(bytes3(tickUpper)) << 24);
        PositionData storage position = _positions[_positionIndices[key]];
        position.liquidity = position.liquidity - liquidity;
    }

    function dropAllPositions() external {
        require(msg.sender == _voting);

        for (uint256 i = 0; i < _positions.length; i++) {
            PositionData storage position = _positions[i];
            if (position.liquidity > 0) {
                int24 tickLower = int24(bytes3(position.key & 0x000000FFFFFF));
                int24 tickUpper = int24(bytes3(position.key >> 24));
                _pool.burn(tickLower, tickUpper, position.liquidity);
                delete position.liquidity;
            }
        }
    }

    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external override {
        require(msg.sender == address(_pool));

        if (amount0Owed > 0) _token0.transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) _token0.transfer(msg.sender, amount1Owed);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external override {
        require(msg.sender == address(_pool));

        if (amount0Delta > 0) _token0.transfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) _token0.transfer(msg.sender, uint256(amount1Delta));
    }
}
