// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBuybackPool {
    function buyARCM(uint256 minOut) external payable returns (uint256 amountOut);
}
interface IBurnableARCM {
    function burn(uint256 amount) external;
    function balanceOf(address who) external view returns (uint256);
}

contract ArcMinerTreasury {
    address public owner;
    IBuybackPool public pool;
    IBurnableARCM public arcm;
    uint256 public queuedNative;
    uint256 public perBlockCap = 100 ether; // deployment parameter: normalize reference ETH cap to dollar-native Arc
    uint256 public lastBuybackBlock;
    uint256 public spentThisBlock;

    address public stakingContract;

    event Funded(address indexed from, uint256 amount);
    event Buyback(uint256 nativeSpent, uint256 arcmDistributed);
    event QueueWithdrawal(address indexed to, uint256 amount);

    error NotOwner();
    error PoolUnset();
    error StakingUnset();
    error NothingToSpend();
    error TransferFailed();

    constructor(address arcm_) { owner = msg.sender; arcm = IBurnableARCM(arcm_); }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    receive() external payable { queuedNative += msg.value; emit Funded(msg.sender, msg.value); }

    function setPool(address p) external onlyOwner { pool = IBuybackPool(p); }
    function setStakingContract(address s) external onlyOwner { stakingContract = s; }
    function setPerBlockCap(uint256 cap) external onlyOwner { perBlockCap = cap; }
    function transferOwnership(address next) external onlyOwner { require(next != address(0)); owner = next; }

    function executeBuyback(uint256 minARCMOut) external returns (uint256 spent, uint256 distributed) {
        if (address(pool) == address(0)) revert PoolUnset();
        if (stakingContract == address(0)) revert StakingUnset();

        if (block.number != lastBuybackBlock) { lastBuybackBlock = block.number; spentThisBlock = 0; }
        uint256 room = perBlockCap > spentThisBlock ? perBlockCap - spentThisBlock : 0;
        spent = queuedNative < room ? queuedNative : room;
        if (spent == 0) revert NothingToSpend();
        queuedNative -= spent;
        spentThisBlock += spent;
        
        // Buy ARCM from pool (goes to treasury balance)
        pool.buyARCM{value: spent}(minARCMOut);
        
        distributed = arcm.balanceOf(address(this));
        if (distributed != 0) {
            // Transfer to Staking contract
            (bool success, ) = address(arcm).call(abi.encodeWithSignature("transfer(address,uint256)", stakingContract, distributed));
            require(success, "Transfer to staking failed");
            
            // Notify staking contract
            (bool notified, ) = stakingContract.call(abi.encodeWithSignature("distributeReward(uint256)", distributed));
            require(notified, "Distribute reward failed");
        }
        emit Buyback(spent, distributed);
    }

    function withdrawQueue(address payable to, uint256 amount) external onlyOwner {
        require(amount <= queuedNative, "queue");
        queuedNative -= amount;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit QueueWithdrawal(to, amount);
    }
}
