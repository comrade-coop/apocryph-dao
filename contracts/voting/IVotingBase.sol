// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

interface IVotingBase {
    event Proposal(uint256 voteId);
    event Enaction(uint256 voteId);

    struct VoteAction {
        // uint96 value;
        address target;
        bytes data;
        // deadline
    }

    function propose(bytes32 rationale_, bytes32 actionsRoot_) external returns (uint256);

    function rationale(uint256 voteId) external view returns (bytes32);
    function actionsRoot(uint256 voteId) external view returns (bytes32);

    function enact(uint256 voteId, VoteAction[] calldata actions_) external;
}
