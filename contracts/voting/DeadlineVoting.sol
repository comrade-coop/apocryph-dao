// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "./IVoting.sol";
import "./VotingBase.sol";
import "./Owned.sol";
import "../interfaces/IVotingWeights.sol";

contract DeadlineVoting is Owned, VotingBase, IVoting {
    mapping(uint256 => mapping(address => VoteStatus)) public override voteOf;

    struct VoteCounts {
        uint256 countYes;
        uint256 countNo;
    }

    mapping(uint256 => VoteCounts) public voteCounts;
    mapping(uint256 => uint256) public voteStartBlock;

    IVotingWeights public weights;
    uint256 public voteDeadline; // in blocks

    constructor(address proposer_, address enacter_, address owner_, IVotingWeights weights_, uint256 voteDeadline_)
            Owned(owner_ != address(0) ? owner_ : address(this))
            VotingBase(proposer_, enacter_) {
        weights = weights_;
        voteDeadline = voteDeadline_;
    }

    function setVoteDeadline(uint256 voteDeadline_) external onlyOwner {
        voteDeadline = voteDeadline_;
    }

    function proposed(uint256 voteId) internal override {
        voteStartBlock[voteId] = block.number;
    }

    function enacted(uint256 voteId) internal override {
        // delete voteStartBlock[voteId];
        // delete voteCounts[voteId];
    }

    function isActive(uint256 voteId) internal view returns (bool) {
        return block.number < voteStartBlock[voteId] + voteDeadline;
    }

    function canEnact(uint256 voteId) internal override view returns (bool) {
        return !isActive(voteId) && voteCounts[voteId].countYes > voteCounts[voteId].countNo;
    }

    function vote(uint256 voteId, VoteStatus value) external override {
        _vote(voteId, msg.sender, value);
    }

    function _vote(uint256 voteId, address voter, VoteStatus value) internal {
        require(isActive(voteId));
        uint256 weight = weights.weightOfAt(voter, voteStartBlock[voteId]);
        require(weight > 0);

        VoteStatus oldValue = voteOf[voteId][msg.sender];
        if (oldValue == VoteStatus.Yes) {
            voteCounts[voteId].countYes -= weight;
        } else if (oldValue == VoteStatus.No) {
            voteCounts[voteId].countNo -= weight;
        }

        voteOf[voteId][voter] = value;
        if (value == VoteStatus.Yes) {
            voteCounts[voteId].countYes += weight;
        } else if (value == VoteStatus.No) {
            voteCounts[voteId].countNo += weight;
        }
        emit Vote(voteId, voter, value);
    }
}
