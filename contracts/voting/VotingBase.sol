// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./IVotingBase.sol";
import "./Owned.sol";

abstract contract VotingBase is Owned, IVotingBase, ERC721Holder {
    mapping(uint256 => bytes32) public override rationale;
    mapping(uint256 => bytes32) public override actionsRoot;

    address public proposer;
    address public enacter;

    uint256 internal _nextVoteId;

    constructor(address owner_, address proposer_, address enacter_)
            Owned(owner_ != address(0) ? owner_ : address(this)){
        proposer = proposer_;
        enacter = enacter_;
        _nextVoteId = 1;
    }

    modifier onlyACL(address wanted) virtual {
        require(wanted == address(0) || wanted == msg.sender);
        _;
    }

    function setProposer(address proposer_) external onlyOwner {
        proposer = proposer_;
    }

    function setEnacter(address enacter_) external onlyOwner {
        enacter = enacter_;
    }

    function propose(bytes32 rationale_, bytes32 actionsRoot_) public onlyACL(proposer) virtual override returns (uint256 voteId) {
        voteId = _nextVoteId;
        _nextVoteId = _nextVoteId + 1;

        rationale[voteId] = rationale_;
        actionsRoot[voteId] = actionsRoot_;

        emit Proposal(voteId);
    }

    function enact(uint256 voteId, VoteAction[] calldata actions_) public onlyACL(enacter) virtual override {
        require(keccak256(abi.encode(actions_)) == actionsRoot[voteId]);

        delete actionsRoot[voteId]; // ! important, as otherwise would allow multiple enactions
        // delete rationale[voteId];

        for (uint i = 0; i < actions_.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returnValue) = actions_[i].target.call(actions_[i].data); // {value: actions_[i].value}
            returnValue; // Just mark the value as "used"
            require(success);
        }

        emit Enaction(voteId);
    }
}
