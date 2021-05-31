// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

abstract contract TokenAgeTime {
    function _currentTime() internal view returns (uint64) {
        return _convertTime(block.number);
    }

    function _convertTime(uint256 blockNumber) internal pure returns (uint64) {
        return uint64(blockNumber);
    }
}