// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/finance/VestingWalletUpgradeable.sol";

contract SteppedVestingUpgradeable is Initializable, VestingWalletUpgradeable {
    uint64 private _installments;

    function __SteppedVesting_init(uint64 installments_) internal onlyInitializing {
        __SteppedVesting_init_unchained(installments_);
    }

    function __SteppedVesting_init_unchained(uint64 installments_) internal onlyInitializing {
        _installments = installments_;
    }

    function installments() public view virtual returns (uint256) {
        return _installments;
    }

    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view override virtual returns (uint256) {
        if (timestamp < start()) {
            return 0;
        } else if (timestamp > start() + duration()) {
            return totalAllocation;
        } else {
            uint256 installment = (timestamp - start()) * installments() / duration();
            return (totalAllocation * installment) / installments();
        }
    }

    uint256[49] private __gap;
}
