// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

abstract contract TokenAgeCheckpointing {
    struct BalanceCheckpoint {
        uint64 fromTime;
        uint192 balance;
        uint256 tokenAge;
    }
    struct DelegateCheckpoint {
        uint64 fromTime;
        address delegate;
    }
    BalanceCheckpoint private _nilBalanceCheckpoint;
    DelegateCheckpoint private _nilDelegateCheckpoint;

    mapping (address => BalanceCheckpoint[]) internal balanceStacks; // Note: reusing BalanceCheckpoint struct as it is the same what a BalanceStackItem would be
    mapping (address => BalanceCheckpoint[]) internal delegatedBalanceCheckpoints;
    mapping (address => DelegateCheckpoint[]) internal delegateCheckpoints;

    // Helpers manipulating the stack and checkpoints

    function _add(address owner, uint192 balanceDifference) internal {
        BalanceCheckpoint[] storage stack = balanceStacks[owner];

        BalanceCheckpoint storage lastStackItem = _getLastCheckpoint(stack);
        uint256 lastTokenAge = _getTokenAge(lastStackItem, _currentTime());

        BalanceCheckpoint storage newStackItem = _pushCheckpoint(stack);
        newStackItem.balance = lastStackItem.balance + balanceDifference;
        newStackItem.tokenAge = lastTokenAge;

        _updateDelegatedBalances(owner, int192(balanceDifference), 0); // We know that newTokenAge == lastTokenAge, since newStackItem.fromTime == _currentTime()
    }

    function _sub(address owner, uint192 balanceDifference) internal { // Throws if unsufficient balance
        BalanceCheckpoint[] storage stack = balanceStacks[owner];

        BalanceCheckpoint storage lastStackItem = _getLastCheckpoint(stack);
        uint192 newBalance = lastStackItem.balance - balanceDifference; // Throws

        uint256 lastTokenAge = _getTokenAge(lastStackItem, _currentTime());

        if (newBalance == 0) {
            delete balanceStacks[owner];
        } else {
            while (stack.length > 1 && newBalance <= stack[stack.length - 2].balance) {
                stack.pop();
            }

            stack[stack.length - 1].balance = newBalance; // We know that stack.length > 0, because _getLastCheckpoint did not return nilCheckpoint
        }

        uint256 newTokenAge = _getTokenAge(_getLastCheckpoint(stack), _currentTime()); // lastStackItem is invalid here

        _updateDelegatedBalances(owner, -int192(balanceDifference), int256(newTokenAge) - int256(lastTokenAge));
    }

    function _setDelegate(address owner, address newDelegate) internal {
        DelegateCheckpoint[] storage checkpoints = delegateCheckpoints[owner];

        BalanceCheckpoint storage lastBalanceCheckpoint = _getLastCheckpoint(delegatedBalanceCheckpoints[owner]);
        int192 delegatedBalance = int192(lastBalanceCheckpoint.balance);
        int256 delegatedTokenAge = int256(_getTokenAge(lastBalanceCheckpoint, _currentTime()));

        address oldDelegate = _getLastCheckpoint(checkpoints).delegate;

        _updateDelegatedBalances(oldDelegate, -delegatedBalance, -delegatedTokenAge);

        DelegateCheckpoint storage newDelegateCheckpoint = _pushCheckpoint(checkpoints);
        newDelegateCheckpoint.delegate = newDelegate;

        _updateDelegatedBalances(newDelegate, delegatedBalance, delegatedTokenAge);

    }

    function _updateDelegatedBalances(address delegate, int192 balanceChange, int256 tokenAgeChange) internal {
        uint64 currentTime = _currentTime();

        address delegateIterator = delegate;
        while (delegateIterator != address(0)) {
            BalanceCheckpoint[] storage balanceCheckpoints = delegatedBalanceCheckpoints[delegateIterator];
            BalanceCheckpoint storage lastCheckpoint = _getLastCheckpoint(balanceCheckpoints);

            uint256 newTokenAge = uint256(int256(_getTokenAge(lastCheckpoint, currentTime)) + tokenAgeChange);

            BalanceCheckpoint storage newCheckpoint = _pushCheckpoint(balanceCheckpoints);

            newCheckpoint.balance = uint192(int192(lastCheckpoint.balance) + balanceChange);
            newCheckpoint.tokenAge = newTokenAge;

            delegateIterator = _getLastCheckpoint(delegateCheckpoints[delegateIterator]).delegate;
            require(delegateIterator != delegate);
        }
    }

    // Token age helper

    function _getTokenAge(BalanceCheckpoint storage checkpoint, uint64 blockAt) internal view returns (uint256 tokenAge) {
        tokenAge = checkpoint.tokenAge + uint256(checkpoint.balance) * (blockAt - checkpoint.fromTime);
    }

    // getLastCheckpoint

    function _getLastCheckpoint(BalanceCheckpoint[] storage checkpoints) internal view returns (BalanceCheckpoint storage checkpoint) {
        if (checkpoints.length == 0) {
            checkpoint = _nilBalanceCheckpoint;
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }
    }

    function _getLastCheckpoint(DelegateCheckpoint[] storage checkpoints) internal view returns (DelegateCheckpoint storage checkpoint) {
        if (checkpoints.length == 0) {
            checkpoint = _nilDelegateCheckpoint;
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }
    }

    // getCheckpoint; binary search via https://en.wikipedia.org/wiki/Binary_search_algorithm#Procedure_for_finding_the_rightmost_element

    function _getCheckpoint(BalanceCheckpoint[] storage checkpoints, uint64 atTime) internal view returns (BalanceCheckpoint storage) {
        if (checkpoints.length == 0 || atTime < checkpoints[0].fromTime) return _nilBalanceCheckpoint;
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

    function _getCheckpoint(DelegateCheckpoint[] storage checkpoints, uint64 atTime) internal view returns (DelegateCheckpoint storage) {
        if (checkpoints.length == 0 || atTime < checkpoints[0].fromTime) return _nilDelegateCheckpoint;
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

    // pushCheckpoint

    function _pushCheckpoint(BalanceCheckpoint[] storage checkpoints) internal returns (BalanceCheckpoint storage checkpoint) {
        uint64 currentTime = _currentTime();

        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }
    }

    function _pushCheckpoint(DelegateCheckpoint[] storage checkpoints) internal returns (DelegateCheckpoint storage checkpoint) {
        uint64 currentTime = _currentTime();

        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].fromTime == currentTime) {
            checkpoint = checkpoints[checkpoints.length - 1];
        } else {
            checkpoint = checkpoints.push();
            checkpoint.fromTime = currentTime;
        }
    }

    // Time

    function _currentTime() internal view returns (uint64) {
        return _convertTime(block.number);
    }

    function _convertTime(uint256 blockNumber) internal pure returns (uint64) {
        return uint64(blockNumber);
    }
}