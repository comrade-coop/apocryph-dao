// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Owned.sol";
import "./GroupCheckpointing.sol";
import "../interfaces/IVotingWeights.sol";

contract Group is IVotingWeights, Owned, GroupCheckpointing {
    mapping(address => Checkpoint[]) internal weights;

    constructor(address[] memory initialMembers, uint128[] memory initialWeights, address owner_)
            Owned(owner_ != address(0) ? owner_ : msg.sender) {
        for (uint256 i = 0; i < initialMembers.length; i++) {
            setWeightOf(initialMembers[i], i < initialWeights.length ? initialWeights[i] : 1);
        }
    }

    function setWeightOf(address member, uint128 weight) public onlyOwner {
        _pushCheckpoint(weights[member]).weight = weight;
    }

    function weightOf(address member) public override view returns (uint256) {
        return _getLastCheckpoint(weights[member]).weight;
    }

    function weightOfAt(address member, uint256 atBlock) public override view returns (uint256) {
        return _getCheckpoint(weights[member], _convertTime(atBlock)).weight;
    }
}
