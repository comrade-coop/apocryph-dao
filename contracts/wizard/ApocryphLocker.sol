// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "../locker/TimeLockerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @custom:security-contact apocryph@comrade.coop
contract ApocryphLocker is Initializable, AccessControlUpgradeable, LockerUpgradeable, TimeLockerUpgradeable, UUPSUpgradeable {
    bytes32 public constant SETTINGS_ROLE = keccak256("SETTINGS_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function initialize(IERC20Upgradeable token_, LockedApocryphToken lockedToken_) initializer public {
        __Locker_init(token_, lockedToken_);
        __TimeLocker_init(123428 /* 3 days */);
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTINGS_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
    }

    function setLockTime(uint256 lockTime_) public onlyRole(SETTINGS_ROLE) {
        _setLockTime(lockTime_);
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        onlyRole(UPGRADER_ROLE)
        override
    {}

    // The following functions are overrides required by Solidity.

    function _beforeUnlock(address account, uint256 amount, uint256 lockedAt)
        internal
        override(LockerUpgradeable, TimeLockerUpgradeable)
    {
        return super._beforeUnlock(account, amount, lockedAt);
    }
}
