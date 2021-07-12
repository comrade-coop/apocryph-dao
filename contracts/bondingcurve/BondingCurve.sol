// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IERC1363Spender.sol";

contract BondingCurve is IERC1363Spender {
    using SafeERC20 for IERC20;

    event Buy(address indexed recepient, uint256 amountA, uint256 amountB);
    event Sell(address indexed recepient, uint256 amountA, uint256 amountB);
    event TransitionStart();
    event TransitionCancel();
    event Transition(uint256 finalBalanceB);

    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    address public immutable beneficiary;

    // The curve starts with `totalBalanceA` A tokens available at the price of `initialPrice/priceDivisor` A tokens per B token and ends with with 0 A tokens available at the price of `finalPrice/priceDivisor` A tokens per B token.
    uint256 public immutable totalBalanceA;
    uint256 public immutable initialPrice; // Price when tokenA.balanceOf(this) == totalBalanceA
    uint256 public immutable finalPrice; // Price when tokenA.balanceOf(this) == 1
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
        uint256 balanceA = tokenA.balanceOf(address(this));
        if (balanceA < totalBalanceA) {
            tokenA.safeTransferFrom(msg.sender, address(this), totalBalanceA - balanceA);
        }
        active = true;
    }

    // Buy/sell

    function buy(uint256 amountA, uint256 minAmountB, address recepient) public {
        _buy(msg.sender, amountA, minAmountB, recepient);
    }

    function _buy(address _sender, uint256 amountA, uint256 maxAmountB, address recepient) public {
        require(active, "Inactive");

        if (recepient == address(0)) {
            recepient = _sender;
        }

        uint256 startBalanceA = tokenA.balanceOf(address(this));

        if (amountA > startBalanceA) {
            amountA = startBalanceA;
        }
        uint256 endBalanceA = startBalanceA - amountA;

        uint256 preTaxAmountB = calculateDueBalanceB(startBalanceA) - calculateDueBalanceB(endBalanceA);
        uint256 taxAmountB = preTaxAmountB * tax / taxDivisor;
        uint256 amountB = preTaxAmountB - taxAmountB;

        _updateTransition(endBalanceA);

        require(preTaxAmountB <= maxAmountB, "Price slippage");

        tokenB.safeTransferFrom(_sender, address(this), amountB);
        tokenB.safeTransferFrom(_sender, beneficiary, taxAmountB); // Q: should we use withdraw for taxes instead?
        tokenA.safeTransfer(recepient, amountA);

        emit Buy(recepient, amountA, preTaxAmountB);
    }

    function sell(uint256 amountA, uint256 minAmountB, address recepient) public {
        _sell(msg.sender, amountA, minAmountB, recepient);
    }

    function _sell(address _sender, uint256 amountA, uint256 minAmountB, address recepient) public {
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

        _updateTransition(endBalanceA);

        tokenA.safeTransferFrom(_sender, address(this), amountA);
        tokenB.safeTransfer(recepient, amountB);

        emit Sell(recepient, amountA, amountB);
    }

    // ERC1363

    function onApprovalReceived(address owner, uint256 value, bytes memory data) external override returns (bytes4) {
        if (msg.sender == address(tokenB)) {
            (uint256 amountA, address receiver) = abi.decode(data, (uint256, address));
            _buy(owner, amountA, value, receiver);
        } else if (msg.sender == address(tokenA)) {
            (uint256 minAmountB, address receiver) = abi.decode(data, (uint256, address));
            _sell(owner, value, minAmountB, receiver);
        } else {
            revert();
        }
        return IERC1363Spender.onApprovalReceived.selector;
    }

    // Curve

    function calculateDueBalanceB(uint256 balanceA) public view returns (uint256 dueBalanceB) {
        // First, we get the price of a single token:
        //   price = initialPrice + (totalBalanceA - (balanceA - 1)) * (finalPrice - initialPrice) / totalBalanceA
        //   price = initialPrice + (1 - (balanceA - 1) / totalBalanceA) * (finalPrice - initialPrice)
        //   price = finalPrice - (balanceA - 1) * (finalPrice - initialPrice) / totalBalanceA
        // Then we sum that from 1 to the total balance to get total balance; that way we can use calculateDueBalanceB similar to an indefinite integral
        //   amountB_due = sum(price | balanceA = 1 .. balanceA)
        //   amountB_due = balanceA * ((price | balanceA = 1) + (price)) / 2
        // Expanding and simplifying so that the division in price has better precision
        //   amountB_due = balanceA * (finalPrice - (1 - 1) * (finalPrice - initialPrice) / totalBalanceA + finalPrice - (balanceA - 1) * (finalPrice - initialPrice) / totalBalanceA) / 2
        //   amountB_due = balanceA * (2 * finalPrice - (balanceA - 1) * (finalPrice - initialPrice) / totalBalanceA) / 2
        //   amountB_due = balanceA * finalPrice - balanceA * (balanceA - 1) * (finalPrice - initialPrice) / totalBalanceA / 2

        if (balanceA > totalBalanceA) {
            balanceA = totalBalanceA; // That way we can't go into negative prices if someone transfers us A tokens without using sell()
        }

        if (balanceA == 0) {
            dueBalanceB = 0; // Otherwise (balanceA - 1) reverts, despite it being multipled by a 0
        } else {
            dueBalanceB = (balanceA * finalPrice - balanceA * (balanceA - 1) * (finalPrice - initialPrice) / totalBalanceA / 2) / priceDivisor;
        }
    }

    // Transition

    function _updateTransition(uint256 balanceA) private {
        require(active, "Inactive");

        if (balanceA > transitionBalanceA) {
            if (_transitionEndBlock != 0) {
                _transitionEndBlock = 0;
                emit TransitionCancel();
            }
        } else {
            if (_transitionEndBlock == 0) {
                _transitionEndBlock = uint240(block.number + transitionDurationBlocks);
                emit TransitionStart();
            }
        }
    }

    function enactTransition() public {
        require(active, "Inactive");

        uint256 balanceA = tokenA.balanceOf(address(this));

        require(balanceA == 0 && block.number >= _transitionEndBlock);

        active = false;

        uint256 balanceB = tokenB.balanceOf(address(this));
        tokenB.safeTransfer(beneficiary, balanceB);

        emit Transition(balanceB);
    }
}
