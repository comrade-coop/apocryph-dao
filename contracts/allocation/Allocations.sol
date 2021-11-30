// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../util/Owned.sol";

contract Allocations is Owned {
    using SafeERC20 for IERC20;

    event AllocationChanged(address indexed recepient, uint256 amount);
    event ClaimProposed(address indexed recepient, uint256 amount);
    event ClaimRevoked(address indexed recepient, uint256 amount);
    event ClaimEnacted(address indexed recepient, uint256 amount);

    struct AllocationData {
        // Packed
        uint160 amount;
        uint96 lockDuration;
        uint160 claimAmount;
        uint96 claimStartTime;
        mapping(address => bool) supervisors;
    }

    mapping(address => AllocationData) internal allocationDatas;
    mapping(address => bool) internal globalSupervisors;
    uint256 internal defaultLockDuration;

    IERC20 internal _token;

    constructor(address owner_, IERC20 token_, uint256 defaultLockDuration_, address[] memory globalSupervisors_) Owned(owner_) {
        _token = token_;
        defaultLockDuration = defaultLockDuration_;
        for (uint256 i = 0; i < globalSupervisors_.length; i++) {
            globalSupervisors[globalSupervisors_[i]] = true;
        }
    }

    modifier onlyOwnerOrRecepient(address recepient) {
        require(msg.sender == owner || msg.sender == recepient);
        _;
    }

    modifier onlyOwnerOrSupervisorOrRecepient(address recepient) {
        require(msg.sender == owner || msg.sender == recepient || globalSupervisors[msg.sender] || allocationDatas[recepient].supervisors[msg.sender]);
        _;
    }

    // Supervisor

    function isSupervisor(address recepient, address supervisor) external view returns (bool) {
        if (recepient != address(0)) {
            return allocationDatas[recepient].supervisors[supervisor];
        } else {
            return globalSupervisors[supervisor];
        }
    }

    function isSupervisorFor(address recepient, address supervisor) external view returns (bool) {
        return allocationDatas[recepient].supervisors[supervisor] || globalSupervisors[supervisor];
    }

    /// @notice Make `supervisor` `toggle ? 'be' : 'no longer be'` a supervisor for `recepient != 0x0 ? recepient : 'all allocationDatas (past and future)'`.
    function setSupervisor(address recepient, address supervisor, bool toggle) onlyOwner external {
        if (recepient != address(0)) {
            AllocationData storage allocationData = allocationDatas[recepient];
            allocationData.supervisors[supervisor] = toggle;
        } else {
            globalSupervisors[supervisor] = toggle;
        }
    }

    // Allocation

    function allocation(address recepient) external view returns (uint256) {
        return allocationDatas[recepient].amount;
    }

    function increaseAllocation(address recepient, uint256 amount) onlyOwner external {
        AllocationData storage allocationData = allocationDatas[recepient];
        allocationData.amount = allocationData.amount + uint160(amount);

        emit AllocationChanged(recepient, allocationData.amount);
    }

    function revokeAllocation(address recepient, uint256 amount) onlyOwnerOrSupervisorOrRecepient(recepient) external {
        AllocationData storage allocationData = allocationDatas[recepient];

        allocationData.amount = allocationData.amount - uint160(amount);

        if (allocationData.claimAmount > allocationData.amount) {
            allocationData.claimAmount = allocationData.amount;
        }

        emit AllocationChanged(recepient, allocationData.amount);
    }

    // Lock duration

    function lockDurationRaw(address recepient) external view returns (uint256) {
        if (recepient == address(0)) {
            return defaultLockDuration;
        } else {
            return allocationDatas[recepient].lockDuration;
        }
    }

    /// @notice Set lock duration for `recepient != 0x0 ? recepient : 'all allocations (default value)'` to `lockDuration_ == 0 ? 'the default value' : lockDuration_ >= (-1 : uint96) ? 'instant' : lockDuration_ + ' blocks'`.
    function setLockDuration(address recepient, uint256 lockDuration_) onlyOwner external {
        if (recepient == address(0)) {
            defaultLockDuration = lockDuration_;
        } else {
            AllocationData storage allocationData = allocationDatas[recepient];
            allocationData.lockDuration = uint96(lockDuration_);
        }
    }

    function lockDuration(address recepient) external view returns (uint256) {
        return _lockDuration(allocationDatas[recepient]);
    }

    function unlockTime(address recepient) external view returns (uint256) {
        return _unlockTime(allocationDatas[recepient]);
    }

    function _unlockTime(AllocationData storage allocationData) private view returns (uint256) {
        return allocationData.claimStartTime + _lockDuration(allocationData);
    }

    function _lockDuration(AllocationData storage allocationData) private view returns (uint256) {
        uint96 storedLockDuration = allocationData.lockDuration;
        return storedLockDuration == 0 ? defaultLockDuration : storedLockDuration == ~uint96(0) ? 0 : storedLockDuration;
    }


    function _now() private view returns (uint96) {
        return uint96(block.number);
    }

    // Claim

    function claim(address recepient) external view returns (uint256) {
        return allocationDatas[recepient].claimAmount;
    }

    function increaseClaim(uint256 amount) external {
        address recepient = msg.sender;
        AllocationData storage allocationData = allocationDatas[recepient];
        require(amount != 0 && allocationData.amount > 0);

        allocationData.claimAmount = allocationData.claimAmount + uint160(amount);

        if (allocationData.claimAmount > allocationData.amount) {
            allocationData.claimAmount = allocationData.amount;
        }
        allocationData.claimStartTime = _now();

        emit ClaimProposed(recepient, allocationData.claimAmount);
    }

    function revokeClaim(address recepient) onlyOwnerOrSupervisorOrRecepient(recepient) external {
        AllocationData storage allocationData = allocationDatas[recepient];
        // require(_now() < _unlockTime(allocationData));

        uint256 claimAmount = allocationData.claimAmount;
        allocationData.claimAmount = 0;
        allocationData.claimStartTime = 0;

        emit ClaimRevoked(recepient, claimAmount);
    }

    function unlockClaim(address recepient) onlyOwner external {
        AllocationData storage allocationData = allocationDatas[recepient];

        allocationData.claimStartTime = 0;

        //emit ClaimUnlocked(recepient); // Seems excessive, since claim unlocking is not likely to happen
    }

    function enactClaim() external {
        address recepient = msg.sender;

        AllocationData storage allocationData = allocationDatas[recepient];
        require(_now() >= _unlockTime(allocationData));

        uint256 amount = allocationData.claimAmount;
        allocationData.amount = allocationData.amount - uint160(amount);
        allocationData.claimAmount = 0;
        allocationData.claimStartTime = 0;

        _token.safeTransfer(recepient, amount);
        // _token.safeTransferFrom(owner, recepient, amount);

        emit ClaimEnacted(recepient, amount);
    }

    // Withdraw

    function withdraw(address recepient, uint256 amount) onlyOwner external {
        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        _token.safeTransfer(recepient, amount);
    }
}
