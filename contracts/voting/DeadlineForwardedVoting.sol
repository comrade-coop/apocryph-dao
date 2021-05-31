// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./DeadlineVoting.sol";
import "./WeightsForwarded.sol";

contract DeadlineForwardedVoting is DeadlineVoting, WeightsForwarded {
    constructor(address proposer_, address enacter_, address owner_, uint256 voteDeadline_, IVotingWeights weights_)
        Owned(owner_)
        WeightsForwarded(weights_)
        VotingBase(proposer_, enacter_)
        DeadlineVoting(voteDeadline_) {
    }
}
