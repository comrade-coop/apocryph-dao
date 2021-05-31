// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TokenAgeTime.sol";

abstract contract TokenAgeCheckpointing is TokenAgeTime {
    struct Checkpoint {
        uint64 fromTime;
        uint64 previous; // index into the checkpoints array, 1-based to use default value
        uint128 balance;
        uint64 tokenAgeStartTime;
        uint192 tokenAge; // uint64 * uint128
    }
    Checkpoint private _nilCheckpoint;

    function _getLastCheckpoint(Checkpoint[] storage checkpoints) internal view returns (Checkpoint storage checkpoint) {
        if (checkpoints.length == 0) {
            checkpoint = _nilCheckpoint;
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }
    }

    function _getCheckpoint(Checkpoint[] storage checkpoints, uint64 atTime) internal view returns (Checkpoint storage) {
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
        uint64 currentTime = _currentTime();
        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }
    }

    function _getTokenAge(Checkpoint storage checkpoint, uint64 blockAt) internal view returns (uint192 tokenAge) {
        tokenAge = checkpoint.tokenAge + checkpoint.balance * (blockAt - checkpoint.fromTime);
    }

    function _add(Checkpoint[] storage checkpoints, uint128 amount) internal { // Does not update totalSupply
        if (amount == 0) return; // Avoid creating extra checkpoints for 0-value transfers

        Checkpoint storage lastCheckpoint = _getLastCheckpoint(checkpoints);
        uint64 currentTime = _currentTime();
        uint128 newBalance = lastCheckpoint.balance + amount; // Throws on overflow
        uint192 newTokenAge = _getTokenAge(lastCheckpoint, currentTime);

        Checkpoint storage newCheckpoint = _pushCheckpoint(checkpoints); // Can alias lastCheckpoint

        newCheckpoint.balance = newBalance;
        newCheckpoint.previous = uint64(checkpoints.length - 1);
        newCheckpoint.tokenAgeStartTime = currentTime;
        newCheckpoint.tokenAge = newTokenAge;
    }

    function _sub(Checkpoint[] storage checkpoints, uint128 amount) internal { // Throws if unsufficient balance; does not update totalSupply
        if (amount == 0) return; // Avoid creating extra checkpoints for 0-value transfers

        Checkpoint storage lastCheckpoint = _getLastCheckpoint(checkpoints);
        uint128 newBalance = lastCheckpoint.balance - amount; // Throws on underflow
        Checkpoint storage tokenSourceCheckpoint = lastCheckpoint;
        uint64 newPrevious = lastCheckpoint.previous;

        while (newPrevious > 0 && newBalance < checkpoints[newPrevious - 1].balance) {
            tokenSourceCheckpoint = checkpoints[newPrevious - 1];
            newPrevious = checkpoints[newPrevious - 1].previous;
        }

        Checkpoint storage newCheckpoint = _pushCheckpoint(checkpoints); // Can alias lastCheckpoint

        newCheckpoint.balance = newBalance;
        newCheckpoint.previous = newPrevious;
        newCheckpoint.tokenAgeStartTime = tokenSourceCheckpoint.tokenAgeStartTime;
        newCheckpoint.tokenAge = tokenSourceCheckpoint.tokenAge;
    }
}