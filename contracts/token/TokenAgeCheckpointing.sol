// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

abstract contract TokenAgeCheckpointing {
    struct Checkpoint {
        // Packed: sizeof(fromTime) == sizeof(tokenAgeStartTime), sizeof(tokenAgeUnder) == sizeof(balance) + sizeof(tokenAgeStartTime), sizeof(under) ~=~ sizeof(fromTime)
        uint64 fromTime;
        uint64 tokenAgeStartTime;
        uint128 balance;
        uint64 under; // index into the checkpoints array, 1-based to make default 0 value point to nil
        uint192 tokenAgeUnder;
    }
    Checkpoint private _nilCheckpoint; // to be considered constant

    // Time

    function _currentTime() internal view returns (uint64) {
        return _convertTime(block.number);
    }

    function _convertTime(uint256 blockNumber) internal pure returns (uint64) {
        return uint64(blockNumber);
    }

    // Checkpoints

    function _getLastCheckpoint(Checkpoint[] storage checkpoints) internal view returns (Checkpoint storage checkpoint) { // `checkpoint` is constant
        if (checkpoints.length == 0) {
            checkpoint = _nilCheckpoint;
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }
    }

    function _getCheckpoint(Checkpoint[] storage checkpoints, uint64 atTime) internal view returns (Checkpoint storage) { // Return value is constant
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

    function _pushCheckpoint(Checkpoint[] storage checkpoints) internal returns (Checkpoint storage checkpoint, Checkpoint storage previousCheckpoint) { // `previousCheckpoint` is constant
        uint64 currentTime = _currentTime();

        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }

        if (checkpoints.length > 1) {
            previousCheckpoint = checkpoints[checkpoints.length - 2]; // .length - 1 is `checkpoint`
        } else {
            previousCheckpoint = _nilCheckpoint;
        }
    }

    // Token age

    function _getTokenAge(Checkpoint storage checkpoint, uint64 blockAt) internal view returns (uint192 tokenAge) {
        tokenAge = checkpoint.tokenAgeUnder + checkpoint.balance * (blockAt - checkpoint.tokenAgeStartTime);
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
        // A bit of explanation...

        // We want to store tokens of different ages in order to be able to keep track of token age
        // Naively storing that as an array means we need O(transactions) to get the total token age or total balance
        //   tokens = [ [startBlock = 5, amount = 10], [startBlock = 7, amount = 10] ]
        // We can optimize that by observing that when the user will only care to remove the most-recently-added tokens, as the others have higher tokenAge
        // Hence we start treating the array as a stack of token amounts, and store `tokenAgeUnder` along with changing `amount` for `balance`
        //   tokens = [ [startBlock = 5, balance = 10, tokenAgeUnder = 0], [startBlock = 7, balance = 20, tokenAgeUnder = 20] ]
        // To maintain the structure, we pop the topmost element whenever `tokens[-1].amount < 0`, i.e. `tokens[-1].balance > tokens[-2].balance`

        // However, when we introduce checkpoints for history, we are stuck with two datastructure that take O(transactions) storage space and have practically the same fields
        // The main difference is that while in our stack we had the invariant that tokens[n].balance > tokens[n - 1].balance, the checkpoints have no such invariant
        // So, we create a "stack" structure by using a linked list.
        //   checkpoints = [ ..
        //     #1 = [checkpointBlock = 5, startBlock = 5, balance = 10, tokenAgeUnder = 0, under = <nil>], ..
        //     #3 = [checkpointBlock = 7, startBlock = 7, balance = 20, tokenAgeUnder = 20, under = #1] ]
        // Observe that the `checkpointBlock` and the `startBlock` we had from before can be different if the balance is decreased
        //   tokens(t=7) = [ [startBlock = 5, balance = 10, tokenAgeUnder = 0], [startBlock = 7, balance = 20, tokenAgeUnder = 20] ]
        //   tokens(t=8) = [ [startBlock = 5, balance = 10, tokenAgeUnder = 0], [startBlock = 7, balance = 19, tokenAgeUnder = 20] ]
        //   checkpoints = [
        //     #0 = [checkpointBlock = 5, startBlock = 5, balance = 10, tokenAgeUnder = 0, under = <nil> ],
        //     #1 = [checkpointBlock = 7, startBlock = 7, balance = 20, tokenAgeUnder = 20, under = #0 ],
        //     #2 = [checkpointBlock = 8, startBlock = 7, balance = 19, tokenAgeUnder = 20, under = #0] ]
        // It seems possible to merge `checkpointBlock` and `startBlock` into one number by modifying `tokenAgeUnder`; but I have not found an easy way to recreate the `tokens` stack in all cases.

        // NOTE: due to _pushCheckpoint() reusing the top checkpoint when it is for the same block, this solution does not exactly match the token stack one

        (Checkpoint storage newCheckpoint, Checkpoint storage oldCheckpoint) = _pushCheckpoint(checkpoints);

        uint64 newUnder;
        uint192 newTokenAgeUnder;
        uint64 newTokenAgeStartTime;

        if (newBalance > oldCheckpoint.balance) { // balance > oldBalance: we are pushing to the stack
            uint64 currentTime = _currentTime();

            newTokenAgeStartTime = currentTime;
            newUnder = uint64(checkpoints.length - 1);
            newTokenAgeUnder = _getTokenAge(oldCheckpoint, currentTime);
        } else { // balance <= oldBalance: we are modifying the stack top and/or popping
            Checkpoint storage tokenSourceCheckpoint = oldCheckpoint;
            newUnder = tokenSourceCheckpoint.under;

            while (newUnder > 0) {
                Checkpoint storage newUnderCheckpoint = checkpoints[newUnder - 1];
                if (newBalance > newUnderCheckpoint.balance) {
                    break;
                }
                tokenSourceCheckpoint = newUnderCheckpoint;
                newUnder = tokenSourceCheckpoint.under;
            }

            newTokenAgeStartTime = tokenSourceCheckpoint.tokenAgeStartTime;
            newTokenAgeUnder = tokenSourceCheckpoint.tokenAgeUnder;
        }

        newCheckpoint.tokenAgeStartTime = newTokenAgeStartTime;
        newCheckpoint.balance = newBalance;
        newCheckpoint.under = newUnder;
        newCheckpoint.tokenAgeUnder = newTokenAgeUnder;
    }
}