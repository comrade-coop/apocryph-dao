// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Owned.sol";
import "../interfaces/IVotingWeights.sol";

contract GroupCheckpointing {
    struct Checkpoint {
        uint128 fromTime;
        uint128 weight;
    }
    Checkpoint private _nilCheckpoint;

    function _getLastCheckpoint(Checkpoint[] storage checkpoints) internal view returns (Checkpoint storage checkpoint) {
        if (checkpoints.length == 0) {
            checkpoint = _nilCheckpoint;
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }
    }

    function _getCheckpoint(Checkpoint[] storage checkpoints, uint128 atTime) internal view returns (Checkpoint storage) {
        if (checkpoints.length == 0 || atTime < checkpoints[0].fromTime) return _nilCheckpoint;
        if (atTime >= checkpoints[checkpoints.length - 1].fromTime) return checkpoints[checkpoints.length - 1];

        uint256 start = 0;
        uint256 end = checkpoints.length - 1;
        while (true) {
            uint256 mid = (start + end) / 2; // floor
            uint256 midTime = checkpoints[mid].fromTime;
            if (midTime > atTime) {
                end = mid - 1;
            } else if (midTime < atTime) {
                start = mid + 1;
            } else { // midTime == atTime
                return checkpoints[mid];
            }
        }

        return _nilCheckpoint;
    }

    function _pushCheckpoint(Checkpoint[] storage checkpoints) internal returns (Checkpoint storage checkpoint) {
        uint128 currentTime = _currentTime();
        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }
    }

    function _currentTime() internal view returns (uint128) {
        return _convertTime(block.number);
    }

    function _convertTime(uint256 blockNumber) internal pure returns (uint128) {
        return uint128(blockNumber);
    }
}