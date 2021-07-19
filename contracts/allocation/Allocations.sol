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
        uint256 lockTime;
        uint256 claimAmount;
        uint256 claimStartTime;
        mapping(address => bool) supervisors;
    }

    mapping(address => AllocationData) internal allocationDatas;
    mapping(address => bool) internal globalSupervisors;
    uint256 internal defaultLockTime;

    address internal _voting; // TODO: Should used `voting/Owned` instead?
    IERC20 internal _token;

    constructor(IERC20 token_, address voting_, uint256 defaultLockTime_, address[] memory globalSupervisors_) {
        _token = token_;
        _voting = voting_;
        defaultLockTime = defaultLockTime_;
        for (uint256 i = 0; i < globalSupervisors_.length; i++) {
            globalSupervisors[globalSupervisors_[i]] = true;
        }
    }

    // Allocation

    function allocation(address recepient) external view returns (uint256) {
        return allocationDatas[recepient].amount;
    }

    function increaseAllocation(address recepient, uint256 amount) external {
        require(msg.sender == _voting);

        AllocationData storage allocationData = allocationDatas[recepient];
        allocationData.amount = allocationData.amount + amount;

        emit AllocationChanged(recepient, allocationData.amount);
    }

    function revokeAllocation(address recepient, uint256 amount) external {
        AllocationData storage allocationData = allocationDatas[recepient];
        require(msg.sender == _voting || msg.sender == recepient || allocationData.supervisors[msg.sender]);

        allocationData.amount = allocationData.amount - amount;

        if (allocationData.claimAmount > allocationData.amount) {
            allocationData.claimAmount = allocationData.amount;
        }

        emit AllocationChanged(recepient, allocationData.amount);
    }

    // Supervisor

    function isSupervisor(address recepient, address supervisor) external view returns (bool) {
        AllocationData storage allocationData = allocationDatas[recepient];
        return allocationData.supervisors[supervisor] || globalSupervisors[supervisor];
    }

    /// @notice Make `supervisor` `toggle ? 'be' : 'no longer be'` a supervisor for `recepient != 0x0 ? recepient : 'all allocationDatas (past and future)'`.
    function setSupervisor(address recepient, address supervisor, bool toggle) external {
        require(msg.sender == _voting);

        if (recepient != address(0)) {
            AllocationData storage allocationData = allocationDatas[recepient];
            allocationData.supervisors[supervisor] = toggle;
        } else {
            globalSupervisors[supervisor] = toggle;
        }
    }

    // Lock time

    function lockTime(address recepient) external view returns (uint256) {
        if (recepient != address(0)) {
            return defaultLockTime;
        } else {
            AllocationData storage allocationData = allocationDatas[recepient];
            return allocationData.lockTime;
        }
    }

    function unlockTime(address recepient) external view returns (uint256) {
        return _getUnlockTime(allocationDatas[recepient]);
    }

    /// @notice Set timelock for `recepient != 0x0 ? recepient : 'all allocationDatas (default value)'` to `timelock == 0 ? 'the default value' : timelock == (-1 : uint256) ? 'instant' : timelock + ' blocks'`.
    function setLockTime(address recepient, uint256 lockTime_) external {
        require(msg.sender == _voting);

        if (recepient != address(0)) {
            defaultLockTime = lockTime_;
        } else {
            AllocationData storage allocationData = allocationDatas[recepient];
            allocationData.lockTime = lockTime_;
        }
    }

    function _getUnlockTime(AllocationData storage allocationData) private view returns (uint256) {
        uint256 storedLockTime = allocationData.lockTime;
        uint256 x = storedLockTime == 0 ? defaultLockTime : storedLockTime == ~uint256(0) ? 0 : storedLockTime;
        return allocationData.claimStartTime + x;
    }

    function _now() private view returns (uint256) {
        return block.number;
    }

    // Claim

    function claim(address recepient) external view returns (uint256) {
        return allocationDatas[recepient].claimAmount;
    }

    function increaseClaim(uint256 amount) external {
        address recepient = msg.sender;
        AllocationData storage allocationData = allocationDatas[recepient];
        require(amount != 0 && allocationData.amount > 0);

        allocationData.claimAmount = allocationData.claimAmount + amount;
        if (allocationData.claimAmount > allocationData.amount) {
            allocationData.claimAmount = allocationData.amount;
        }
        allocationData.claimStartTime = _now();

        emit ClaimProposed(recepient, allocationData.claimAmount);
    }

    function revokeClaim(address recepient) external {
        AllocationData storage allocationData = allocationDatas[recepient];
        require(msg.sender == _voting || msg.sender == recepient || allocationData.supervisors[msg.sender] || globalSupervisors[msg.sender]);
        // require(_now() < _getUnlockTime(allocationData));

        uint256 claimAmount = allocationData.claimAmount;
        allocationData.claimAmount = 0;
        allocationData.claimStartTime = 0;

        emit ClaimRevoked(recepient, claimAmount);
    }

    function unlockClaim(address recepient) external {
        require(msg.sender == _voting);
        AllocationData storage allocationData = allocationDatas[recepient];

        allocationData.claimStartTime = 0;

        //emit ClaimUnlocked(recepient); // Seems excessive, since claim unlocking is not likely to happen
    }

    function enactClaim() external {
        address recepient = msg.sender;

        AllocationData storage allocationData = allocationDatas[recepient];
        require(_now() >= _getUnlockTime(allocationData));

        uint256 amount = allocationData.claimAmount;
        if (amount > allocationData.amount) {
            amount = allocationData.amount;
        }
        allocationData.amount = allocationData.amount - amount;
        allocationData.claimAmount = 0;
        allocationData.claimStartTime = 0;

        _token.safeTransfer(recepient, amount);
        // _token.safeTransferFrom(_voting, recepient, amount);

        emit ClaimEnacted(recepient, amount);
    }

    // withdraw

    function withdraw(address recepient, uint256 amount) external {
        require(msg.sender == _voting);

        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        _token.safeTransfer(recepient, amount);
    }
}
