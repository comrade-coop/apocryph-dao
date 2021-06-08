// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./TokenAgeERC1363.sol";
import "./TokenAgeWeights.sol";

contract TokenAgeToken is TokenAgeERC1363, TokenAgeWeights {
    string public name;
    string public symbol;
    uint8 public decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address[] memory initialOwners, uint128[] memory initialBalances) {
        require(initialOwners.length == initialBalances.length);
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        for (uint256 i = 0; i < initialOwners.length; i++) {
            _add(_checkpoints[initialOwners[i]], initialBalances[i]);
            totalSupply += uint256(initialBalances[i]);
        }
    }

    // Via https://github.com/ethereum/EIPs/issues/738#issuecomment-336277632
    function safeApprove(address to_, uint256 value_, uint256 oldValue_) public returns (bool) {
        require(allowance[_msgSender()][to_] == oldValue_);
        _approve(_msgSender(), to_, value_);
        return true;
    }
}