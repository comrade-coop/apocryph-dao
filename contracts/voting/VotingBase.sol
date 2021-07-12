// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./IVotingBase.sol";

abstract contract VotingBase is IVotingBase, ERC721Holder {
    mapping(uint256 => bytes32) public override rationale;
    mapping(uint256 => bytes32) public override actionsRoot;

    address immutable internal _proposer;
    address immutable internal _enacter;

    uint256 internal _nextVote;

    constructor(address proposer_, address enacter_) {
        _proposer = proposer_;
        _enacter = enacter_;
        _nextVote = 1;
    }

    modifier accessControl(address wanted) {
        require(wanted == address(0) || wanted == msg.sender);
        _;
    }

    function propose(bytes32 rationale_, bytes32 actionsRoot_) external accessControl(_proposer) override returns (uint256 voteId) {
        voteId = _nextVote;
        _nextVote = _nextVote + 1;

        rationale[voteId] = rationale_;
        actionsRoot[voteId] = actionsRoot_;

        proposed(voteId);

        emit Proposal(voteId);
    }

    function enact(uint256 voteId, VoteAction[] calldata actions_) external accessControl(_enacter) override {
        require(canEnact(voteId)); // TODO: Consider a way to cleanup old inactive votes
        require(keccak256(abi.encode(actions_)) == actionsRoot[voteId]);

        for (uint i = 0; i < actions_.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returnValue) = actions_[i].target.call(actions_[i].data); // {value: actions_[i].value}
            returnValue; // Just mark the value as "used"
            require(success);
        }

        enacted(voteId);

        emit Enaction(voteId);

        delete actionsRoot[voteId]; // ! important, as otherwise would allow multiple enactions
        delete rationale[voteId];
    }

    function proposed(uint256 voteId) internal virtual;
    function canEnact(uint256 voteId) internal virtual returns (bool);
    function enacted(uint256 voteId) internal virtual;
}
