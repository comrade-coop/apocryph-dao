// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "./IVotingBase.sol";

interface IVoting is IVotingBase {
    event Vote(uint256 voteId, address voter, VoteStatus value);

    enum VoteStatus { Nil, Yes, No }

    function vote(uint256 voteId, VoteStatus value) external;
    function voteOf(uint256 voteId, address voter) external returns (VoteStatus);
}
