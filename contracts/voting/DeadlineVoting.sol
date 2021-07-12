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

    function _vote(uint256 voteId, address voter, VoteStatus value) internal {
        require(voteActive(voteId));

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
