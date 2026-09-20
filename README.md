<div align="center">
  <h1>⛏️ ArcMiner Protocol</h1>
  <p><strong>The first 100% decentralized, hyper-deflationary Proof-of-Work NFT collection on Arc Mainnet.</strong></p>
</div>

---

## 🔒 100% On-Chain & Trustless

This repository contains the core smart contracts that power the ArcMiner ecosystem. We have open-sourced our protocol to prove that ArcMiner is entirely decentralized, immutable, and trustless.

- 🚫 **No Premine:** The creator cannot mint NFTs without proving cryptographic work.
- 🛑 **No Pausing:** The contracts are immutable and cannot be paused to prevent mining.
- ⚙️ **On-Chain Validation:** The Keccak-256 validation is done entirely in the smart contract.
- 📉 **Automated Buybacks:** `70%` of all mint fees are programmatically routed to a decentralized buyback-and-burn pool. The founders **cannot** access or touch these funds.

---

## ⚙️ Protocol Mechanisms

### 1. Proof-of-Work Mining
ArcMiners cannot be purchased; they must be mined. Your hardware (CPU/GPU) must compute Keccak-256 hashes to find a `nonce` that satisfies the current difficulty target:
`Keccak256(MinerAddress + Challenge + Nonce) < Target`
Once a valid hash is found, the proof is submitted to the smart contract, verified entirely on-chain, and the ArcMiner is minted.

### 2. Dynamic Epochs (Difficulty)
The network operates in Epochs. As the total supply increases, the difficulty automatically adjusts. Epoch 0 begins with the easiest target, requiring the least amount of hashing power. As more rigs are minted, the network transitions to higher Epochs, drastically increasing the computational work required to find a valid proof.

### 3. Hyper-Deflationary Forge
The maximum issuance is capped at `7,777`. However, the circulating supply actively decreases through The Forge:
- 🔥 Burn **2 Common Rigs** ➔ Forge **1 Rare Rig**
- 🔥 Burn **3 Rare Rigs** ➔ Forge **1 Legendary Rig**

Every Forge action permanently destroys the underlying NFTs, drastically compressing the total supply over time.

---

## 📜 Smart Contracts

| Contract | Description |
|---|---|
| `ArcMiner.sol` | The core NFT logic, Proof-of-Work validation, and the Forge mechanic. |
| `ArcMinerPool.sol` | The decentralized pool handling the ARCM token buyback and burn mechanics. |

---

## 🔗 Official Arc Mainnet Addresses

> **ArcMiner NFT Contract:**
> `0x1a4b7fc5c620c5924019c494f2e591767dddbded`

---

### *Don't Trust. Verify.*
Feel free to read the contract code and verify the logic yourself.
