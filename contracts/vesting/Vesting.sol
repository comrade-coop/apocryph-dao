// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/IERC1363Receiver.sol";
import "../interfaces/IERC1363.sol";

contract Vesting is ERC721, IERC1363Receiver {
    using SafeERC20 for IERC20;

    event VestingClaimed(address recepient, uint256 amount);

    struct VestingData {
        uint256 totalValue;
        uint256 released;

        // waiting until blockcount == startBlock then periodCount x periodBlocks
        uint128 startBlock;
        uint64 periodCount;
        uint64 periodBlocks;
    }

    IERC20 internal _baseToken;

    mapping(uint256 => VestingData) private _tokenData;
    uint256 private _nextTokenId;

    constructor (IERC20 baseToken_, string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        _baseToken = baseToken_;
    }

    // Mint

    function onTransferReceived(address operator, address, uint256 value, bytes memory data) external override returns (bytes4) {
        require(msg.sender == address(_baseToken), "Wrong sender");

        (address receiver, uint128 startBlock, uint64 periodCount, uint64 periodBlocks) = abi.decode(data, (address, uint128, uint64, uint64));

        if (receiver == address(0)) {
            receiver = operator;
        }

        _mintVesting(receiver != address(0) ? receiver : operator, value, startBlock, periodCount, periodBlocks);

        return IERC1363Receiver.onTransferReceived.selector;
    }

    function mint(address receiver, uint256 value, uint128 startBlock, uint64 periodCount, uint64 periodBlocks) external {

        _baseToken.safeTransferFrom(msg.sender, address(this), value);

        _mintVesting(receiver != address(0) ? receiver : msg.sender, value, startBlock, periodCount, periodBlocks);
    }

    function _mintVesting(address receiver, uint256 value, uint128 startBlock, uint64 periodCount, uint64 periodBlocks) internal {
        uint256 tokenId = _nextTokenId;
        _nextTokenId = _nextTokenId + 1;

        VestingData storage vestingData = _tokenData[tokenId];
        vestingData.totalValue = value;
        vestingData.startBlock = startBlock;
        vestingData.periodCount = periodCount;
        vestingData.periodBlocks = periodBlocks;

        _safeMint(receiver, tokenId);
    }

    // Claim

    function claim(uint256 tokenId, address receiver) external {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "claim caller is not owner nor approved");

        _claim(tokenId, receiver != address(0) ? receiver : msg.sender, false);
    }

    function claimAndCall(uint256 tokenId, address receiver) external {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "claim caller is not owner nor approved");

        _claim(tokenId, receiver != address(0) ? receiver : msg.sender, true);
    }

    function _claim(uint256 tokenId, address receiver, bool call) internal {
        VestingData storage vestingData = _tokenData[tokenId];

        uint256 vestingValue = calculateVestingValue(block.number, vestingData.totalValue, vestingData.startBlock, vestingData.periodCount, vestingData.periodBlocks);
        uint256 toRelease = vestingValue - vestingData.released;

        if (toRelease > 0) {
            emit VestingClaimed(receiver, toRelease);

            vestingData.released = vestingValue;

            if (vestingValue == vestingData.totalValue) {
                delete _tokenData[tokenId];
                _burn(tokenId);
            }

            if (call) {
                require(IERC1363(address(_baseToken)).transferAndCall(receiver, toRelease));
            } else {
                require(_baseToken.transfer(receiver, toRelease));
            }
        }
    }

    // Vesting calculation

    function vestingParameters(uint256 tokenId) external view returns (uint256 totalValue, uint128 startBlock, uint64 periodCount, uint64 periodBlocks) {
        VestingData storage vestingData = _tokenData[tokenId];
        totalValue = vestingData.totalValue;
        startBlock = vestingData.startBlock;
        periodCount = vestingData.periodCount;
        periodBlocks = vestingData.periodBlocks;
    }

    function calculateVestingValue(uint256 currentBlock, uint256 totalValue, uint128 startBlock, uint64 periodCount, uint64 periodBlocks) public pure returns (uint256) {
        if (currentBlock <= startBlock) {
            return 0;
        }

        uint256 currentPeriod = (currentBlock - startBlock) / periodBlocks;

        if (currentPeriod >= periodCount) {
            return totalValue;
        } else {
            return totalValue * currentPeriod / periodCount;
        }
    }
}
