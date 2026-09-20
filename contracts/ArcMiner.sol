// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IARCM} from "./interfaces/IARCM.sol";
import {IArcMinerRenderer} from "./interfaces/IArcMinerRenderer.sol";

contract ArcMiner {
    string public constant name = "ARCMINER";
    string public constant symbol = "ARCMINER";

    uint256 public constant MAX_SUPPLY = 7777;
    uint256 public constant INITIAL_PRICE = 1 ether;
    uint256 public constant PRICE_STEP = 48679060665362035; // Steps to reach 200 USDC max
    uint256 public constant RENT_BPS = 7000;
    uint256 public constant BPS = 10_000;
    uint256 public constant RENT_SCALE = 1e27;
    uint256 public constant MIN_BURN_AGE = 10 minutes;
    uint256 public constant FRESH_BURN_REWARD = 1000 ether;
    uint8 public constant INITIAL_DIFFICULTY_BITS = 26;
    uint8 public constant RETARGET_MINTS = 8;
    uint64 public constant TARGET_PACE = 10 seconds;
    uint64 public constant FAILSAFE_DELAY = 5 minutes;
    uint64 public constant FAILSAFE_STEP = 30 seconds;
    uint8 public constant MAX_FAILSAFE_BITS = 16;

    enum Rarity { Common, Rare, Legendary }

    struct TokenInfo {
        bytes32 workHash;
        uint64 mintedAt;
        uint16 workBits;
        uint16 mintEpoch;
        Rarity rarity;
        uint256 rentDebt;
    }

    address public owner;
    address payable public treasury;
    IARCM public immutable arcm;
    IArcMinerRenderer public renderer;

    uint256 public mintedCount;
    uint256 public livingCount;

    // ERC-721 state
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    // Mining state
    bytes32 public prevWork;
    uint256 public baseTarget;
    uint256 public immutable floorTarget;
    uint64 public lastMintTimestamp;
    uint64 public retargetWindowStartedAt;
    uint8 public retargetWindowMints;
    uint32 public anchorWindowBlocks = 50; // ~25s at ~0.5s Arc blocks

    mapping(address => uint64) public lastMinerMintAt;
    mapping(address => uint8) public minerBurst;

    // Rent state
    uint256 public accRentPerLiving;
    mapping(uint256 => TokenInfo) public tokenInfo;

    bool private _entered;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Mined(address indexed miner, uint256 indexed tokenId, bytes32 workHash, uint16 workBits, uint8 rarity, uint16 epoch, uint256 price, uint256 nonce, uint256 anchorBlock);
    event DifficultyRetarget(uint256 oldTarget, uint256 newTarget, uint64 actualSeconds, uint64 expectedSeconds);
    event RentClaimed(address indexed owner, uint256 indexed tokenId, uint256 amount);
    event Burned(address indexed owner, uint256 indexed tokenId, uint256 arcmReward);
    event TreasurySet(address indexed treasury);
    event RendererSet(address indexed renderer);

    error NotOwner();
    error SoldOut();
    error WrongPrice(uint256 expected, uint256 got);
    error InvalidAnchor();
    error InvalidWork();
    error NotTokenOwner();
    error NotApproved();
    error TokenMissing();
    error BurnTooYoung();
    error NativeTransferFailed();
    error Reentrant();
    error ZeroAddress();

    constructor(address arcm_, address payable treasury_, bytes32 genesisWork) {
        if (arcm_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        arcm = IARCM(arcm_);
        treasury = treasury_;
        floorTarget = type(uint256).max >> INITIAL_DIFFICULTY_BITS;
        baseTarget = floorTarget;
        prevWork = genesisWork == bytes32(0) ? keccak256(abi.encodePacked(block.chainid, address(this), block.timestamp)) : genesisWork;
        lastMintTimestamp = uint64(block.timestamp);
        retargetWindowStartedAt = uint64(block.timestamp);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier nonReentrant() { if (_entered) revert Reentrant(); _entered = true; _; _entered = false; }

    receive() external payable {}

    // ---- ERC721 ----
    function ownerOf(uint256 tokenId) public view returns (address o) {
        o = _ownerOf[tokenId];
        if (o == address(0)) revert TokenMissing();
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balanceOf[account];
    }

    function approve(address to, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        if (msg.sender != o && !isApprovedForAll[o][msg.sender]) revert NotApproved();
        getApproved[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ZeroAddress();
        address o = ownerOf(tokenId);
        if (o != from) revert NotTokenOwner();
        if (msg.sender != o && msg.sender != getApproved[tokenId] && !isApprovedForAll[o][msg.sender]) revert NotApproved();
        delete getApproved[tokenId];
        unchecked { _balanceOf[from]--; }
        _balanceOf[to]++;
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external { transferFrom(from, to, tokenId); }
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external { transferFrom(from, to, tokenId); }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7 || iid == 0x80ac58cd || iid == 0x5b5e139f || iid == 0x2a55205a;
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (treasury, salePrice * 500 / BPS);
    }

    // ---- Configuration ----
    function setTreasury(address payable next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        treasury = next;
        emit TreasurySet(next);
    }

    function setRenderer(address next) external onlyOwner {
        renderer = IArcMinerRenderer(next);
        emit RendererSet(next);
    }

    function setAnchorWindowBlocks(uint32 blocks_) external onlyOwner {
        require(blocks_ >= 2 && blocks_ <= 256, "anchor window");
        anchorWindowBlocks = blocks_;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }

    // ---- Epoch / price ----
    function epochStart(uint256 epoch) public pure returns (uint256) {
        if (epoch == 0) return 0;
        return 8 * ((uint256(1) << epoch) - 1);
    }

    function epochSize(uint256 epoch) public pure returns (uint256) {
        return 8 * (uint256(1) << epoch);
    }

    function epochForCount(uint256 count) public pure returns (uint16 epoch) {
        uint256 end = 8;
        while (count >= end) {
            epoch++;
            end += 8 * (uint256(1) << epoch);
        }
    }

    function currentEpoch() public view returns (uint16) { return epochForCount(mintedCount); }

    function currentPrice() public view returns (uint256) {
        uint256 e = currentEpoch();
        if (e == 0) return INITIAL_PRICE;
        return INITIAL_PRICE + (epochStart(e) * PRICE_STEP);
    }

    // ---- PoW ----
    function effectiveBaseTarget() public view returns (uint256 t) {
        t = baseTarget;
        uint256 idle = block.timestamp - lastMintTimestamp;
        if (idle <= FAILSAFE_DELAY) return t;
        uint256 loosenBits = 1 + (idle - FAILSAFE_DELAY) / FAILSAFE_STEP;
        if (loosenBits > MAX_FAILSAFE_BITS) loosenBits = MAX_FAILSAFE_BITS;
        for (uint256 i = 0; i < loosenBits && t < floorTarget; i++) {
            if (t > floorTarget / 2) return floorTarget;
            t <<= 1;
        }
        if (t > floorTarget) t = floorTarget;
    }

    function activeBurst(address miner) public view returns (uint8) {
        uint8 b = minerBurst[miner];
        if (b == 0) return 0;
        uint256 elapsed = block.timestamp - lastMinerMintAt[miner];
        uint256 decay = elapsed / 60 seconds;
        if (decay >= b) return 0;
        return uint8(uint256(b) - decay);
    }

    function targetFor(address miner) public view returns (uint256) {
        uint256 t = effectiveBaseTarget();
        uint8 b = activeBurst(miner);
        if (b >= 255) return 1;
        t >>= b;
        return t == 0 ? 1 : t;
    }

    function workState(address miner) external view returns (bytes32 work, uint256 target, uint256 anchorBlock, bytes32 anchorHash, uint16 epoch, uint256 price) {
        anchorBlock = block.number - 1;
        return (prevWork, targetFor(miner), anchorBlock, blockhash(anchorBlock), currentEpoch(), currentPrice());
    }

    function mine(uint256 nonce, uint256 anchorBlock) external payable nonReentrant returns (uint256 tokenId) {
        if (mintedCount >= MAX_SUPPLY) revert SoldOut();
        uint256 price = currentPrice();
        if (msg.value != price) revert WrongPrice(price, msg.value);
        if (anchorBlock >= block.number || block.number - anchorBlock > anchorWindowBlocks) revert InvalidAnchor();
        bytes32 anchor = blockhash(anchorBlock);
        if (anchor == bytes32(0)) revert InvalidAnchor();

        uint256 requiredTarget = targetFor(msg.sender);
        bytes32 workHash = keccak256(abi.encodePacked(msg.sender, nonce, prevWork, anchor));
        if (uint256(workHash) >= requiredTarget) revert InvalidWork();

        uint16 bits = leadingZeroBits(workHash);
        uint16 requiredBits = targetBits(requiredTarget);
        uint16 extra = bits > requiredBits ? bits - requiredBits : 0;
        Rarity rarity = extra >= 8 ? Rarity.Legendary : extra >= 4 ? Rarity.Rare : Rarity.Common;
        uint16 epoch = currentEpoch();

        // Distribute payment before adding the new living NFT.
        uint256 rentBudget;
        if (livingCount != 0) {
            rentBudget = price * RENT_BPS / BPS;
            accRentPerLiving += rentBudget * RENT_SCALE / livingCount;
        }
        uint256 hookAmount = price - rentBudget;
        if (hookAmount != 0) {
            (bool sent,) = treasury.call{value: hookAmount}("");
            if (!sent) revert NativeTransferFailed();
        }

        tokenId = ++mintedCount;
        livingCount++;
        _ownerOf[tokenId] = msg.sender;
        _balanceOf[msg.sender]++;
        tokenInfo[tokenId] = TokenInfo({
            workHash: workHash,
            mintedAt: uint64(block.timestamp),
            workBits: bits,
            mintEpoch: epoch,
            rarity: rarity,
            rentDebt: accRentPerLiving
        });

        // Burst: each fast repeat win doubles required work; decays one bit/minute.
        uint8 b = activeBurst(msg.sender);
        minerBurst[msg.sender] = b == type(uint8).max ? b : b + 1;
        lastMinerMintAt[msg.sender] = uint64(block.timestamp);

        prevWork = workHash;
        lastMintTimestamp = uint64(block.timestamp);
        _retarget();

        emit Transfer(address(0), msg.sender, tokenId);
        emit Mined(msg.sender, tokenId, workHash, bits, uint8(rarity), epoch, price, nonce, anchorBlock);
    }

    function _retarget() internal {
        unchecked { retargetWindowMints++; }
        if (retargetWindowMints < RETARGET_MINTS) return;
        uint64 nowTs = uint64(block.timestamp);
        uint64 actual = nowTs - retargetWindowStartedAt;
        uint64 expected = RETARGET_MINTS * TARGET_PACE;
        uint256 old = baseTarget;
        uint256 next = old * uint256(actual == 0 ? 1 : actual) / expected;
        uint256 minTarget = old / 4;
        uint256 maxTarget = old > type(uint256).max / 4 ? type(uint256).max : old * 4;
        if (next < minTarget) next = minTarget;
        if (next > maxTarget) next = maxTarget;
        if (next > floorTarget) next = floorTarget;
        if (next == 0) next = 1;
        baseTarget = next;
        retargetWindowStartedAt = nowTs;
        retargetWindowMints = 0;
        emit DifficultyRetarget(old, next, actual, expected);
    }

    // ---- Rent ----
    function pendingRent(uint256 tokenId) public view returns (uint256) {
        if (_ownerOf[tokenId] == address(0)) return 0;
        TokenInfo storage info = tokenInfo[tokenId];
        return (accRentPerLiving - info.rentDebt) / RENT_SCALE;
    }

    function claimRent(uint256 tokenId) external nonReentrant returns (uint256 amount) {
        address o = ownerOf(tokenId);
        if (msg.sender != o) revert NotTokenOwner();
        TokenInfo storage info = tokenInfo[tokenId];
        amount = (accRentPerLiving - info.rentDebt) / RENT_SCALE;
        info.rentDebt = accRentPerLiving;
        if (amount != 0) {
            (bool sent,) = payable(o).call{value: amount}("");
            if (!sent) revert NativeTransferFailed();
        }
        emit RentClaimed(o, tokenId, amount);
    }

    // ---- Burn -> ARCM ----
    function burnReward(uint256 tokenId) public view returns (uint256) {
        if (_ownerOf[tokenId] == address(0)) return 0;
        uint256 tokenEpoch = tokenInfo[tokenId].mintEpoch;
        uint256 nowEpoch = currentEpoch();
        if (tokenEpoch >= nowEpoch) return FRESH_BURN_REWARD;
        uint256 age = nowEpoch - tokenEpoch;
        if (age > 255) return 0;
        uint256 base = FRESH_BURN_REWARD >> (age - 1);
        if (base == 0) return 0;

        // Published Hashcats table shows older rewards halving per full epoch while
        // linearly decaying through the current epoch. Example at 39.06% progress:
        // previous epoch ≈ 805, then 402, 201, 101, ...
        uint256 start = epochStart(nowEpoch);
        uint256 size = epochSize(nowEpoch);
        uint256 progress = mintedCount > start ? mintedCount - start : 0;
        if (progress > size) progress = size;
        return base * (2 * size - progress) / (2 * size);
    }

    function burnForARCM(uint256 tokenId) external nonReentrant returns (uint256 reward) {
        address o = ownerOf(tokenId);
        if (msg.sender != o) revert NotTokenOwner();
        TokenInfo storage info = tokenInfo[tokenId];
        if (block.timestamp < uint256(info.mintedAt) + MIN_BURN_AGE) revert BurnTooYoung();

        uint256 rent = (accRentPerLiving - info.rentDebt) / RENT_SCALE;
        info.rentDebt = accRentPerLiving;
        reward = burnReward(tokenId);

        delete getApproved[tokenId];
        delete _ownerOf[tokenId];
        unchecked { _balanceOf[o]--; livingCount--; }
        emit Transfer(o, address(0), tokenId);

        if (rent != 0) {
            (bool sent,) = payable(o).call{value: rent}("");
            if (!sent) revert NativeTransferFailed();
            emit RentClaimed(o, tokenId, rent);
        }
        arcm.mintFromBurn(o, reward);
        emit Burned(o, tokenId, reward);
    }

    // ---- Metadata ----
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        if (address(renderer) == address(0)) return "";
        return renderer.tokenURI(tokenId);
    }

    function tokenData(uint256 tokenId) external view returns (uint8 rarity, uint16 workBits, uint16 mintEpoch, bytes32 workHash, uint64 mintedAt) {
        ownerOf(tokenId);
        TokenInfo storage t = tokenInfo[tokenId];
        return (uint8(t.rarity), t.workBits, t.mintEpoch, t.workHash, t.mintedAt);
    }

    function leadingZeroBits(bytes32 h) public pure returns (uint16 n) {
        uint256 x = uint256(h);
        if (x == 0) return 256;
        for (uint16 i = 0; i < 256; i++) {
            if ((x & (uint256(1) << (255 - i))) != 0) return i;
        }
        return 256;
    }

    function targetBits(uint256 target) public pure returns (uint16) {
        if (target == 0) return 256;
        uint16 n;
        for (uint16 i = 0; i < 256; i++) {
            if ((target & (uint256(1) << (255 - i))) != 0) return i;
            n++;
        }
        return n;
    }

    /// @notice Upgrades 2 Common ArcMiners into 1 Rare ArcMiner.
    function forgeMiner(uint256 tokenId1, uint256 tokenId2) external {
        if (ownerOf(tokenId1) != msg.sender) revert NotOwner();
        if (ownerOf(tokenId2) != msg.sender) revert NotOwner();
        
        TokenInfo memory info1 = tokenInfo[tokenId1];
        TokenInfo memory info2 = tokenInfo[tokenId2];
        
        if (info1.rarity != Rarity.Common || info2.rarity != Rarity.Common) revert("Must be Common");
        
        // Burn the two common NFTs (claim rent inside the internal burn? no, we should explicitly call burn)
        // Wait, our burn() function allows the owner to burn and claim the reward.
        // But if they forge, they shouldn't get the burn reward, they are just converting it.
        // Let's manually remove them and re-mint.
        
        // To be safe and clean, let's just use _burn from ERC721 but we don't have it standard, we have burnForARCM.
        // I will implement a custom internal burn for forge
        
        // Delete tokens
        delete getApproved[tokenId1];
        delete _ownerOf[tokenId1];
        delete getApproved[tokenId2];
        delete _ownerOf[tokenId2];
        
        unchecked { 
            _balanceOf[msg.sender] -= 2; 
            livingCount -= 2; 
        }
        
        emit Transfer(msg.sender, address(0), tokenId1);
        emit Transfer(msg.sender, address(0), tokenId2);
        
        // Mint 1 Rare NFT
        uint16 mixedBits = info1.workBits > info2.workBits ? info1.workBits : info2.workBits;
        bytes32 mixedHash = keccak256(abi.encodePacked(info1.workHash, info2.workHash, block.timestamp));
        
        uint256 newId = ++mintedCount;
        uint16 epoch = currentEpoch();
        
        tokenInfo[newId] = TokenInfo({
            workHash: mixedHash,
            mintedAt: uint64(block.timestamp),
            workBits: mixedBits,
            mintEpoch: epoch,
            rarity: Rarity.Rare,
            rentDebt: accRentPerLiving
        });
        
        livingCount++;
        _ownerOf[newId] = msg.sender;
        _balanceOf[msg.sender]++;
        
        emit Transfer(address(0), msg.sender, newId);
        emit Mined(msg.sender, newId, mixedHash, mixedBits, uint8(Rarity.Rare), epoch, 0, 0, 0);
    }
}
