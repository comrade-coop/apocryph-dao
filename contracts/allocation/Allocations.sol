// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../util/Owned.sol";

contract Allocations is Owned {
    using SafeERC20 for IERC20;

    event AllocationChanged(address indexed recepient, address indexed token, uint256 amount);
    event ClaimProposed(address indexed recepient, address indexed token, uint256 amount);
    event ClaimRevoked(address indexed recepient, address indexed token, uint256 amount);
    event ClaimEnacted(address indexed recepient, address indexed token, uint256 amount);

    struct AllocationData {
        // Packed
        uint160 amount;
        uint96 lockDuration;
        uint160 claimAmount;
        uint96 claimStartTime;
    }

    mapping(address => mapping(address => AllocationData)) internal allocationDatas; // recepient => token => {..}
    mapping(address => mapping(address => bool)) public isSupervisor; // recepient | nil(global) => supervisor => bool

    constructor(address owner_, uint256 defaultLockDuration_, address[] memory globalSupervisors_) Owned(owner_) {
        allocationDatas[address(0)][address(0)].lockDuration = uint96(defaultLockDuration_);
        for (uint256 i = 0; i < globalSupervisors_.length; i++) {
            isSupervisor[address(0)][globalSupervisors_[i]] = true;
        }
    }

    modifier onlyOwnerOrRecepient(address recepient) {
        require(msg.sender == owner || msg.sender == recepient);
        _;
    }

    modifier onlyOwnerOrSupervisorOrRecepient(address recepient) {
        require(msg.sender == owner || msg.sender == recepient || isSupervisorFor(recepient, msg.sender));
        _;
    }

    // Supervisor

    function isSupervisorFor(address recepient, address supervisor) public view returns (bool) {
        return isSupervisor[recepient][supervisor] || isSupervisor[address(0)][supervisor];
    }

    /// @notice Make `supervisor` `toggle ? 'be' : 'no longer be'` a supervisor for `recepient != 0x0 ? recepient : 'all allocations (past and future)'`.
    function setSupervisor(address recepient, address supervisor, bool toggle) onlyOwner external {
        isSupervisor[recepient][supervisor] = toggle;
    }

    // Allocation

    function allocation(address recepient, address token) external view returns (uint256) {
        return allocationDatas[recepient][token].amount;
    }

    function increaseAllocation(address recepient, address token, uint256 amount) onlyOwner external {
        AllocationData storage allocationData = allocationDatas[recepient][token];
        allocationData.amount = allocationData.amount + uint160(amount);

        emit AllocationChanged(recepient, token, allocationData.amount);
    }

    function revokeAllocation(address recepient, address token, uint256 amount) onlyOwnerOrSupervisorOrRecepient(recepient) external {
        AllocationData storage allocationData = allocationDatas[recepient][token];

        if (amount > allocationData.amount) {
            amount = allocationData.amount;
        }

        allocationData.amount = allocationData.amount - uint160(amount);

        if (allocationData.claimAmount > allocationData.amount) {
            allocationData.claimAmount = allocationData.amount;
        }

        emit AllocationChanged(recepient, token, allocationData.amount);
    }

    // Lock duration

    function lockDurationRaw(address recepient, address token) external view returns (uint256) {
        return allocationDatas[recepient][token].lockDuration;
    }

    /// @notice Set lock duration for `recepient != 0x0 ? recepient : 'all allocations (default value)'` and `token != 0x0 ? token : 'all tokens'` to `lockDuration_ == 0 ? 'the default value' : lockDuration_ >= (-1 : uint96) ? 'instant' : lockDuration_ + ' blocks'`.
    function setLockDuration(address recepient, address token, uint256 lockDuration_) onlyOwner external {
        allocationDatas[recepient][token].lockDuration = uint96(lockDuration_);
    }

    function lockDuration(address recepient, address token) external view returns (uint256) {
        return _lockDuration(allocationDatas[recepient][token]);
    }

    function _lockDuration(AllocationData storage allocationData) private view returns (uint256) {
        uint96 storedLockDuration = allocationData.lockDuration;
        return storedLockDuration == 0 ? allocationDatas[address(0)][address(0)].lockDuration : storedLockDuration == ~uint96(0) ? 0 : storedLockDuration;
    }

    function unlockTime(address recepient, address token) external view returns (uint256) {
        return _unlockTime(allocationDatas[recepient][token]);
    }

    function _unlockTime(AllocationData storage allocationData) private view returns (uint256) {
        return allocationData.claimStartTime + _lockDuration(allocationData);
    }


    function _now() private view returns (uint96) {
        return uint96(block.number);
    }

    // Claim

    function claim(address recepient, address token) external view returns (uint256) {
        return allocationDatas[recepient][token].claimAmount;
    }

    function increaseClaim(address token, uint256 amount) external {
        address recepient = msg.sender;
        AllocationData storage allocationData = allocationDatas[recepient][token];
        require(amount != 0 && allocationData.amount > 0);

        allocationData.claimAmount = allocationData.claimAmount + uint160(amount);

        if (allocationData.claimAmount > allocationData.amount) {
            allocationData.claimAmount = allocationData.amount;
        }
        allocationData.claimStartTime = _now();

        emit ClaimProposed(recepient, token, allocationData.claimAmount);
    }

    function revokeClaim(address recepient, address token) onlyOwnerOrSupervisorOrRecepient(recepient) external {
        AllocationData storage allocationData = allocationDatas[recepient][token];
        // require(_now() < _unlockTime(allocationData));

        uint256 claimAmount = allocationData.claimAmount;
        allocationData.claimAmount = 0;
        allocationData.claimStartTime = 0;

        emit ClaimRevoked(recepient, token, claimAmount);
    }

    function unlockClaim(address recepient, address token) onlyOwner external {
        AllocationData storage allocationData = allocationDatas[recepient][token];

        allocationData.claimStartTime = 0;

        //emit ClaimUnlocked(recepient, token); // Seems excessive, since claim unlocking is rare
    }

    function enactClaim(address token) external {
        address recepient = msg.sender;

        AllocationData storage allocationData = allocationDatas[recepient][token];
        require(_now() >= _unlockTime(allocationData));

        uint256 amount = allocationData.claimAmount;
        require(amount > 0);

        allocationData.amount = allocationData.amount - uint160(amount);
        allocationData.claimAmount = 0;
        allocationData.claimStartTime = 0;

        // NOTE: We can trust that the owner has approved the token because we know allocationDatas[recepient][token].amount>0 which can only happen through increaseAllocation.
        _transfer(recepient, token, amount);

        emit ClaimEnacted(recepient, token, amount);
    }

    // Withdraw

    function withdraw(address recepient, address token, uint256 amount) onlyOwner external {
        if (recepient == address(0)) {
            recepient = msg.sender;
        }

        _transfer(recepient, token, amount);
    }

    // Transfers

    function _transfer(address recepient, address token, uint256 amount) internal {
        if (token == address(0)) {
            payable(recepient).transfer(amount);
        } else {
            IERC20(token).safeTransfer(recepient, amount);
            // _token.safeTransferFrom(owner, recepient, amount);
        }
    }

    receive() external payable {
        // allow
    }
}
