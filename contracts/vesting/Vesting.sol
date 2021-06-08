// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IERC1363Receiver.sol";
import "../interfaces/IERC1363.sol";

contract Vesting is ERC721, IERC1363Receiver {
    using SafeMath for uint256;

    struct VestingData {
        // waiting until blockcount == startBlock then periodCount x periodBlocks
        uint128 startBlock;
        uint64 periodCount;
        uint64 periodBlocks;
        uint256 totalValue;
        uint256 released;
    }

    IERC1363 internal _baseToken;

    mapping(uint256 => VestingData) private _tokenData;

    uint256 private _nextToken;

    constructor (IERC1363 baseToken_, string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        _baseToken = baseToken_;
        _nextToken = 0;
    }

    function onTransferReceived(address operator, address, uint256 value, bytes memory data) external override returns (bytes4) {
        require(msg.sender == address(_baseToken), "Wrong sender");

        (address receiver, uint128 startBlock, uint64 periodCount, uint64 periodBlocks) = abi.decode(data, (address, uint128, uint64, uint64));

        if (receiver == address(0)) {
            receiver = operator;
        }

        VestingData storage vesting = _tokenData[_nextToken];
        vesting.startBlock = startBlock;
        vesting.periodCount = periodCount;
        vesting.periodBlocks = periodBlocks;
        vesting.totalValue = value;

        _safeMint(receiver, _nextToken);
        _nextToken = _nextToken + 1;

        return IERC1363Receiver.onTransferReceived.selector;
    }

    function claim(uint256 tokenId) external {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "claim caller is not owner nor approved");

        _claim(tokenId, _msgSender(), false);
    }

    function claim(uint256 tokenId, address receiver) external { // Needed?!
        require(_isApprovedOrOwner(_msgSender(), tokenId), "claim caller is not owner nor approved");

        _claim(tokenId, receiver, false);
    }

    function claimAndCall(uint256 tokenId, address receiver) external {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "claim caller is not owner nor approved");

        _claim(tokenId, receiver, true);
    }

    function _claim(uint256 tokenId, address receiver, bool call) internal {
        // TODO: event
        uint256 currentBlock = block.number;

        VestingData storage vesting = _tokenData[tokenId];

        uint256 vestedValue = 0;
        uint256 totalValue_ = vesting.totalValue;

        uint256 startBlock_ = vesting.startBlock;
        if (currentBlock > startBlock_) {
            uint256 currentPeriod = (currentBlock - startBlock_).div(vesting.periodBlocks);

            uint256 periodCount_ = vesting.periodCount;
            if (currentPeriod > periodCount_) {
                vestedValue = totalValue_;
            } else {
                vestedValue = totalValue_.div(periodCount_).mul(currentPeriod);
            }
        }

        uint256 toRelease = vestedValue - vesting.released;

        if (toRelease > 0) {
            vesting.released = vestedValue;
            if (call) {
                require(_baseToken.transferAndCall(receiver, toRelease));
            } else {
                require(_baseToken.transfer(receiver, toRelease));
            }

            if (vestedValue == totalValue_) {
                delete _tokenData[_nextToken];
                _burn(tokenId);
            }
        }
    }
}
