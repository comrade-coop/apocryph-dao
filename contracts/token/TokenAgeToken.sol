// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TokenAgeERC1363.sol";
import "./TokenAgeWeights.sol";

contract TokenAgeToken is TokenAgeERC1363, TokenAgeWeights {
    event Delegate(address indexed from, address indexed to);

    string public name;
    string public symbol;
    uint8 public decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address[] memory initialOwners, uint128[] memory initialBalances) {
        require(initialOwners.length == initialBalances.length);
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        for (uint256 i = 0; i < initialOwners.length; i++) {
            _add(initialOwners[i], initialBalances[i]);
            totalSupply += uint256(initialBalances[i]);
        }
    }

    function delegate(address to_) public {
        _setDelegate(_msgSender(), to_);

        emit Delegate(_msgSender(), to_);
    }
}