// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

interface IVotingBase {
    event Proposal(bytes32 indexed voteId, bytes32 rationale, bytes32 actionsHash);
    event Enaction(bytes32 indexed voteId, bytes32 rationale, bytes32 actionsHash);

    struct VoteAction {
        // uint96 value;
        address target;
        bytes data;
        // deadline
    }

    // voteId = keccak256(abi.encodePacked(rationale, actionsHash))
    // actionsHash = keccak256(abi.encode(actions_));

    function propose(bytes32 rationale, bytes32 actionsHash) external returns (bytes32 voteId);

    function proposed(bytes32 voteId) external view returns (bool);

    function enact(bytes32 rationale, VoteAction[] calldata actions) external;

    function enacted(bytes32 voteId) external view returns (bool);
}
