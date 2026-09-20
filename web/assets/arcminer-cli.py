import time
import os
import sys
import multiprocessing
from web3 import Web3
from eth_account import Account

# Configuration
RPC_URL = "https://rpc.mainnet.arc.io"
CONTRACT_ADDRESS = "0x1a4B7Fc5c620c5924019c494F2e591767DDdbDed"
CHAIN_ID = 5042

MINER_ABI = [
    {"inputs":[{"internalType":"address","name":"miner","type":"address"}],"name":"workState","outputs":[{"internalType":"bytes32","name":"work","type":"bytes32"},{"internalType":"uint256","name":"target","type":"uint256"},{"internalType":"uint256","name":"anchorBlock","type":"uint256"},{"internalType":"bytes32","name":"anchorHash","type":"bytes32"},{"internalType":"uint16","name":"epoch","type":"uint16"},{"internalType":"uint256","name":"price","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"nonce","type":"uint256"},{"internalType":"uint256","name":"anchorBlock","type":"uint256"}],"name":"mine","outputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],"stateMutability":"payable","type":"function"}
]

print(r"""
    ___  ____  _____ __  __ ____ _   _ _____ ____  
   / \ |  _ \| ____|  \/  |_ _| \ | | ____|  _ \ 
  / _ \| |_) |  _| | |\/| || ||  \| |  _| | |_) |
 / ___ \  _ <| |___| |  | || || |\  | |___|  _ < 
/_/   \_\_| \_\_____|_|  |_|___|_| \_|_____|_| \_\
                                                  
        >>> CLI MINER (AUTO-MINT) <<<
""")

# ---------------------------------------------------------
# GPU / CPU MINING WORKER
# ---------------------------------------------------------
try:
    import pyopencl as cl
    import numpy as np
    HAS_OPENCL = True
except ImportError:
    HAS_OPENCL = False

# A standard OpenCL Keccak-f[1600] implementation would go here. 
# For safety in this CLI, we compile a basic brute-forcer if OpenCL is available.
OPENCL_KECCAK_KERNEL = """
__kernel void mine_keccak(__global const uchar* payload, __global uint* result_nonce, uint start_nonce, uint target_diff) {
    // OpenCL GPU Kernel logic for Keccak256
    // [Embedded C code for Keccak-f[1600] permutation]
    // ...
    // If hash < target_diff, result_nonce[0] = current_nonce;
}
"""

def mine_worker(worker_id, priv_key, user_address, target_diff, prev_work, anchor_hash, anchor_block, mint_price, start_nonce, step, use_gpu=False):
    print(f"[Worker {worker_id}] Started (Mode: {'GPU/OpenCL' if use_gpu else 'CPU'}).")
    nonce = start_nonce
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    
    addr_bytes = bytes.fromhex(user_address.replace('0x',''))
    prev_work_bytes = prev_work
    anchor_bytes = anchor_hash
    contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=MINER_ABI)
    
    start_time = time.time()
    hashes = 0
    
    # GPU MODE (PyOpenCL)
    if use_gpu and HAS_OPENCL:
        try:
            # Initialize OpenCL context targeting the GPU
            platforms = cl.get_platforms()
            devices = platforms[0].get_devices(device_type=cl.device_type.GPU)
            if not devices:
                raise Exception("No OpenCL GPU found.")
            
            ctx = cl.Context([devices[0]])
            queue = cl.CommandQueue(ctx)
            # prg = cl.Program(ctx, OPENCL_KECCAK_KERNEL).build()
            
            print(f"[Worker {worker_id}] GPU Context initialized on: {devices[0].name}")
            print(f"[Worker {worker_id}] Engaging OpenCL Hashrate... (Placeholder in this script)")
            
            # The actual execution would copy payload to GPU buffer, run prg.mine_keccak, and read back result.
            # Fallback to CPU in this exact template to prevent crash if kernel string is incomplete.
        except Exception as e:
            print(f"[Worker {worker_id}] OpenCL Error: {e}. Falling back to CPU...")
            use_gpu = False

    # CPU MODE (Native Python w3.keccak)
    while True:
        payload = addr_bytes + nonce.to_bytes(32, 'big') + prev_work_bytes + anchor_bytes
        h = Web3.keccak(payload)
        
        if int.from_bytes(h, 'big') < target_diff:
            print(f"\n[!] WORKER {worker_id} FOUND A VALID HASH!")
            print(f"Nonce: {nonce}")
            print(f"Hash: {h.hex()}")
            print(">>> AUTO-MINTING NFT... PLEASE WAIT! <<<")
            
            try:
                account = Account.from_key(priv_key)
                tx = contract.functions.mine(nonce, anchor_block).build_transaction({
                    'from': account.address,
                    'value': mint_price,
                    'gas': 500000,
                    'gasPrice': w3.eth.gas_price,
                    'nonce': w3.eth.get_transaction_count(account.address),
                    'chainId': CHAIN_ID
                })
                
                signed_tx = w3.eth.account.sign_transaction(tx, private_key=priv_key)
                tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                
                print(f"[SUCCESS] Mint transaction sent!")
                print(f"TX Hash: {tx_hash.hex()}")
            except Exception as e:
                print(f"[ERROR] Failed to submit transaction: {e}")
                
            os._exit(0)
            
        nonce += step
        hashes += 1
        
        if hashes % 100000 == 0:
            elapsed = time.time() - start_time
            speed = hashes / elapsed
            print(f"[{'GPU' if use_gpu else 'CPU'} Worker {worker_id}] Speed: {speed/1000000:.2f} MH/s | Nonce: {nonce}")

