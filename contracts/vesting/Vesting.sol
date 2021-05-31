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
        uint256 startBlock;
        uint256 periodCount;
        uint256 periodBlocks;
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

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IERC1363Receiver).interfaceId
            || super.supportsInterface(interfaceId);
    }

    function onTransferReceived(address operator, address, uint256 value, bytes memory data) external override returns (bytes4) {
        require(msg.sender == address(_baseToken), "Wrong sender");

        (uint256 startBlock, uint256 periodCount, uint256 periodBlocks, address receiver) = abi.decode(data, (uint256, uint256, uint256, address));

        if (receiver == address(0)) {
            receiver = operator;
        }

        //uint256 mintedTokenId = (uint256) keccak256(abi.encode(value, startBlock, periodCount, periodBlocks));

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
        require(_isApprovedOrOwner(msg.sender, tokenId), "claim caller is not owner nor approved"); // TODO: _msgSender()?

        _claim(tokenId, msg.sender);
    }

    function claim(uint256 tokenId, address receiver) external { // NOTE: Might want to have a claim function which allows claiming on another address's behalf?
        require(_isApprovedOrOwner(msg.sender, tokenId), "claim caller is not owner nor approved"); // TODO: _msgSender()?

        _claim(tokenId, receiver);
    }

    function _claim(uint256 tokenId, address receiver) internal {
        uint256 currentBlock = block.number;

        VestingData storage vesting = _tokenData[_nextToken];

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
            _baseToken.transferAndCall(receiver, toRelease);

            if (vestedValue == totalValue_) {
                delete _tokenData[_nextToken];
                _burn(tokenId);
            }
        }
    }
}
