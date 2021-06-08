// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Allocations {
    using SafeERC20 for IERC20;

    event AllocationChanged(address recepient, uint256 amount);
    event ClaimProposed(address recepient, uint256 amount);
    event ClaimRevoked(address recepient, uint256 amount);
    event ClaimEnacted(address recepient, uint256 amount);

    struct AllocationData { // Can potentially optimize storage by storing amounts as uint128 and time as uint64; 3 storage slots total instead of 5
        uint256 amount;
        uint256 transferredAmount;
        uint256 claimedAmount;
        uint256 lockTime;
        uint256 claimStartTime;
        mapping(address => bool) supervisors;
    }

    mapping(address => AllocationData) internal allocations; // TODO: Expose getters
    mapping(address => bool) internal globalSupervisors;
    uint256 internal defaultLockTime;

    address internal _voting;
    IERC20 internal _token;

    constructor(IERC20 token_, address voting_, uint256 defaultLockTime_, address[] memory globalSupervisors_) {
        _token = token_;
        _voting = voting_;
        defaultLockTime = defaultLockTime_;
        for (uint256 i = 0; i < globalSupervisors_.length; i++) {
            globalSupervisors[globalSupervisors_[i]] = true;
        }
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

    /// @notice Set timelock for `recepient == 0x0 ? recepient : 'all allocations (default value)'` to `timelock == 0 ? 'the default value' : timelock == (-1 : uint256) ? 'instant' : timelock + ' blocks'`.
    function setLockTime(address recepient, uint256 lockTime) external {
        require(msg.sender == _voting);

        if (recepient == address(0)) {
            defaultLockTime = lockTime;
        } else {
            AllocationData storage allocation = allocations[recepient];
            allocation.lockTime = lockTime;
        }
    }

    // TODO: Change to setAllocation?!
    function increaseAllocation(address recepient, uint256 amount) external {
        require(msg.sender == _voting);

        AllocationData storage allocation = allocations[recepient];
        allocation.amount = allocation.amount + amount;

        emit AllocationChanged(recepient, allocation.amount);
        // notify if contract
    }

    function revokeAllocation(address recepient, uint256 amount) external {
        AllocationData storage allocation = allocations[recepient];
        require(msg.sender == _voting || msg.sender == recepient || allocation.supervisors[msg.sender]);

        allocation.amount = allocation.amount - amount;

        if (allocation.claimedAmount > allocation.amount) {
            allocation.claimedAmount = allocation.amount;
        }

        emit AllocationChanged(recepient, allocation.amount);
        // notify if contract
    }

    function proposeClaim(uint256 amount) external {
        address recepient = msg.sender;
        AllocationData storage allocation = allocations[recepient];
        require(amount != 0 && allocation.amount > 0);

        allocation.claimedAmount = allocation.claimedAmount + amount;
        if (allocation.claimedAmount > allocation.amount) {
            allocation.claimedAmount = allocation.amount;
        }
        allocation.claimStartTime = _now();

        emit ClaimProposed(recepient, allocation.claimedAmount);
    }

    function revokeClaim(address recepient) external {
        AllocationData storage allocation = allocations[recepient];
        require(msg.sender == _voting || msg.sender == recepient || allocation.supervisors[msg.sender] || globalSupervisors[msg.sender]);
        // require(_now() < allocation.claimStartTime + _convertLockTime(allocation.lockTime));

        uint256 claimAmount = allocation.claimedAmount;
        allocation.claimedAmount = 0;
        allocation.claimStartTime = 0;

        emit ClaimRevoked(recepient, claimAmount);
    }

    function unlockClaim(address recepient) external {
        require(msg.sender == _voting);
        AllocationData storage allocation = allocations[recepient];

        allocation.claimStartTime = 0;

        //? emit ClaimUnlocked(recepient);
    }

    function enactClaim() external {
        address recepient = msg.sender;
        AllocationData storage allocation = allocations[recepient];
        require(_now() >= allocation.claimStartTime + _convertLockTime(allocation.lockTime));

        uint256 amount = allocation.claimedAmount;
        if (amount > allocation.amount) {
            amount = allocation.amount;
        }
        allocation.amount = allocation.amount - amount;
        allocation.claimedAmount = 0;
        allocation.claimStartTime = 0;

        allocation.transferredAmount = allocation.transferredAmount + amount;
        _token.safeTransfer(recepient, amount);
        // _token.safeTransferFrom(_voting, recepient, amount);

        emit ClaimEnacted(recepient, amount);
    }

    function _convertLockTime(uint256 storedLockTime) private view returns (uint256) {
        return storedLockTime == 0 ? defaultLockTime : storedLockTime == ~uint256(0) ? 0 : storedLockTime;
    }

    function _now() private view returns (uint256) {
        return block.number;
    }
}
