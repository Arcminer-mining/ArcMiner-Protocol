// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArcMinerData {
    function tokenData(uint256 tokenId) external view returns (
        uint8 rarity,
        uint16 workBits,
        uint16 mintEpoch,
        bytes32 workHash,
        uint64 mintedAt
    );
}
