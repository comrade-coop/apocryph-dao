// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "./IVotingBase.sol";

interface IVoting is IVotingBase {
    event Vote(bytes32 indexed voteId, address indexed voter, VoteStatus value);

    enum VoteStatus { Nil, Yes, No }

    function vote(bytes32 voteId, VoteStatus value) external;
    function voteOf(bytes32 voteId, address voter) external returns (VoteStatus);
}
