// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Allocations {
    using SafeMath for uint256;

    struct AllocationData {
        uint256 amount;
        uint256 transferredAmount;
        uint256 lockTime;
        uint256 claimedAmount;
        uint256 claimStartTime;
        mapping(address => bool) supervisors;
    }

    mapping(address => AllocationData) internal allocations;
    mapping(address => bool) internal globalSupervisors;
    uint256 internal defaultLockTime;

    address internal _voting;
    IERC20 internal _token;

    constructor(address voting_, IERC20 token_) {
        _voting = voting_;
        _token = token_;
    }

    /// @notice Make `supervisor` `toggle ? 'be' : 'no longer be'` a supervisor for `recepient == 0x0 ? recepient : 'all allocations (past and future)'`.
    function setSupervisor(address recepient, address supervisor, bool toggle) external {
        require(msg.sender == _voting);

        if (recepient == address(0)) {
            AllocationData storage allocation = allocations[recepient];
            allocation.supervisors[supervisor] = toggle;
        } else {
            globalSupervisors[supervisor] = toggle;
        }
    }

    /// @notice Set timelock for `recepient == 0x0 ? recepient : 'all allocations (by default)' to `timelock == (-1 : uint256) ? 'instant' : timelock + ' blocks'`.
    function setLockTime(address recepient, uint256 lockTime) external {
        require(msg.sender == _voting);

        AllocationData storage allocation = allocations[recepient];
        allocation.lockTime = lockTime;
    }

    function increaseAllocation(address recepient, uint256 amount) external {
        require(msg.sender == _voting);

        AllocationData storage allocation = allocations[recepient];
        allocation.amount = allocation.amount.sub(amount);
        // event; notify if contract
    }

    function revokeAllocation(address recepient, uint256 amount) external {
        AllocationData storage allocation = allocations[recepient];
        require(msg.sender == _voting || msg.sender == recepient || allocation.supervisors[msg.sender]);

        allocation.amount = allocation.amount.sub(amount);

        if (allocation.claimedAmount > allocation.amount) {
            allocation.claimedAmount = allocation.amount;
        }

        // event; notify if contract
    }

    function createClaim(uint256 amount) external {
        address recepient = msg.sender;
        AllocationData storage allocation = allocations[recepient];
        require(amount != 0 && allocation.amount > 0);

        allocation.claimedAmount = allocation.claimedAmount.add(amount);
        if (allocation.claimedAmount > allocation.amount) {
            allocation.claimedAmount = allocation.amount;
        }
        allocation.claimStartTime = _now();

        // event
    }

    function revokeClaim(address recepient) external {
        AllocationData storage allocation = allocations[recepient];
        require(msg.sender == _voting || msg.sender == recepient || allocation.supervisors[msg.sender]);
        //? require(_now() < _unlockTime(allocation));

        allocation.claimedAmount = 0;
        allocation.claimStartTime = 0;
        // event
    }

    function unlockClaim(address recepient) external {
        require(msg.sender == _voting);
        AllocationData storage allocation = allocations[recepient];

        allocation.claimStartTime = 0;
        // event
    }

    function enactClaim() external {
        address recepient = msg.sender;
        AllocationData storage allocation = allocations[recepient];
        require(_now() >= _unlockTime(allocation));

        uint256 amount = allocation.claimedAmount;
        if (amount > allocation.amount) {
            amount = allocation.amount;
        }
        allocation.amount = allocation.amount.sub(amount); // NOTE: Double check
        allocation.claimedAmount = 0;
        allocation.claimStartTime = 0;

        allocation.transferredAmount = allocation.transferredAmount.add(amount);
        _token.transfer(recepient, amount);
        // _token.transferFrom(_voting, recepient, amount);
    }

    function _unlockTime(AllocationData storage allocation) private view returns (uint256) {
        return allocation.lockTime == ~uint256(0) ? 0 : allocation.claimStartTime.add(allocation.lockTime);
    }

    function _now() private view returns (uint256) {
        return block.number;
    }
}