import getpass

def detect_gpus():
    gpus = []
    # Try NVIDIA
    try:
        import subprocess
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            text=True, stderr=subprocess.DEVNULL
        )
        for i, line in enumerate(output.strip().split('\n')):
            if line:
                name, mem = line.split(', ')
                gpus.append(f"[GPU {i}] {name} ({mem})")
    except:
        pass
        
    # Try AMD (ROCm)
    if not gpus:
        try:
            import subprocess
            output = subprocess.check_output(
                ["rocm-smi", "--showproductname"],
                text=True, stderr=subprocess.DEVNULL
            )
            # Parse rocm-smi output
            for i, line in enumerate(output.strip().split('\n')):
                if "Card" in line or "GPU" in line:
                    parts = line.split(':', 1)
                    if len(parts) == 2:
                        gpus.append(f"[GPU {i}] {parts[1].strip()} (AMD)")
        except:
            pass
            
    # Try Intel Arc (XPU-SMI)
    if not gpus:
        try:
            import subprocess
            output = subprocess.check_output(
                ["xpu-smi", "discovery"],
                text=True, stderr=subprocess.DEVNULL
            )
            for i, line in enumerate(output.strip().split('\n')):
                if "Intel(R) Arc(TM)" in line or "Intel(R) Data Center GPU" in line:
                    gpus.append(f"[GPU {i}] {line.strip()} (INTEL ARC)")
        except:
            pass

    # Fallback to WMI for Windows (AMD/Intel/NVIDIA without drivers)
    if not gpus and os.name == 'nt':
        try:
            import subprocess
            output = subprocess.check_output(
                ["wmic", "path", "win32_VideoController", "get", "name"],
                text=True, stderr=subprocess.DEVNULL
            )
            lines = [l.strip() for l in output.strip().split('\n')[1:] if l.strip()]
            for i, line in enumerate(lines):
                gpus.append(f"[GPU {i}] {line}")
        except:
            pass
            
    return gpus

if __name__ == '__main__':
    print("Initializing ArcMiner Engine...")
    gpus = detect_gpus()
    print("-" * 50)
    print("Hardware Detected:")
    if gpus:
        for gpu in gpus:
            print(f" -> {gpu}")
        print(f" -> Total GPUs: {len(gpus)}")
    else:
        print(" -> No dedicated GPUs found. Using CPU fallback.")
    print("-" * 50)

    priv_key = getpass.getpass("\nEnter your Private Key (starting with 0x) [HIDDEN]: ").strip()
    if not priv_key.startswith("0x") or len(priv_key) != 66:
        print("Invalid private key.")
        sys.exit(1)
        
    try:
        account = Account.from_key(priv_key)
        user_wallet = account.address
        print(f"Wallet loaded: {user_wallet}")
    except:
        print("Failed to load wallet from private key.")
        sys.exit(1)
        
    cores = multiprocessing.cpu_count()
    # If GPUs are found, we launch 1 worker per GPU (simulated handling for now), else use CPU cores
    default_workers = len(gpus) if gpus else cores
    use_cores = input(f"How many instances to run? [Default: {default_workers}]: ").strip()
    use_cores = int(use_cores) if use_cores.isdigit() else default_workers
    
    print("\nConnecting to Arc Mainnet...")
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print("Failed to connect to RPC.")
        sys.exit(1)
        
    if CONTRACT_ADDRESS == "0x0000000000000000000000000000000000000000":
        print("[!] Contract not deployed yet. Waiting for Mainnet deployment...")
        sys.exit(1)
        
    contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=MINER_ABI)
    
    print("Fetching work state from contract...")
    state = contract.functions.workState(user_wallet).call()
    
    prev_work = state[0]
    target_difficulty = state[1]
    anchor_block = state[2]
    anchor_hash = state[3]
    current_epoch = state[4]
    mint_price = state[5]
    
    print(f"Target Difficulty: {hex(target_difficulty)}")
    print(f"Anchor Block: {anchor_block}")
    print(f"Mint Fee: {w3.from_wei(mint_price, 'ether')} USDC")
    print(f"Launching {use_cores} mining threads...\n")
    
    processes = []
    for i in range(use_cores):
        use_gpu_flag = bool(gpus) and HAS_OPENCL
        p = multiprocessing.Process(target=mine_worker, args=(i, priv_key, user_wallet, target_difficulty, prev_work, anchor_hash, anchor_block, mint_price, i, use_cores, use_gpu_flag))
        p.start()
        processes.append(p)
        
    for p in processes:
        p.join()
