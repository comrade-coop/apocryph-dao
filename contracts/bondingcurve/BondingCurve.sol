// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

contract BondingCurve {
    using SafeERC20 for IERC20;

    event Buy(address indexed recepient, uint256 amountA, uint256 amountB);
    event Sell(address indexed recepient, uint256 amountA, uint256 amountB);
    event TransitionStart(uint256 endBlock);
    event TransitionCancel();
    event Transition(uint256 finalBalanceB);

    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    address public immutable beneficiary;

    // The curve starts with `totalBalanceA` A tokens available at the price of `initialPrice/priceDivisor` A tokens per B token and ends with with 0 A tokens available at the price of `finalPrice/priceDivisor` A tokens per B token.
    uint256 public immutable totalBalanceA;
    uint256 public immutable initialPrice; // Price when tokenA.balanceOf(this) == totalBalanceA
    uint256 public immutable finalPrice; // Price when tokenA.balanceOf(this) == 0
    uint256 public immutable priceDivisor;

    // Every `tax/taxDivisor` of B tokens are immediatelly available to the beneficiary and aren't refundable
    uint256 public immutable tax;
    uint256 public immutable taxDivisor;

    uint256 public immutable transitionBalanceA; // Transition starts when tokenA.balanceOf(this) <= transitionBalanceA
    uint256 public immutable transitionDurationBlocks; // ... and ends when transitionDurationBlocks have passed

    // Packed
    uint240 internal _transitionEndBlock;
    bool public active;

    constructor (
        IERC20 tokenA_, IERC20 tokenB_, address beneficiary_,
        uint256 totalBalanceA_,
        uint256 initialPrice_, uint256 finalPrice_, uint256 priceDivisor_,
        uint256 tax_, uint256 taxDivisor_,
        uint256 transitionBalanceA_, uint256 transitionDurationBlocks_
    ) {
        tokenA = tokenA_;
        tokenB = tokenB_;
        beneficiary = beneficiary_;

        totalBalanceA = totalBalanceA_;
        initialPrice = initialPrice_;
        finalPrice = finalPrice_;
        priceDivisor = priceDivisor_;

        tax = tax_;
        taxDivisor = taxDivisor_;

        transitionBalanceA = transitionBalanceA_;
        transitionDurationBlocks = transitionDurationBlocks_;

    }

    function initialize() external {
        require(!active, "Active");
        uint256 neededFunds = totalBalanceA - tokenA.balanceOf(address(this));
        if (neededFunds > 0) {
            tokenA.safeTransferFrom(msg.sender, address(this), neededFunds);
        }
        active = true;
    }

    function calculateDueBalanceB(uint256 balanceA) public view returns (uint256 dueBalanceB) {
        // amountB = integrate(initialPrice + (totalBalanceA - d balanceA) * (finalPrice - initialPrice) / totalBalanceA | balanceA = startBalanceA .. endBalanceA)
        // amountB = integrate(initialPrice + (1 - d balanceA  / totalBalanceA) * (finalPrice - initialPrice) | balanceA = startBalanceA .. endBalanceA)
        // amountB = integrate(finalPrice - (d balanceA  / totalBalanceA) * (finalPrice - initialPrice) | balanceA = startBalanceA .. endBalanceA)
        // amountB_indefinite = balanceA * finalPrice + balanceA*balanceA/2 * (finalPrice - initialPrice) / totalBalanceA

        if (balanceA > totalBalanceA) {
            balanceA = totalBalanceA; // Otherwise the linear curve can go into negative prices if someone transfers without using sell()
        }

        if (balanceA == 0) {
            dueBalanceB = 0; // Otherwise (balanceA - 1) reverts
        } else {
            dueBalanceB = (balanceA * finalPrice - (balanceA - 1) * balanceA * (finalPrice - initialPrice) / totalBalanceA / 2) / priceDivisor;
        }
    }

    function buy(uint256 amountA, uint256 maxAmountB, address recepient) public {
        require(active, "Inactive");

        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        uint256 startBalanceA = tokenA.balanceOf(address(this));
        if (amountA > startBalanceA) {
            amountA = startBalanceA;
        }
        uint256 endBalanceA = startBalanceA - amountA;

        uint256 preTaxAmountB = calculateDueBalanceB(startBalanceA) - calculateDueBalanceB(endBalanceA);
        uint256 taxAmountB = preTaxAmountB * tax / taxDivisor;
        uint256 amountB = preTaxAmountB - taxAmountB;

        require(preTaxAmountB <= maxAmountB, "Price slippage");

        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        tokenB.safeTransferFrom(msg.sender, beneficiary, taxAmountB); // TODO: should use claim/allowance instead?
        tokenA.safeTransfer(recepient, amountA);

        emit Buy(recepient, amountA, preTaxAmountB);

        // updateTransition();
    }

    function sell(uint256 amountA, uint256 minAmountB, address recepient) public {
        require(active, "Inactive");

        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        uint256 startBalanceA = tokenA.balanceOf(address(this));
        if (startBalanceA + amountA > totalBalanceA) {
            amountA = totalBalanceA - startBalanceA; // Tokens beyound the initial supply sell for 0; assume the user doesn't want that
        }
        uint256 endBalanceA = startBalanceA + amountA;

        uint256 preTaxAmountB = calculateDueBalanceB(endBalanceA) - calculateDueBalanceB(startBalanceA);
        uint256 taxAmountB = preTaxAmountB * tax / taxDivisor;
        uint256 amountB = preTaxAmountB - taxAmountB;
        require(amountB >= minAmountB, "Price slippage");

        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransfer(recepient, amountB);

        emit Sell(recepient, amountA, amountB);

        // updateTransition();
    }

    function updateTransition() public {
        require(active, "Inactive");

        uint256 balanceA = tokenA.balanceOf(address(this));

        if (balanceA > transitionBalanceA)
        {
            if (_transitionEndBlock != 0)
            {
                _transitionEndBlock = 0;
                emit TransitionCancel();
            }
        }
        else if (_transitionEndBlock == 0) // balanceA <= transitionBalanceA for the frist time
        {
            uint256 endBlock = block.number + transitionDurationBlocks;
            _transitionEndBlock = uint240(endBlock);
            emit TransitionStart(endBlock);
        }
        else if (block.number >= _transitionEndBlock && balanceA == 0) // balanceA <= transitionBalanceA and _transitionEndBlock has passed and balanceA == 0
        {
            active = false;

            uint256 balanceB = tokenB.balanceOf(address(this));
            tokenB.safeTransfer(beneficiary, balanceB);

            emit Transition(balanceB);
        }
    }
}
