// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ARCM {
    string public constant name = "ARCM";
    string public constant symbol = "ARCM";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    address public owner;
    address public burnMinter;
    bool public burnMinterLocked;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BurnMinterSet(address indexed minter, bool locked);

    error NotOwner();
    error NotBurnMinter();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();
    error MinterLocked();

    constructor(address genesisReceiver) {
        if (genesisReceiver == address(0)) revert ZeroAddress();
        owner = msg.sender;
        _mint(genesisReceiver, 1_000_000 ether);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    function setBurnMinter(address minter, bool lockForever) external onlyOwner {
        if (burnMinterLocked) revert MinterLocked();
        if (minter == address(0)) revert ZeroAddress();
        burnMinter = minter;
        if (lockForever) burnMinterLocked = true;
        emit BurnMinterSet(minter, burnMinterLocked);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < amount) revert InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = a - amount; }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function mintFromBurn(address to, uint256 amount) external {
        if (msg.sender != burnMinter) revert NotBurnMinter();
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        uint256 b = balanceOf[msg.sender];
        if (b < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] = b - amount; totalSupply -= amount; }
        emit Transfer(msg.sender, address(0), amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 b = balanceOf[from];
        if (b < amount) revert InsufficientBalance();
        unchecked { balanceOf[from] = b - amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
