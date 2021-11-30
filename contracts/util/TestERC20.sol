// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TestERC20 is ERC20 {
    constructor (string memory name_, address[] memory initialAddresses, uint256[] memory initialBalances) ERC20(name_, name_) {
        require(initialAddresses.length == initialBalances.length);
        for (uint i = 0; i < initialAddresses.length; i++) {
            _mint(initialAddresses[i], initialBalances[i]);
        }
    }
}
