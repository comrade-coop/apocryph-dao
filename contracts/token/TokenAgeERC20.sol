// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./TokenAgeCheckpointing.sol";

abstract contract TokenAgeERC20 is TokenAgeCheckpointing, IERC20, Context {
    mapping (address => mapping (address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function balanceOf(address owner) external override view returns (uint256 balance) {
        balance = _getLastCheckpoint(balanceStacks[owner]).balance;
    }

    function transfer(address to_, uint256 value_) public override returns (bool) { // Throws if unsufficient balance
        _transfer(_msgSender(), to_, uint192(value_)); // Throws
        return true;
    }

    function transferFrom(address from_, address to_, uint256 value_) public override returns (bool) { // Throws if unsufficient balance or allowance
        allowance[from_][_msgSender()] = allowance[from_][_msgSender()] - value_; // Throws
        _transfer(from_, to_, uint192(value_)); // Throws
        return true;
    }

    // Via https://github.com/ethereum/EIPs/issues/738#issuecomment-336277632
    function safeApprove(address to_, uint256 value_, uint256 oldValue_) public returns (bool) {
        require(allowance[_msgSender()][to_] == oldValue_);
        _approve(_msgSender(), to_, value_);
        return true;
    }

    function approve(address to_, uint256 value_) public override returns (bool) {
        _approve(_msgSender(), to_, value_);
        return true;
    }

    function _approve(address from_, address to_, uint256 value_) internal {
        allowance[from_][to_] = value_;
        emit Approval(from_, to_, value_);
    }

    function _transfer(address from_, address to_, uint192 value_) internal { // Throws if unsufficient balance
        if (value_ != 0) {
            _sub(from_, value_); // Throws
            _add(to_, value_);
        }
        emit Transfer(from_, to_, value_);
    }
}