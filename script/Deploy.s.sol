// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/ARCM.sol";
import "../contracts/ArcMinerTreasury.sol";
import "../contracts/ArcMiner.sol";
import "../contracts/ArcMinerRenderer.sol";
import "../contracts/ArcMinerPool.sol";
import "../contracts/ArcMinerStake.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address genesisReceiver = vm.envAddress("GENESIS_RECEIVER");
        address payable ledgerAddress = payable(0xc7972102beB5A30d7C18D62063b11c4A32a39Fbb);
        
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ARCM
        ARCM arcm = new ARCM(genesisReceiver);
        console.log("ARCM deployed at:", address(arcm));

        // 2. Deploy ArcMiner (Treasury = Ledger Address)
        ArcMiner miner = new ArcMiner(address(arcm), ledgerAddress, bytes32(0));
        console.log("ArcMiner deployed at:", address(miner));

        // 3. Set Burn Minter
        arcm.setBurnMinter(address(miner), true);
        console.log("ArcMiner set as BurnMinter on ARCM");

        // 4. Deploy Renderer
        ArcMinerRenderer renderer = new ArcMinerRenderer(address(miner));
        miner.setRenderer(address(renderer));
        console.log("Renderer deployed and set");

        // 5. Deploy Pool (Fee Recipient = Ledger Address)
        ArcMinerPool pool = new ArcMinerPool(address(arcm), ledgerAddress);
        console.log("Pool deployed at:", address(pool));

        // 6. Deploy Staking Contract
        ArcMinerStake stakeContract = new ArcMinerStake(address(arcm));
        console.log("Staking deployed at:", address(stakeContract));

        vm.stopBroadcast();
    }
}
