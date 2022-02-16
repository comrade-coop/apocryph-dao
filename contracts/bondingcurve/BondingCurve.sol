// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IERC1363Spender.sol";
import "../util/Owned.sol";

contract BondingCurve is IERC1363Spender, Owned {
    using SafeERC20 for IERC20;

    event Buy(address indexed recepient, uint256 amountA, uint256 amountB);
    event Sell(address indexed recepient, uint256 amountA, uint256 amountB);
    event TransitionStart();
    event TransitionCancel();
    event TransitionEnd();

    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;

    // The curve starts with `totalBalanceA` A tokens available at the price of `initialPrice/priceDivisor` A tokens per B token and ends with with 0 A tokens available at the price of `finalPrice/priceDivisor` A tokens per B token.
    uint256 public immutable totalBalanceA;
    uint256 public immutable initialPrice; // Price when tokenA.balanceOf(this) == totalBalanceA
    uint256 public immutable finalPrice; // Price when tokenA.balanceOf(this) == 1
    uint256 public immutable priceDivisor;

    // Every `tax/taxDivisor` of B tokens are immediatelly available to the beneficiary and can't be refunded
    uint256 public immutable tax;
    uint256 public immutable taxDivisor;

    uint256 public immutable transitionBalanceA; // Transition starts when tokenA.balanceOf(this) <= transitionBalanceA
    uint256 public immutable transitionDurationBlocks; // ... and ends when transitionDurationBlocks have passed

    // Packed
    uint96 public transitionEndBlock;
    uint128 public balanceA;
    uint128 public withdrawableAmount;

    constructor (
        IERC20 tokenA_, IERC20 tokenB_, address owner_,
        uint256 totalBalanceA_,
        uint256 initialPrice_, uint256 finalPrice_, uint256 priceDivisor_,
        uint256 tax_, uint256 taxDivisor_,
        uint256 transitionBalanceA_, uint256 transitionDurationBlocks_
    ) Owned(owner_) {
        tokenA = tokenA_;
        tokenB = tokenB_;

        totalBalanceA = totalBalanceA_;
        balanceA = uint128(totalBalanceA_);
        initialPrice = initialPrice_;
        finalPrice = finalPrice_;
        priceDivisor = priceDivisor_;

        tax = tax_;
        taxDivisor = taxDivisor_;

        transitionBalanceA = transitionBalanceA_;
        transitionDurationBlocks = transitionDurationBlocks_;

    }

    // Transition

    modifier whenActive() {
        require(transitionEndBlock != type(uint96).max);
        _;
    }

    function enactTransition() public whenActive {
        require(balanceA == 0 && block.number >= transitionEndBlock);

        transitionEndBlock = type(uint96).max;
        withdrawableAmount = uint128(tokenB.balanceOf(address(this)));

        emit TransitionEnd();
    }

    function _updateTransition(uint256 newBalanceA) private {
        if (newBalanceA > transitionBalanceA) {
            if (transitionEndBlock != 0) {
                transitionEndBlock = 0;
                emit TransitionCancel();
            }
        } else {
            if (transitionEndBlock == 0) {
                transitionEndBlock = uint96(block.number + transitionDurationBlocks);
                emit TransitionStart();
            }
        }
    }

    // Buy/sell

    function buy(uint256 amountA, uint256 maxAmountB, address recepient) public {
        _buy(msg.sender, amountA, maxAmountB, recepient);
    }

    function _buy(address _sender, uint256 amountA, uint256 maxAmountB, address recepient) private whenActive {
        if (recepient == address(0)) {
            recepient = _sender;
        }

        if (amountA > balanceA) {
            amountA = balanceA;
        }
        uint128 endBalanceA = balanceA - uint128(amountA);

        uint256 preTaxAmountB = calculateDueBalanceB(balanceA) - calculateDueBalanceB(endBalanceA);
        require(preTaxAmountB <= maxAmountB, "Price slippage");

        uint256 taxAmountB = preTaxAmountB * tax / taxDivisor;
        withdrawableAmount = withdrawableAmount + uint128(taxAmountB);

        balanceA = endBalanceA;
        _updateTransition(endBalanceA);

        tokenB.safeTransferFrom(_sender, address(this), preTaxAmountB);
        tokenA.safeTransfer(recepient, amountA);

        emit Buy(recepient, amountA, preTaxAmountB);
    }

    function sell(uint256 amountA, uint256 minAmountB, address recepient) public {
        _sell(msg.sender, amountA, minAmountB, recepient);
    }

    function _sell(address _sender, uint256 amountA, uint256 minAmountB, address recepient) private whenActive {
        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        if (balanceA + amountA > totalBalanceA) {
            amountA = totalBalanceA - balanceA; // Tokens beyound the initial supply sell for 0; assume the user doesn't want that
        }
        uint128 endBalanceA = balanceA + uint128(amountA);

        uint256 preTaxAmountB = calculateDueBalanceB(endBalanceA) - calculateDueBalanceB(balanceA);
        uint256 taxAmountB = preTaxAmountB * tax / taxDivisor;
        uint256 amountB = preTaxAmountB - uint128(taxAmountB);
        require(amountB >= minAmountB, "Price slippage");

        balanceA = endBalanceA;
        _updateTransition(endBalanceA);

        tokenA.safeTransferFrom(_sender, address(this), amountA);
        tokenB.safeTransfer(recepient, amountB);

        emit Sell(recepient, amountA, amountB);
    }

    // Calculate price

    function getBuyPrice(uint128 amountA) public view returns (uint256 price) {
        if (amountA > balanceA) {
            return calculateDueBalanceB(balanceA)  * priceDivisor;
        }

        uint256 preTaxAmountB = calculateDueBalanceB(balanceA) - calculateDueBalanceB(balanceA - amountA);
        return preTaxAmountB;
    }

    function getSellPrice(uint128 amountA) public view returns (uint256 price) {
        uint256 preTaxAmountB = calculateDueBalanceB(balanceA + amountA) - calculateDueBalanceB(balanceA);
        uint256 taxAmountB = preTaxAmountB * tax;
        uint256 amountB = (preTaxAmountB - uint128(taxAmountB));
        return amountB;
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

    function calculateDueBalanceB(uint256 atBalanceA) public view returns (uint256 dueBalanceB) {
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

        if (atBalanceA == 0) {
            dueBalanceB = 0; // Otherwise (atBalanceA - 1) reverts, despite it being multipled by a 0
        } else {
            dueBalanceB = (atBalanceA * finalPrice - atBalanceA * (atBalanceA - 1) * (finalPrice - initialPrice) / totalBalanceA / 2) / priceDivisor;
        }
    }

    // Withdraw

    function withdraw(address recepient, uint256 amount) external onlyOwner {
        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        if (amount > withdrawableAmount) {
            amount = withdrawableAmount;
        }
        withdrawableAmount = withdrawableAmount - uint128(amount);

        tokenB.safeTransfer(recepient, amount);
    }
}
