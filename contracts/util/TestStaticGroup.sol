// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../interfaces/IVotingWeights.sol";

contract TestStaticGroup is IVotingWeights {
    mapping(address => uint256) public override weightOf;

    constructor(address[] memory initialMembers, uint256[] memory initialWeights) {
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < initialMembers.length; i++) {
            uint256 weight = i < initialWeights.length ? initialWeights[i] : 1;
            totalWeight = totalWeight + weight;
            weightOf[initialMembers[i]] = weight;
        }
        weightOf[address(0)] = totalWeight;

    }

    function weightOfAt(address member, uint256) public override view returns (uint256) {
        return weightOf[member];
    }

    function totalWeightAt(uint256) public override view returns (uint256) {
        return weightOf[address(0)];
    }

    function delegateOfAt(address, uint256) public override pure returns (address) {
        return address(0);
    }
}
