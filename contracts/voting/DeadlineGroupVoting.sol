// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./DeadlineVoting.sol";
import "./WeightsGroup.sol";

contract DeadlineGroupVoting is DeadlineVoting, WeightsGroup {
    constructor(address proposer_, address enacter_, address owner_, uint256 voteDeadline_, address[] memory initialMembers, uint128[] memory initialWeights)
        WeightsGroup(initialMembers, initialWeights, owner_)
        VotingBase(proposer_, enacter_)
        DeadlineVoting(voteDeadline_) {
    }
}
