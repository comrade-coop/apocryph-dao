// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Owned.sol";
import "../interfaces/IVotingWeights.sol";

contract GroupCheckpointing {
    struct Checkpoint {
        uint96 fromTime;
        uint160 value;
    }
    Checkpoint private _nilCheckpoint;

    function _getLastCheckpoint(Checkpoint[] storage checkpoints) internal view returns (Checkpoint storage checkpoint) {
        if (checkpoints.length == 0) {
            checkpoint = _nilCheckpoint;
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }
    }

    function _getCheckpoint(Checkpoint[] storage checkpoints, uint96 atTime) internal view returns (Checkpoint storage) {
        // Via https://en.wikipedia.org/wiki/Binary_search_algorithm#Procedure_for_finding_the_rightmost_element
        if (checkpoints.length == 0 || atTime < checkpoints[0].fromTime) return _nilCheckpoint;
        if (atTime >= checkpoints[checkpoints.length - 1].fromTime) return checkpoints[checkpoints.length - 1];

        uint256 start = 0;
        uint256 end = checkpoints.length;
        while (start < end) {
            uint256 mid = (start + end) / 2; // floor
            if (checkpoints[mid].fromTime > atTime) {
                end = mid;
            } else {
                start = mid + 1;
            }
        }

        return checkpoints[end - 1];
    }

    function _pushCheckpoint(Checkpoint[] storage checkpoints) internal returns (Checkpoint storage checkpoint) {
        uint96 currentTime = _currentTime();
        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }
    }

    function _currentTime() internal view returns (uint96) {
        return _convertTime(block.number);
    }

    function _convertTime(uint256 blockNumber) internal pure returns (uint96) {
        return uint96(blockNumber);
    }
}
