// SPDX-License-Identifier: CC0-1.0
// via https://eips.ethereum.org/EIPS/eip-1363

pragma solidity ^0.8.0;

interface IERC1363Spender {

    /**
     * @notice Handle the approval of ERC1363 tokens
     * @dev Any ERC1363 smart contract calls this function on the recipient
     * after an `approve`. This function MAY throw to revert and reject the
     * approval. Return of other than the magic value MUST result in the
     * transaction being reverted.
     * Note: the token contract address is always the message sender.
     * @param owner address The address which called `approveAndCall` function
     * @param value uint256 The amount of tokens to be spent
     * @param data bytes Additional data with no specified format
     * @return `bytes4(keccak256("onApprovalReceived(address,uint256,bytes)"))`
     *  unless throwing
     */
    function onApprovalReceived(address owner, uint256 value, bytes memory data) external returns (bytes4);
}
