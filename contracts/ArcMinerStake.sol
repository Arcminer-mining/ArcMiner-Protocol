// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IARCM} from "./interfaces/IARCM.sol";

contract ArcMinerStake {
    IARCM public immutable arcm;
    
    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public balances;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);

    error TransferFailed();
    error CannotStakeZero();

    constructor(address _arcm) {
        arcm = IARCM(_arcm);
    }

    // Called by the Treasury to distribute ARCM to stakers
    function distributeReward(uint256 amount) external {
        if (totalStaked > 0 && amount > 0) {
            // Treasury calls this right BEFORE sending the tokens here
            // But wait, the Treasury actually transfers the tokens to this contract directly via transfer?
            // Yes, so it should just call distributeReward(amount)
            rewardPerTokenStored += (amount * 1e18) / totalStaked;
            emit RewardAdded(amount);
        }
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function rewardPerToken() public view returns (uint256) {
        return rewardPerTokenStored;
    }

    function earned(address account) public view returns (uint256) {
        return ((balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }

    function stake(uint256 amount) external updateReward(msg.sender) {
        if (amount == 0) revert CannotStakeZero();
        totalStaked += amount;
        balances[msg.sender] += amount;
        require(arcm.transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        if (amount == 0) revert CannotStakeZero();
        totalStaked -= amount;
        balances[msg.sender] -= amount;
        require(arcm.transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            require(arcm.transfer(msg.sender, reward), "transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }
}
