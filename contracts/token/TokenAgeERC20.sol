// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./TokenAgeCheckpointing.sol";

contract TokenAgeERC20 is TokenAgeCheckpointing, IERC20, Context {
    mapping (address => Checkpoint[]) internal _checkpoints;
    mapping (address => mapping (address => uint256)) public override allowance;

    uint256 public override totalSupply;

    function balanceOf(address owner) public override view returns (uint256 balance) {
        balance = uint256(_getLastCheckpoint(_checkpoints[owner]).balance);
    }

    function balanceOfAt(address owner, uint256 atBlock) external view returns (uint256 balance) {
        balance = _getCheckpoint(_checkpoints[owner], _convertTime(atBlock)).balance;
    }

    function transfer(address to_, uint256 value_) public override returns (bool) { // Throws if unsufficient balance
        _transfer(_msgSender(), to_, uint128(value_)); // Throws
        return true;
    }

    function transferFrom(address from_, address to_, uint256 value_) public override returns (bool) { // Throws if unsufficient balance or allowance
        allowance[from_][_msgSender()] = allowance[from_][_msgSender()] - value_; // Throws
        _transfer(from_, to_, uint128(value_)); // Throws
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

    function _transfer(address from_, address to_, uint128 value_) internal { // Throws if unsufficient balance
        _sub(_checkpoints[from_], value_); // Throws
        _add(_checkpoints[to_], value_);
        emit Transfer(from_, to_, value_);
    }
}