// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base64} from "./lib/Base64.sol";
import {IArcMinerData} from "./interfaces/IArcMinerData.sol";

contract ArcMinerRenderer {
    IArcMinerData public immutable miner;
    constructor(address miner_) { miner = IArcMinerData(miner_); }

    string public baseImageURI = "https://yourdomain.com/assets/"; // Change this to your real website or IPFS

    function setBaseImageURI(string memory _uri) external {
        // In a real production contract, you would add access control here (e.g. onlyOwner)
        // For simplicity in this version, we leave it open or the deployer sets it once.
        baseImageURI = _uri;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        (uint8 rarity, uint16 bits, uint16 epoch, bytes32 workHash,) = miner.tokenData(tokenId);
        
        string memory rarityName = rarity == 2 ? "Legendary" : rarity == 1 ? "Rare" : "Common";
        string memory imageName = rarity == 2 ? "legendary.jpeg" : rarity == 1 ? "rare.jpeg" : "common.jpeg";
        
        string memory imageUrl = string.concat(baseImageURI, imageName);

        string memory json = string.concat(
            '{"name":"ARCMINER #', _u(tokenId), '","description":"Proof-of-work mined on Arc.",',
            '"image":"', imageUrl, '",',
            '"attributes":[{"trait_type":"Rarity","value":"', rarityName, '"},{"trait_type":"Work Bits","value":', _u(bits), '},{"trait_type":"Epoch","value":', _u(epoch), '}],',
            '"work_hash":"0x', _hex(workHash), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _u(uint256 x) internal pure returns (string memory) {
        if (x == 0) return "0";
        uint256 y=x; uint256 n;
        while (y != 0) { n++; y/=10; }
        bytes memory b = new bytes(n);
        while (x != 0) { b[--n] = bytes1(uint8(48 + x%10)); x/=10; }
        return string(b);
    }

    function _hex(bytes32 x) internal pure returns (string memory) {
        bytes16 h = "0123456789abcdef";
        bytes memory s = new bytes(64);
        for (uint256 i=0;i<32;i++) { uint8 v=uint8(x[i]); s[i*2]=h[v>>4]; s[i*2+1]=h[v&15]; }
        return string(s);
    }
}
