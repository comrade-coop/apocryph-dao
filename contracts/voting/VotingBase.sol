// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./IVotingBase.sol";
import "../util/Owned.sol";

abstract contract VotingBase is Owned, IVotingBase, ERC721Holder {
    address public proposer;
    address public enacter;

    constructor(address owner_, address proposer_, address enacter_)
            Owned(owner_ != address(0) ? owner_ : address(this)) {
        proposer = proposer_;
        enacter = enacter_;
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

    function propose(bytes32 rationale, bytes32 actionsHash) public onlyACL(proposer) virtual override returns (bytes32 voteId) {
        voteId = keccak256(abi.encodePacked(rationale, actionsHash));

        _proposeHook(voteId);

        emit Proposal(voteId, rationale, actionsHash);
    }

    function _proposeHook(bytes32 voteId) internal virtual; // Must make proposed(voteId) return true on future calls

    function enact(bytes32 rationale, VoteAction[] calldata actions_) public onlyACL(enacter) virtual override {
        bytes32 actionsHash = keccak256(abi.encode(actions_));
        bytes32 voteId = keccak256(abi.encodePacked(rationale, actionsHash));

        require(!enacted(voteId));
        _enactHook(voteId);

        for (uint i = 0; i < actions_.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory returnValue) = actions_[i].target.call(actions_[i].data); // {value: actions_[i].value}
            returnValue; // Just mark the value as "used"
            require(success);
        }

        emit Enaction(voteId, rationale, actionsHash);
    }

    function _enactHook(bytes32 voteId) internal virtual; // Must make enacted(voteId) return true on future calls

    function enacted(bytes32 voteId) public virtual override view returns (bool);
}
