// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TokenAgeERC20.sol";
import "../interfaces/IVotingWeights.sol";

abstract contract TokenAgeWeights is TokenAgeERC20, IVotingWeights {
    event Delegate(address indexed from, address indexed to);

    function delegate(address to_) public {
        _setDelegate(_msgSender(), to_);

        emit Delegate(_msgSender(), to_);
    }

    function ownWeightOf(address owner) public view returns (uint256 weight) {
        BalanceCheckpoint storage checkpoint = _getLastCheckpoint(balanceStacks[owner]);
        weight = _getTokenAge(checkpoint, _currentTime());
    }

    function delegatedBalanceOf(address owner) public view returns (uint256 delegatedBalance) {
        delegatedBalance = _getLastCheckpoint(delegatedBalanceCheckpoints[owner]).balance;
    }

    function delegatedBalanceOfAt(address owner, uint256 atBlock) public view returns (uint256 delegatedBalance) {
        uint64 atTime = _convertTime(atBlock);
        delegatedBalance = _getCheckpoint(delegatedBalanceCheckpoints[owner], atTime).balance;
    }

    function weightOf(address owner) public override view returns (uint256 weight) {
        BalanceCheckpoint storage checkpoint = _getLastCheckpoint(delegatedBalanceCheckpoints[owner]);
        weight = _getTokenAge(checkpoint, _currentTime());
    }

    function weightOfAt(address owner, uint256 atBlock) public override view returns (uint256 weight) {
        uint64 atTime = _convertTime(atBlock);
        BalanceCheckpoint storage checkpoint = _getCheckpoint(delegatedBalanceCheckpoints[owner], atTime);
        weight = _getTokenAge(checkpoint, atTime);
    }

    function delegateOf(address owner) public view returns (address delegate_) {
        delegate_ = _getLastCheckpoint(delegateCheckpoints[owner]).delegate;
    }

    function delegateOfAt(address owner, uint256 atBlock) public override view returns (address delegate_) {
        uint64 atTime = _convertTime(atBlock);
        delegate_ = _getCheckpoint(delegateCheckpoints[owner], atTime).delegate;
    }
}