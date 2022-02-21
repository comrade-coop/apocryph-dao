// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./DoubleEndedQueueUpgradeable.sol"; // "@openzeppelin/contracts-upgradeable/utils/structs/DoubleEndedQueueUpgradeable.sol"
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "../wizard/LockedApocryphToken.sol";

contract LockerUpgradeable is Initializable, ContextUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using DoubleEndedQueueUpgradeable for DoubleEndedQueueUpgradeable.Bytes32Deque;

    event Locked(address account, uint256 amount);
    event Unlocked(address account, uint256 amount);

    mapping(address => DoubleEndedQueueUpgradeable.Bytes32Deque) private _locked;

    IERC20Upgradeable public token;

    LockedApocryphToken public lockedToken;

    function __Locker_init(IERC20Upgradeable token_, LockedApocryphToken lockedToken_) internal onlyInitializing {
        __Locker_init_unchained(token_, lockedToken_);
    }

    function __Locker_init_unchained(IERC20Upgradeable token_, LockedApocryphToken lockedToken_) internal onlyInitializing {
        token = token_;
        lockedToken = lockedToken_;
    }

    function _packAmountAndBlock(uint256 amount, uint256 block_) private pure returns (bytes32 data) {
        data = 0x0;
        data |= bytes32(bytes28(SafeCastUpgradeable.toUint224(amount))) >> 0;
        data |= bytes32(bytes4(SafeCastUpgradeable.toUint32(block_))) >> 224;
    }

    function _unpackAmountAndBlock(bytes32 data) private pure returns (uint256 amount, uint256 block_) {
        amount = uint224(bytes28(data << 0));
        block_ = uint32(bytes4(data << 224));
    }

    function _lock(address account, uint256 amount) internal virtual {
        _locked[account].pushFront(_packAmountAndBlock(amount, block.number));

        emit Locked(account, amount);
    }

    function _beforeUnlock(address account, uint256 amount, uint256 lockedAt) internal virtual {
    }

    function _unlock(address account, uint256 amount) internal virtual {
        uint256 amountToUnlock = amount;
        while (amountToUnlock > 0) {
            (uint256 oldestAmount, uint256 oldestBlock) = _unpackAmountAndBlock(_locked[account].popBack());
            if (amountToUnlock < oldestAmount) {
                _beforeUnlock(account, amountToUnlock, oldestBlock);
                oldestAmount -= amountToUnlock;
                _locked[account].pushBack(_packAmountAndBlock(oldestAmount, oldestBlock));
                break;
            } else {
                _beforeUnlock(account, oldestAmount, oldestBlock);
                amountToUnlock -= oldestAmount;
            }
        }

        emit Unlocked(account, amount);
    }

    function lock(uint256 amount) public virtual {
        _lock(_msgSender(), amount);

        token.safeTransferFrom(_msgSender(), address(this), amount);
        lockedToken.mint(_msgSender(), amount);
    }

    function unlock(uint256 amount) public virtual {
        _unlock(_msgSender(), amount);

        lockedToken.burnFrom(_msgSender(), amount);
        token.transfer(_msgSender(), amount);
    }

    uint256[48] private __gap;
}
