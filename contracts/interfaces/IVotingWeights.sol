// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IVotingWeights {
    function weightOfAt(address _owner, uint256 blockNumber) external view returns (uint256);

    function weightOf(address _owner) external view returns (uint256);

    function delegateOfAt(address _owner, uint256 blockNumber) external view returns (address);

    function totalWeightAt(uint256 blockNumber) external view returns (uint256);
}
