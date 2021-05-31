// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../interfaces/IVotingWeights.sol";

contract WeightsForwarded is IVotingWeights {
    IVotingWeights internal _weights;

    constructor(IVotingWeights weights_) {
        _weights = weights_;
    }

    function weightOfAt(address voter, uint256 atBlock) public override view returns (uint256) {
        return _weights.weightOfAt(voter, atBlock);
    }
}
