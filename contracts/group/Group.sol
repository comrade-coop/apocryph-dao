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
        uint160 totalWeight = 0;
        for (uint256 i = 0; i < initialMembers.length; i++) {
            uint256 weight_ = i < initialWeights.length ? initialWeights[i] : 1;
            require(weight_ < type(uint160).max);
            uint160 weight = uint160(weight_);
            totalWeight = totalWeight + weight;
            _setWeightOf(initialMembers[i], weight);
        }
        _setWeightOf(address(0), totalWeight);

    }

    function modifyWeightOf(address member, int256 weightChange) public virtual onlyOwner {
        if (weightChange > 0) {
            _setWeightOf(member, _weightOf(member) + uint160(uint256(weightChange)));
            _setWeightOf(address(0), _weightOf(address(0)) + uint160(uint256(weightChange)));
        } else {
            _setWeightOf(member, _weightOf(member) - uint160(uint256(-weightChange)));
            _setWeightOf(address(0), _weightOf(address(0)) - uint160(uint256(-weightChange)));
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

    function totalWeightAt(uint256 atBlock) public override view returns (uint256) {
        return _getCheckpoint(weights[address(0)], _convertTime(atBlock)).value;
    }

    function delegateOf(address) public virtual view returns (address) {
        return address(0);
    }

    function delegateOfAt(address, uint256) public virtual override view returns (address) {
        return address(0);
    }
}
