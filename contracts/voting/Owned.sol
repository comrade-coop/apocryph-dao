// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract Owned {
    address public owner;

    constructor(address owner_) {
        if (owner_ != address(0)) {
            owner = owner_;
        } else {
            owner = address(this);
        }
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
