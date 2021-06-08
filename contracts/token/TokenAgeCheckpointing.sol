// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TokenAgeTime.sol";

abstract contract TokenAgeCheckpointing is TokenAgeTime {
    struct Checkpoint {
        uint64 fromTime;
        uint64 previous; // index into the checkpoints array, 1-based to make default 0 value invalid
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

    function _getTokenAge(Checkpoint storage checkpoint, uint64 blockAt) internal view returns (uint192 tokenAge) {
        tokenAge = checkpoint.tokenAge + checkpoint.balance * (blockAt - checkpoint.tokenAgeStartTime);
    }

    function _pushCheckpoint(Checkpoint[] storage checkpoints) internal returns (Checkpoint storage checkpoint, Checkpoint storage previousCheckpoint) {
        uint64 currentTime = _currentTime();

        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }

        if (checkpoints.length > 1) {
            previousCheckpoint = checkpoints[checkpoints.length - 2];
        } else {
            previousCheckpoint = _nilCheckpoint;
        }
    }

    function _add(Checkpoint[] storage checkpoints, uint128 amount) internal { // Does not update totalSupply
        if (amount == 0) return; // Avoid creating extra checkpoints for 0-value transfers

        uint128 newBalance = _getLastCheckpoint(checkpoints).balance + amount; // Throws on overflow
        _updateBalance(checkpoints, newBalance);
    }

    function _sub(Checkpoint[] storage checkpoints, uint128 amount) internal { // Throws if unsufficient balance; does not update totalSupply
        if (amount == 0) return; // Avoid creating extra checkpoints for 0-value transfers

        uint128 newBalance = _getLastCheckpoint(checkpoints).balance - amount; // Throws on underflow
        _updateBalance(checkpoints, newBalance);
    }

    function _updateBalance(Checkpoint[] storage checkpoints, uint128 newBalance) internal { // Does not update totalSupply
        (Checkpoint storage newCheckpoint, Checkpoint storage oldCheckpoint) = _pushCheckpoint(checkpoints);

        if (newBalance > oldCheckpoint.balance) {
            uint64 currentTime = _currentTime();

            newCheckpoint.balance = newBalance;
            newCheckpoint.previous = uint64(checkpoints.length - 1);
            newCheckpoint.tokenAgeStartTime = currentTime;
            newCheckpoint.tokenAge = _getTokenAge(oldCheckpoint, currentTime);
        } else {
            Checkpoint storage tokenSourceCheckpoint = oldCheckpoint;
            uint64 newPrevious = oldCheckpoint.previous;

            while (newPrevious > 0 && newBalance < checkpoints[newPrevious - 1].balance) {
                tokenSourceCheckpoint = checkpoints[newPrevious - 1];
                newPrevious = checkpoints[newPrevious - 1].previous;
            }

            newCheckpoint.balance = newBalance;
            newCheckpoint.previous = newPrevious;
            newCheckpoint.tokenAgeStartTime = tokenSourceCheckpoint.tokenAgeStartTime;
            newCheckpoint.tokenAge = tokenSourceCheckpoint.tokenAge;
        }
    }
}