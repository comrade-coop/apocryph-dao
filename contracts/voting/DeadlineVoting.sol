// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "./IVoting.sol";
import "./VotingBase.sol";
import "./Owned.sol";
import "../interfaces/IVotingWeights.sol";

contract DeadlineVoting is VotingBase, IVoting {
    struct VoteCounts {
        uint256 countYes;
        uint256 countNo;
    }

    mapping(uint256 => mapping(address => VoteStatus)) public override voteOf;
    mapping(uint256 => VoteCounts) public voteCounts;
    mapping(uint256 => mapping(address => uint256)) public reducedWeight;
    mapping(uint256 => uint256) public voteStartBlock;

    IVotingWeights public weights;
    uint256 public voteDeadline; // in blocks

    constructor(address owner_, address proposer_, address enacter_, IVotingWeights weights_, uint256 voteDeadline_)
            VotingBase(owner_, proposer_, enacter_) {
        weights = weights_;
        voteDeadline = voteDeadline_;
    }

    // Deadline

    function setVoteDeadline(uint256 voteDeadline_) external onlyOwner {
        voteDeadline = voteDeadline_;
    }

    function voteActive(uint256 voteId) public view returns (bool) {
        return block.number < voteStartBlock[voteId] + voteDeadline;
    }

    // Vote

    function vote(uint256 voteId, VoteStatus value) external override {
        _vote(voteId, msg.sender, value);
    }

    function _vote(uint256 voteId, address voter, VoteStatus newVote) internal {
        require(voteActive(voteId));
        require(newVote != VoteStatus.Nil);

        uint256 weight = weights.weightOfAt(voter, voteStartBlock[voteId]) - reducedWeight[voteId][voter];
        require(weight > 0, "No vote power");

        VoteStatus oldDelegatedVote = voteOf[voteId][voter];

        address delegate = weights.delegateOfAt(voter, voteStartBlock[voteId]);
        while (delegate != address(0) && oldDelegatedVote == VoteStatus.Nil) {
            reducedWeight[voteId][delegate] += weight;
            oldDelegatedVote = voteOf[voteId][delegate];
            delegate = weights.delegateOfAt(delegate, voteStartBlock[voteId]);
        }

        if (oldDelegatedVote == VoteStatus.Yes) {
            voteCounts[voteId].countYes -= weight;
        } else if (oldDelegatedVote == VoteStatus.No) {
            voteCounts[voteId].countNo -= weight;
        }

        voteOf[voteId][voter] = newVote;

        if (newVote == VoteStatus.Yes) {
            voteCounts[voteId].countYes += weight;
        } else if (newVote == VoteStatus.No) {
            voteCounts[voteId].countNo += weight;
        }

        emit Vote(voteId, voter, newVote);
    }

    // Propose/enact hooks (NOTE: observe lack of onlyACL() modifiers, since we are counting on calling the VotingBase implementations directly)

    function propose(bytes32 rationale_, bytes32 actionsRoot_) public override(VotingBase, IVotingBase) returns (uint256 voteId) {
        voteId = VotingBase.propose(rationale_, actionsRoot_);

        voteStartBlock[voteId] = block.number;
    }

    function enact(uint256 voteId, VoteAction[] calldata actions) public override(VotingBase, IVotingBase) {

        require(!voteActive(voteId) && voteCounts[voteId].countYes > voteCounts[voteId].countNo);

        VotingBase.enact(voteId, actions);

        // delete voteStartBlock[voteId];
        // delete voteCounts[voteId];
    }
}
