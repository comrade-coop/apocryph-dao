// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TokenAgeERC20.sol";
import "../interfaces/IVotingWeights.sol";

contract TokenAgeWeights is TokenAgeERC20, IVotingWeights {
    function weightOf(address owner) public view returns (uint256 weight) {
        Checkpoint storage checkpoint = _getLastCheckpoint(_checkpoints[owner]);
        weight = _getTokenAge(checkpoint, _currentTime());
    }

    function weightOfAt(address owner, uint256 atBlock) public override view returns (uint256 weight) {
        uint64 atTime = _convertTime(atBlock);
        Checkpoint storage checkpoint = _getCheckpoint(_checkpoints[owner], atTime);
        weight = _getTokenAge(checkpoint, atTime);
    }
}