// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "./LockerUpgradeable.sol";
import "hardhat/console.sol";

abstract contract TimeLockerUpgradeable is LockerUpgradeable {
    uint256 public lockTime;

    function __TimeLocker_init(uint256 lockTime_) internal onlyInitializing {
        __TimeLocker_init_unchained(lockTime_);
    }

    function __TimeLocker_init_unchained(uint256 lockTime_) internal onlyInitializing {
        lockTime = lockTime_;
    }

    function _setLockTime(uint256 lockTime_) internal {
        lockTime = lockTime_;
    }

    function _beforeUnlock(address, uint256, uint256 lockedAt) internal virtual override {
        require(block.number >= lockedAt + lockTime, "TimeLocker: amount not yet unlocked");
    }

    uint256[49] private __gap;
}