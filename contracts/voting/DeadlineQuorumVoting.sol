// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "./IVoting.sol";
import "./VotingBase.sol";
import "../util/Owned.sol";
import "../interfaces/IVotingWeights.sol";

contract DeadlineQuorumVoting is VotingBase, IVoting {
    struct VoteCounts {
        uint256 countYes;
        uint256 countNo;
    }

    mapping(bytes32 => mapping(address => VoteStatus)) public override voteOf;
    mapping(bytes32 => VoteCounts) public voteCounts;
    mapping(bytes32 => mapping(address => uint256)) public reducedWeight;
    mapping(bytes32 => uint256) public voteStartBlock;
    mapping(bytes32 => bool) private _enacted;

    IVotingWeights public weights;
    uint256 public voteDeadline; // in blocks, 0 for no deadline
    uint256 public enactDelay; // in blocks, 0 for immediate
    uint256 public requiredQuorumFraction; // expressed as fraction of 2^256; (0xFF.....FF) representing 100% of the weight and (0x00) representing none of the weight

    constructor(address owner_, address proposer_, address enacter_, IVotingWeights weights_, uint256 voteDeadline_, uint256 enactDelay_, uint256 requiredQuorumFraction_)
            VotingBase(owner_, proposer_, enacter_) {
        weights = weights_;
        voteDeadline = voteDeadline_;
        enactDelay = enactDelay_;
        requiredQuorumFraction = requiredQuorumFraction_;
    }

    modifier onlyACL(address wanted) virtual override {
        require(wanted == address(0) || (wanted == address(1) && weights.weightOf(msg.sender) > 0) || wanted == msg.sender);
        _;
    }

    // Deadline

    function setVoteDeadline(uint256 voteDeadline_) external onlyOwner {
        voteDeadline = voteDeadline_;
    }

    function setEnactDelay(uint256 enactDelay_) external onlyOwner {
        enactDelay = enactDelay_;
    }

    function setRequiredQuorumFraction(uint256 requiredQuorumFraction_) external onlyOwner {
        requiredQuorumFraction = requiredQuorumFraction_;
    }

    function isWithinVoteDeadline(bytes32 voteId) public view returns (bool) {
        return voteDeadline == 0 || block.number < voteStartBlock[voteId] + voteDeadline;
    }

    function isAfterEnactDelay(bytes32 voteId) public view returns (bool) {
        return enactDelay == 0 || block.number >= voteStartBlock[voteId] + enactDelay;
    }

    function mul512(uint256 a, uint256 b) private pure returns (uint256 r0, uint256 r1) { // via https://medium.com/wicketh/mathemagic-full-multiply-27650fec525d
        assembly {
            let mm := mulmod(a, b, not(0))
            r0 := mul(a, b)
            r1 := sub(sub(mm, r0), lt(mm, r0))
        }
    }

    function requiredQuorum(bytes32 voteId) public view returns (uint256 quorum) {
        uint256 totalWeight = weights.totalWeightAt(voteStartBlock[voteId]);
        (, quorum) = mul512(totalWeight, requiredQuorumFraction); // get only r1, the high value bits, as we are computing totalWeight * requiredQuorum / 2^256
    }

    // Vote

    function vote(bytes32 voteId, VoteStatus value) external override {
        _vote(voteId, msg.sender, value);
    }

    function _vote(bytes32 voteId, address voter, VoteStatus newVote) internal {
        require(proposed(voteId));
        require(isWithinVoteDeadline(voteId));
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

    // Propose/enact hooks

    function _proposeHook(bytes32 voteId) internal override {
        voteStartBlock[voteId] = block.number;
    }

    function proposed(bytes32 voteId) public override view returns (bool) {
        return voteStartBlock[voteId] != 0;
    }

    function _enactHook(bytes32 voteId) internal override {
        require(isAfterEnactDelay(voteId));
        require(voteCounts[voteId].countYes >= requiredQuorum(voteId));
        require(voteCounts[voteId].countYes > voteCounts[voteId].countNo);
        _enacted[voteId] = true;
    }

    function enacted(bytes32 voteId) public override(VotingBase, IVotingBase) view returns (bool) {
        return _enacted[voteId];
    }
}
