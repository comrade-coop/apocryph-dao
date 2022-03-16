// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "../vesting/SteppedVestingUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/finance/VestingWalletUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @custom:security-contact apocryph@comrade.coop
contract ApocryphVesting is Initializable, AccessControlUpgradeable, VestingWalletUpgradeable, SteppedVestingUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function initialize(address owner, address beneficiary, uint64 startTimestamp, uint64 durationSeconds, uint64 installments) initializer public {
        __VestingWallet_init(beneficiary, startTimestamp, durationSeconds);
        __SteppedVesting_init(installments);
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(UPGRADER_ROLE, owner);
    }

    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal
        view
        override(VestingWalletUpgradeable, SteppedVestingUpgradeable)
    returns (uint256) {
        return super._vestingSchedule(totalAllocation, timestamp);
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        onlyRole(UPGRADER_ROLE)
        override
    {}
}
