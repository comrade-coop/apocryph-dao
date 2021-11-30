// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../util/Owned.sol";
import "./GroupCheckpointing.sol";
import "../interfaces/IVotingWeights.sol";

contract Group is IVotingWeights, Owned, GroupCheckpointing {
    event WeightChanged(address indexed member, uint256 weight);

    mapping(address => Checkpoint[]) internal weights;

    constructor(address[] memory initialMembers, uint256[] memory initialWeights, address owner_)
            Owned(owner_ != address(0) ? owner_ : msg.sender) {
        for (uint256 i = 0; i < initialMembers.length; i++) {
            _setWeightOf(initialMembers[i], uint160(i < initialWeights.length ? initialWeights[i] : 1));
        }
    }

    function setWeightOf(address member, uint256 weight) external onlyOwner {
        _setWeightOf(member, uint160(weight));
    }

    function modifyWeightOf(address member, int256 weightChange) external onlyOwner {
        if (weightChange > 0) {
            _setWeightOf(member, _weightOf(member) + uint160(uint256(weightChange)));
        } else {
            _setWeightOf(member, _weightOf(member) - uint160(uint256(-weightChange)));
        }

    }

    function _setWeightOf(address member, uint160 weight) internal {
        _pushCheckpoint(weights[member]).value = weight;
        emit WeightChanged(member, uint256(weight));
    }

    function weightOf(address member) external override view returns (uint256) {
        return _weightOf(member);
    }

    function _weightOf(address member) internal view returns (uint160) {
        return _getLastCheckpoint(weights[member]).value;
    }

    function weightOfAt(address member, uint256 atBlock) public override view returns (uint256) {
        return _getCheckpoint(weights[member], _convertTime(atBlock)).value;
    }

    function delegateOf(address) public virtual view returns (address) {
        return address(0);
    }

    function delegateOfAt(address, uint256) public virtual override view returns (address) {
        return address(0);
    }
}
