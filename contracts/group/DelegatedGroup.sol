// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Group.sol";

contract DelegatedGroup is Group {
    event DelegateChanged(address indexed member, address indexed delegate);

    mapping(address => Checkpoint[]) internal delegates;

    constructor(address[] memory initialMembers, uint256[] memory initialWeights, address owner_)
        Group(initialMembers, initialWeights, owner_) {}

    function delegate(address to_) external {
        _setDelegateOf(msg.sender, to_);
    }

    function _setDelegateOf(address member, address newDelegate) internal {
        address oldDelegate = delegateOf(member);
        uint160 weight = _weightOf(member);

        for (address delegateIterator = oldDelegate; delegateIterator != address(0); delegateIterator = delegateOf(delegateIterator)) {
            _setWeightOf(delegateIterator, _weightOf(delegateIterator) - weight);
        }

        _pushCheckpoint(delegates[member]).value = uint160(newDelegate);

        for (address delegateIterator = newDelegate; delegateIterator != address(0); delegateIterator = delegateOf(delegateIterator)) {
            require(delegateIterator != member);
            _setWeightOf(delegateIterator, _weightOf(delegateIterator) + weight);
        }

        emit DelegateChanged(member, newDelegate);
    }

    function delegateOf(address member) public override view returns (address) {
        return address(_getLastCheckpoint(delegates[member]).value);
    }

    function delegateOfAt(address member, uint256 atBlock) public override view returns (address) {
        return address(_getCheckpoint(delegates[member], _convertTime(atBlock)).value);
    }
}
