// SPDX-License-Identifier: MIT
// Via https://github.com/vittominacori/erc1363-payable-token/blob/f570e5a12a6846e113ba3ea5f912be58430a939b/contracts/token/ERC1363/ERC1363.sol

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../interfaces/IERC1363.sol";
import "../interfaces/IERC1363Receiver.sol";
import "../interfaces/IERC1363Spender.sol";
import "./TokenAgeERC20.sol";

abstract contract TokenAgeERC1363 is IERC1363, ERC165, TokenAgeERC20 {
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC1363).interfaceId
            || super.supportsInterface(interfaceId);
    }

    // transfer

    function transferAndCall(address recipient, uint256 amount) public override returns (bool) {
        return transferAndCall(recipient, amount, "");
    }

    function transferAndCall(address recipient, uint256 amount, bytes memory data) public override returns (bool) {
        transfer(recipient, amount);
        _callTransferReceived(_msgSender(), recipient, amount, data);
        return true;
    }

    // transferFrom

    function transferFromAndCall(address sender, address recipient, uint256 amount) public override returns (bool) {
        return transferFromAndCall(sender, recipient, amount, "");
    }

    function transferFromAndCall(address sender, address recipient, uint256 amount, bytes memory data) public override returns (bool) {
        transferFrom(sender, recipient, amount);
        _callTransferReceived(sender, recipient, amount, data);
        return true;
    }

    // approve

    function approveAndCall(address spender, uint256 amount) public override returns (bool) {
        return approveAndCall(spender, amount, "");
    }

    function approveAndCall(address spender, uint256 amount, bytes memory data) public override returns (bool) {
        approve(spender, amount);
        _callApprovalReceived(spender, amount, data);
        return true;
    }

    // interface

    function _callTransferReceived(address sender, address recipient, uint256 amount, bytes memory data) internal { // Reverts if recipient is invalid
        bytes4 retval = IERC1363Receiver(recipient).onTransferReceived(
            _msgSender(), sender, amount, data
        );
        require(retval == IERC1363Receiver.onTransferReceived.selector);
    }

    function _callApprovalReceived(address spender, uint256 amount, bytes memory data) internal { // Reverts if spender is invalid
        bytes4 retval = IERC1363Spender(spender).onApprovalReceived(
            _msgSender(), amount, data
        );
        require(retval == IERC1363Spender.onApprovalReceived.selector);
    }
}