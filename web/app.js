const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// --- CONFIGURATION ---
// Replace these with your actual deployed contract addresses on Arc Mainnet
const ARCMINER_ADDRESS = "0x1a4B7Fc5c620c5924019c494F2e591767DDdbDed";
const ARCM_ADDRESS = "0x792a1CEEeaa8D959829c54B9cA02925Ee46909b7";
const POOL_ADDRESS = "0x5E0F30dE45Ce3F5BF6dDA99B16797C42D678A425";

const CHAIN_ID = '0x13b2'; // 5042 (Arc Mainnet)

const ARCMINER_ABI = [
    "function workState(address miner) view returns (bytes32 work, uint256 target, uint256 anchorBlock, bytes32 anchorHash, uint16 epoch, uint256 price)",
    "function mine(uint256 nonce, uint256 anchorBlock) payable returns (uint256 tokenId)",
    "function balanceOf(address account) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenData(uint256 tokenId) view returns (uint8 rarity, uint16 workBits, uint16 mintEpoch, bytes32 workHash, uint64 mintedAt)",
    "function pendingRent(uint256 tokenId) view returns (uint256)",
    "function burnReward(uint256 tokenId) view returns (uint256)",
    "function claimRent(uint256 tokenId) returns (uint256)",
    "function burnForARCM(uint256 tokenId) returns (uint256)",
    "function forgeMiner(uint256 tokenId1, uint256 tokenId2)",
    "function mintedCount() view returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const ARCM_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const POOL_ABI = [
    "function sellARCM(uint256 amountIn, uint256 minNativeOut) returns (uint256 amountOut)"
];

// --- APP STATE ---
let provider = null;
let signer = null;
let account = null;
let arcMinerContract = null;
let arcmContract = null;
let poolContract = null;

let currentWorkState = null; // { work, target, anchorBlock, anchorHash, epoch, price }

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 5000);
}

// --- NAVIGATION ---
const navBtns = $$('.nav-btn');
const pages = $$('.page');

navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-target')).classList.add('active');
        
        if (btn.getAttribute('data-target') === 'page-collection') loadCollection();
        if (btn.getAttribute('data-target') === 'page-pool') loadPool();
    });
});

// CPU/GPU Toggle
const btnCpu = $('#btn-cpu');
const btnGpu = $('#btn-gpu');
const cpuControls = $('#cpu-controls');
const gpuControls = $('#gpu-controls');

let isGpuMode = false;

if (btnCpu && btnGpu) {
    btnCpu.addEventListener('click', () => {
        isGpuMode = false;
        btnCpu.style.background = '#2563eb';
        btnCpu.style.color = 'white';
        btnGpu.style.background = 'transparent';
        btnGpu.style.color = '#64748b';
        if (cpuControls) cpuControls.style.display = 'block';
        if (gpuControls) gpuControls.style.display = 'none';
        $('#cpu').disabled = false;
        $('#cpu').textContent = isMining ? 'STOP MINING' : 'START MINING';
    });

    btnGpu.addEventListener('click', () => {
        isGpuMode = true;
        btnGpu.style.background = '#2563eb';
        btnGpu.style.color = 'white';
        btnCpu.style.background = 'transparent';
        btnCpu.style.color = '#64748b';
        if (cpuControls) cpuControls.style.display = 'none';
        if (gpuControls) gpuControls.style.display = 'block';
        $('#cpu').disabled = false;
        $('#cpu').textContent = isMining ? 'STOP MINING' : 'START MINING';
        
        // Detect GPU via WebGL
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                    // Shorten the string if it's too long (e.g. remove ANGLE, Direct3D etc.)
                    let shortName = renderer.replace(/ANGLE \([^,]+, /, '').replace(/ Direct3D.*$/, '').replace(/\(0x[a-fA-F0-9]+\)/, '').trim();
                    if(shortName.endsWith(')')) shortName = shortName.slice(0, -1);
                    $('#gpu-name').textContent = shortName;
                } else {
                    $('#gpu-name').textContent = "Generic GPU (WebGL)";
                }
            } else {
                $('#gpu-name').textContent = "GPU Not Available";
            }
        } catch(e) {
            $('#gpu-name').textContent = "Unknown GPU";
        }
    });
}

// --- UTILS ---
const logConsole = $('#log');
function out(s) {
    if (logConsole) {
        logConsole.textContent += s + '\n';
        logConsole.scrollTop = logConsole.scrollHeight;
    } else {
        console.log(s);
    }
}
function formatEth(wei) { return ethers.formatEther(wei); }
function parseEth(eth) { return ethers.parseEther(eth); }

// --- WALLET CONNECTION ---
$('#connect').onclick = async () => {
    if (!window.ethereum) {
        showToast('Install an EVM wallet such as MetaMask/Rabby.', 'error');
        return;
    }
    
    if (account) {
        const menu = $('#profile-menu');
        menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
        return;
    }
    try {
        provider = new ethers.BrowserProvider(window.ethereum);
        const network = await provider.getNetwork();
        if (network.chainId !== 5042n) {
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x13B2' }], // 5042 in hex
                });
            } catch (switchError) {
                // This error code indicates that the chain has not been added to MetaMask.
                if (switchError.code === 4902) {
                    try {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [
                                {
                                    chainId: '0x13B2',
                                    chainName: 'Arc Mainnet',
                                    rpcUrls: ['https://rpc.arcmainnet.com'], // Example RPC, replace if different
                                    nativeCurrency: {
                                        name: 'USDC',
                                        symbol: 'USDC', // Arc uses USDC for gas
                                        decimals: 18
                                    },
                                    blockExplorerUrls: ['https://explorer.arcmainnet.com'] // Example
                                }
                            ],
                        });
                    } catch (addError) {
                        showToast('Failed to add Arc Mainnet to wallet.', 'error');
                        return;
                    }
                } else {
                    showToast('Failed to switch to Arc Mainnet.', 'error');
                    return;
                }
            }
            // Re-initialize provider after network switch
            provider = new ethers.BrowserProvider(window.ethereum);
        }

        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        account = await signer.getAddress();

        arcMinerContract = new ethers.Contract(ARCMINER_ADDRESS, ARCMINER_ABI, signer);
        arcmContract = new ethers.Contract(ARCM_ADDRESS, ARCM_ABI, signer);
        poolContract = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

        const shortAddr = account.slice(0,6) + '...' + account.slice(-4);
        $('#connect').textContent = shortAddr;
        $('#cpu').disabled = false;
        
        const stateEl = $('#miner-state');
        if (stateEl) stateEl.textContent = `Wallet Connected`;
        
        // Fetch current mining state
        await fetchWorkState();
        showToast('Wallet connected successfully!');

    } catch (e) {
        console.error(e);
        showToast(e.message, 'error');
    }
};

async function fetchWorkState() {
    try {
        if (ARCMINER_ADDRESS === "0x0000000000000000000000000000000000000000") {
            out(`[WARNING] ARCMINER_ADDRESS is not set. Using mock data for UI testing.`);
            currentWorkState = {
                work: "0x" + "22".repeat(32),
                target: BigInt("0x0000003fffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
                anchorBlock: 123456n,
                anchorHash: "0x" + "33".repeat(32),
                epoch: 0n,
                price: ethers.parseEther("3")
            };
            
            $('#net-diff').textContent = `26 bits`;
            $('#net-epoch').textContent = "0";
            $('#net-anchor').textContent = "0x7777...";
            $('#next-cost').textContent = `1.0 USDC`;
            $('#net-mined').textContent = `0 / 7777`;
            $('#net-left').textContent = `8`;
            
            // Apply lock in mock mode
            $$('.lock-progress').forEach(el => el.textContent = "0");
            if ($('#pool-lock')) $('#pool-lock').style.display = 'flex';
            if ($('#stake-lock')) $('#stake-lock').style.display = 'flex';
            
            return true;
        }
        
        const state = await arcMinerContract.workState(account);
        currentWorkState = {
            work: state[0],
            target: state[1],
            anchorBlock: state[2],
            anchorHash: state[3],
            epoch: state[4],
            price: state[5]
        };
        
        let targetHex = currentWorkState.target.toString(16);
        let bits = 256 - (targetHex.length * 4);
        
        // Populate Network Dashboard
        $('#net-diff').textContent = `${bits} bits`;
        $('#net-epoch').textContent = state[4].toString();
        $('#net-anchor').textContent = state[3].slice(0, 10) + '...';
        $('#next-cost').textContent = `${formatEth(state[5])} USDC`;
        
        try {
            const mined = await arcMinerContract.mintedCount();
            $('#net-mined').textContent = `${mined} / 7777`;
            
            // Pool Locking Logic
            const minedCount = Number(mined);
            $$('.lock-progress').forEach(el => el.textContent = minedCount);
            if (minedCount < 1000) {
                if ($('#pool-lock')) $('#pool-lock').style.display = 'flex';
                if ($('#stake-lock')) $('#stake-lock').style.display = 'flex';
            } else {
                if ($('#pool-lock')) $('#pool-lock').style.display = 'none';
                if ($('#stake-lock')) $('#stake-lock').style.display = 'none';
            }
            
            const e = Number(state[4]);
            const start = e === 0 ? 0 : 8 * (Math.pow(2, e) - 1);
            const size = 8 * Math.pow(2, e);
            const nextRise = start + size;
            const left = nextRise - Number(mined);
            $('#net-left').textContent = left.toString();
        } catch(err) {}
        
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

// --- MINING / DASHBOARD STATE ---
let workers = [];
let isMining = false;
let globalHashes = 0;
let globalSpeed = 0;
let hashesByBits = new Array(33).fill(0); // 0 to 32 bits
let speedInterval = null;

function renderChart() {
    const chart = $('#hash-chart');
    if (!chart) return;
    chart.innerHTML = '';
    
    // Mathematically simulate the exponential decay of hashes based on globalHashes
    // N hashes -> N/2 have 0 bits, N/4 have 1 bit, N/8 have 2 bits...
    let simHashes = [];
    let currentMax = 0;
    
    for (let i = 0; i <= 32; i++) {
        // Expected number of hashes with exactly i leading zero bits
        let expected = globalHashes / Math.pow(2, i + 1);
        
        // Add some random jitter (+- 5%) if expected is > 0, to make it look alive
        if (expected > 10 && isMining) {
            expected = expected * (0.95 + Math.random() * 0.1);
        }
        
        simHashes[i] = expected;
        if (expected > currentMax) currentMax = expected;
    }
    
    currentMax = Math.max(currentMax, 1);
    
    for (let i = 0; i <= 32; i++) {
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        const height = (simHashes[i] / currentMax) * 100;
        bar.style.height = `${Math.min(height, 100)}%`;
        if (i > 0 && i % 4 === 0) bar.style.background = '#8b5cf6'; // Highlight every 4 bits
        bar.title = `${i} bits: ${Math.floor(simHashes[i])}`;
        chart.appendChild(bar);
    }
}

// Update the chart every second
setInterval(() => {
    if (isMining) renderChart();
}, 1000);

// Update core count text
$('#core-slider').oninput = (e) => {
    $('#core-count').textContent = e.target.value;
};

$('#cpu').onclick = async () => {
    if (!account) { showToast('Connect wallet first.'); return; }
    
    if (isMining) {
        workers.forEach(w => w.terminate());
        workers = [];
        isMining = false;
        clearInterval(speedInterval);
        $('#cpu').textContent = "START MINING";
        $('#cpu').classList.remove('danger');
        $('#miner-state').textContent = 'Idle';
        $('#speed-val').textContent = "0 H/s";
        return;
    }
    
    const ok = await fetchWorkState();
    if (!ok) return;

    isMining = true;
    $('#cpu').textContent = "STOP MINING";
    $('#cpu').classList.add('danger');
    $('#miner-state').textContent = 'Hashing...';
    $('#miner-state').style.color = '#a3e635';
    
    const cores = isGpuMode ? 16 : (parseInt($('#core-slider').value) || 1);
    let hashesLastTick = globalHashes;
    
    speedInterval = setInterval(() => {
        const diff = globalHashes - hashesLastTick;
        hashesLastTick = globalHashes;
        $('#speed-val').textContent = `${diff} H/s`;
        $('#hashes-seen').textContent = globalHashes.toLocaleString();
        
        if (diff > 0 && currentWorkState && currentWorkState.target) {
            const maxHash = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
            const expectedHashes = maxHash / BigInt(currentWorkState.target);
            const expSec = Number(expectedHashes) / diff;
            
            if (expSec < 60) $('#exp-wait').textContent = `${Math.round(expSec)}s`;
            else if (expSec < 3600) $('#exp-wait').textContent = `${Math.floor(expSec/60)}m ${Math.round(expSec%60)}s`;
            else if (expSec < 86400) $('#exp-wait').textContent = `${Math.floor(expSec/3600)}h ${Math.floor((expSec%3600)/60)}m`;
            else $('#exp-wait').textContent = `> 1 day`;
        } else {
            $('#exp-wait').innerHTML = "&mdash;";
        }
    }, 1000);

    for (let i = 0; i < cores; i++) {
        spawnWorker();
    }
};

function spawnWorker() {
    const w = new Worker('worker.js', { type: 'module' });
    workers.push(w);
    
    let targetHex = currentWorkState.target.toString(16);
    targetHex = "0x" + targetHex.padStart(64, '0');
    
    const startBatch = () => {
        w.postMessage({
            wallet: account, 
            prevWork: currentWorkState.work, 
            anchor: currentWorkState.anchorHash,
            targetHex: targetHex, 
            startNonce: Math.floor(Math.random() * 1000000000).toString(), 
            maxTries: 20000
        });
    };
    
    w.onmessage = async (e) => {
        const d = e.data;
        globalHashes += d.tries || 0;
        
        // We can simulate building the distribution chart if we want,
        // but real offline miners don't report every hash's bits. 
        // We will randomly populate lower bits based on speed for the visual effect.
        if (isMining) {
            const added = d.tries || 0;
            // Fake distribution for visual matching Hashcats
            for (let i = 0; i < Math.min(added, 500); i++) {
                // simple geometric distribution
                let zeros = 0;
                while (Math.random() < 0.5 && zeros < 32) zeros++;
                hashesByBits[zeros]++;
            }
            if (Math.random() < 0.1) renderChart(); // only render sometimes to save CPU
        }

        if (d.success) {
            // Stop all workers
            workers.forEach(worker => worker.terminate());
            workers = [];
            isMining = false;
            clearInterval(speedInterval);
            
            $('#cpu').textContent = "START MINING";
            $('#cpu').classList.remove('danger');
            $('#miner-state').textContent = 'Proof Found!';
            $('#miner-state').style.color = '#fbbf24';
            
            showToast(`🎉 Proof found! Nonce: ${d.nonce} | Bits: ${d.bits}\nPlease sign the transaction in MetaMask.`);
            
            try {
                const tx = await arcMinerContract.mine(d.nonce, currentWorkState.anchorBlock, { value: currentWorkState.price });
                $('#miner-state').textContent = `Tx Sent: ${tx.hash.slice(0,10)}...`;
                await tx.wait();
                $('#miner-state').textContent = `Minted Successfully!`;
                fetchWorkState(); // refresh
                loadLatestMints(); // refresh feed
            } catch (err) {
                $('#miner-state').textContent = `Tx Failed`;
                showToast(`Mint failed: ${err.shortMessage || err.message}`);
            }
        } else if (d.done && isMining) {
            startBatch();
        }
    };
    
    w.onerror = (err) => { console.error(err); };
    startBatch();
}

async function loadLatestMints() {
    if (!arcMinerContract) return;
    const feed = $('#latest-mints');
    try {
        const filter = arcMinerContract.filters.Transfer(ethers.ZeroAddress);
        const events = await arcMinerContract.queryFilter(filter, -100000); // Last 100k blocks
        
        feed.innerHTML = '';
        if (events.length === 0) {
            feed.innerHTML = '<div style="color:#64748b; font-size:13px;">No mints yet.</div>';
            return;
        }
        
        // Show last 10
        const recent = events.slice(-10).reverse();
        for (let e of recent) {
            const id = e.args[2];
            const to = e.args[1];
            
            const item = document.createElement('div');
            item.className = 'mint-item';
            
            try {
                const data = await arcMinerContract.tokenData(id);
                const shortTo = to.slice(0,6) + '...' + to.slice(-4);
                item.innerHTML = `
                    <span>
                        <a href="#">#${id.toString()}</a> 
                        <span style="color:#64748b; margin-left:10px;">${data[1].toString()} bits</span>
                    </span>
                    <span style="color:#94a3b8">${shortTo}</span>
                `;
            } catch(err) {
                item.innerHTML = `<span>#${id.toString()} (Burned)</span>`;
            }
            feed.appendChild(item);
        }
    } catch (e) {
        console.error("Failed to load feed", e);
    }
}


// --- COLLECTION ---
$('#refresh-collection').onclick = () => loadCollection();

async function loadCollection() {
    if (!account || !arcMinerContract) return;
    const grid = $('#nft-grid');
    grid.innerHTML = '<div class="empty-state">Loading your NFTs...</div>';
    
    if (ARCMINER_ADDRESS === "0x0000000000000000000000000000000000000000") {
        const rarityNames = ["Common", "Rare", "Legendary"];
        const rarityColors = ["#bfc5cc", "#38bdf8", "#facc15"];
        const imgs = ["common.jpeg", "rare.jpeg", "legendary.jpeg"];
        const fakeData = [
            { id: 1, rarity: 0, bits: 28, epoch: 0, rent: 1.5, burn: 125 },
            { id: 42, rarity: 1, bits: 32, epoch: 1, rent: 12.3, burn: 250 },
            { id: 99, rarity: 2, bits: 38, epoch: 3, rent: 154.2, burn: 1000 }
        ];
        
        const countEl = document.getElementById('collection-count');
        if (countEl) countEl.textContent = `You hold: ${fakeData.length} ARCMINER(s)`;

        grid.innerHTML = '';
        fakeData.forEach(d => {
            const card = document.createElement('div');
            card.className = 'nft-card';
            card.style.borderColor = rarityColors[d.rarity];
            card.innerHTML = `
                <img src="assets/${imgs[d.rarity]}" alt="${rarityNames[d.rarity]}" style="width: 100%; height: auto; border: 4px solid #1f2937; margin-bottom: 15px;">
                <h4 style="color:${rarityColors[d.rarity]}">ARCMINER #${d.id}</h4>
                <p><b>Rarity:</b> ${rarityNames[d.rarity]}</p>
                <p><b>Bits:</b> ${d.bits}</p>
                <p><b>Epoch:</b> ${d.epoch}</p>
                <p style="margin-top:10px; color:#a3e635">Rent: ${d.rent} USDC</p>
                <p style="color:#f87171">Burn Val: ${d.burn} ARCM</p>
                <div class="buttons">
                    <button class="btn-secondary" style="flex:1; padding:10px; font-size:10px; font-family:'Press Start 2P',cursive;" onclick="showToast('Demo Claim!')">CLAIM</button>
                    <button class="btn-secondary danger" style="flex:1; padding:10px; font-size:10px; font-family:'Press Start 2P',cursive;" onclick="showToast('Demo Burn!')">BURN</button>
                </div>
            `;
            grid.appendChild(card);
        });
        
        // Mock forge activation
        window.myCommonIds = [1, 2];
        const forgeBtn = $('#forge-btn');
        if (forgeBtn) {
            forgeBtn.disabled = false;
            forgeBtn.textContent = "FORGE NOW (BURN 2 COMMON)";
            forgeBtn.onclick = () => showToast('Demo Forge Success!');
        }
        return;
    }

    try {
        // Fetch balance first to avoid RPC log range limits
        const balance = await arcMinerContract.balanceOf(account);
        const numOwned = Number(balance);
        
        if (numOwned === 0) {
            const countEl = document.getElementById('collection-count');
            if (countEl) countEl.textContent = `You hold: 0 ARCMINER(s)`;
            grid.innerHTML = '<div class="empty-state">No NFTs found. Start mining to get one!</div>';
            return;
        }

        const totalMinted = Number(await arcMinerContract.mintedCount());
        const ownedIds = [];
        window.myCommonIds = [];
        
        // Loop backwards from newest minted to find owned tokens
        for (let i = totalMinted; i >= 1; i--) {
            try {
                const owner = await arcMinerContract.ownerOf(i);
                if (owner.toLowerCase() === account.toLowerCase()) {
                    ownedIds.push(i);
                    if (ownedIds.length === numOwned) break; // Found all tokens
                }
            } catch (err) {
                // Token might be burned or doesn't exist
            }
        }
        
        const countEl = document.getElementById('collection-count');
        if (countEl) countEl.textContent = `You hold: ${ownedIds.length} ARCMINER(s)`;

        grid.innerHTML = '';
        for (let id of ownedIds) {
            const data = await arcMinerContract.tokenData(id); // rarity, workBits, mintEpoch, workHash, mintedAt
            const rent = await arcMinerContract.pendingRent(id);
            const burnVal = await arcMinerContract.burnReward(id);
            
            if (data[0] === 0n || data[0] === 0) {
                window.myCommonIds.push(id);
            }
            
            const rarityNames = ["Common", "Rare", "Legendary"];
            const rarityColors = ["#bfc5cc", "#38bdf8", "#facc15"];
            
            const card = document.createElement('div');
            card.className = 'nft-card';
            card.style.borderColor = rarityColors[data[0]];
            const imgName = data[0] === 2n || data[0] === 2 ? 'legendary.jpeg' : data[0] === 1n || data[0] === 1 ? 'rare.jpeg' : 'common.jpeg';
            
            card.innerHTML = `
                <img src="assets/${imgName}" alt="${rarityNames[data[0]]}" style="width: 100%; height: auto; border: 4px solid #1f2937; margin-bottom: 15px;">
                <h4 style="color:${rarityColors[data[0]]}">ARCMINER #${id.toString()}</h4>
                <p><b>Rarity:</b> ${rarityNames[data[0]]}</p>
                <p><b>Bits:</b> ${data[1].toString()}</p>
                <p><b>Epoch:</b> ${data[2].toString()}</p>
                <p style="margin-top:10px; color:#a3e635">Rent: ${formatEth(rent)} USDC</p>
                <p style="color:#f87171">Burn Val: ${formatEth(burnVal)} ARCM</p>
                <div class="buttons">
                    <button class="btn-secondary" style="flex:1; padding:10px; font-size:10px; font-family:'Press Start 2P',cursive;" onclick="claimRent(${id})">CLAIM</button>
                    <button class="btn-secondary danger" style="flex:1; padding:10px; font-size:10px; font-family:'Press Start 2P',cursive;" onclick="burnNft(${id})">BURN</button>
                </div>
            `;
            grid.appendChild(card);
        }
        
        if (window.myCommonIds && window.myCommonIds.length >= 2) {
            const forgeBtn = $('#forge-btn');
            if (forgeBtn) {
                forgeBtn.disabled = false;
                forgeBtn.textContent = "FORGE NOW (BURN 2 COMMON)";
                forgeBtn.onclick = async () => {
                    if (!confirm(`Are you sure you want to burn Common NFT #${window.myCommonIds[0]} and #${window.myCommonIds[1]} to Forge 1 Rare?`)) return;
                    try {
                        const tx = await arcMinerContract.forgeMiner(window.myCommonIds[0], window.myCommonIds[1]);
                        await tx.wait();
                        showToast('Forged successfully into a Rare!');
                        loadCollection();
                    } catch(e) {
                        showToast(e.shortMessage || e.message, 'error');
                    }
                };
            }
        } else {
            const forgeBtn = $('#forge-btn');
            if (forgeBtn) {
                forgeBtn.disabled = true;
                forgeBtn.textContent = "NEED 2 COMMON NFTS";
            }
        }
        
    } catch (e) {
        grid.innerHTML = `<div class="empty-state">Error loading collection: ${e.message}</div>`;
    }
}

window.claimRent = async (id) => {
    try {
        const tx = await arcMinerContract.claimRent(id);
        await tx.wait();
        showToast('Rent claimed successfully!');
        loadCollection();
    } catch(e) { showToast(e.shortMessage || e.message); }
};

window.burnNft = async (id) => {
    if (!confirm(`Are you sure you want to burn NFT #${id} for ARCM?`)) return;
    try {
        const tx = await arcMinerContract.burnForARCM(id);
        await tx.wait();
        showToast('Burned successfully!');
        loadCollection();
    } catch(e) { showToast(e.shortMessage || e.message); }
};

// --- POOL SWAP ---
const swapAmount = $('#swap-amount');
const receiveAmount = $('#receive-amount');
const swapBtn = $('#swap-btn');
const arcmBalLabel = $('#arcm-bal-label');

async function loadPool() {
    if (!account || !arcmContract) return;
    try {
        const bal = await arcmContract.balanceOf(account);
        arcmBalLabel.textContent = `You Pay ($ARCM) - Bal: ${formatEth(bal)}`;
        swapAmount.disabled = false;
        swapBtn.disabled = false;
        swapBtn.textContent = "SWAP TO USDC";
        
        swapAmount.oninput = () => {
            // Rough estimation for UI (2.5% fee), exact is on contract
            const val = parseFloat(swapAmount.value) || 0;
            receiveAmount.value = (val * 0.975).toFixed(4) + " (Est.)";
        };
    } catch(e) { console.error(e); }
}

swapBtn.onclick = async () => {
    const val = swapAmount.value;
    if (!val || val <= 0) return;
    
    try {
        const amountIn = parseEth(val);
        swapBtn.textContent = "APPROVING...";
        swapBtn.disabled = true;
        
        const allowance = await arcmContract.allowance(account, POOL_ADDRESS);
        if (allowance < amountIn) {
            const txApprove = await arcmContract.approve(POOL_ADDRESS, amountIn);
            await txApprove.wait();
        }
        
        swapBtn.textContent = "SWAPPING...";
        const txSwap = await poolContract.sellARCM(amountIn, 0); // 0 slippage tolerance for simplicity here
        await txSwap.wait();
        
        showToast('Swap successful!');
        swapAmount.value = '';
        receiveAmount.value = '';
        loadPool();
        
    } catch(e) {
        showToast(e.shortMessage || e.message);
        swapBtn.textContent = "SWAP TO USDC";
        swapBtn.disabled = false;
    }
};

// Initialize mock/real UI state on load
fetchWorkState();



// --- PROFILE MENU LOGIC ---
if ($('#disconnect-btn')) {
    $('#disconnect-btn').onclick = () => {
        account = null;
        signer = null;
        $('#connect').textContent = "CONNECT WALLET";
        $('#miner-state').textContent = "Disconnected";
        $('#cpu').disabled = true;
        $('#profile-menu').style.display = 'none';
        showToast('Wallet disconnected.');
    };
}

let soundEnabled = true;
if ($('#sound-on')) {
    $('#sound-on').onclick = () => {
        soundEnabled = true;
        $('#sound-on').style.color = '#a3e635';
        $('#sound-off').style.color = '#64748b';
    };
}
if ($('#sound-off')) {
    $('#sound-off').onclick = () => {
        soundEnabled = false;
        $('#sound-off').style.color = '#a3e635';
        $('#sound-on').style.color = '#64748b';
    };
}


// --- VISUALIZER PALETTES ---
function renderPalettes(hashHex, targetBits) {
    const lastPalette = $('#last-mined-palette');
    const targetPalette = $('#target-palette');
    if (!lastPalette || !targetPalette) return;
    
    // Setup target palette
    const targetHexChars = Math.ceil(targetBits / 4);
    $('#target-bits-display').textContent = targetBits + " LEADING ZERO BITS";
    targetPalette.innerHTML = '';
    for(let i = 0; i < 64; i++) {
        const div = document.createElement('div');
        div.style.flex = "1";
        div.style.backgroundColor = i < targetHexChars ? "#000" : "#334155";
        targetPalette.appendChild(div);
    }
    
    // Setup last mined palette
    $('#last-bits-display').textContent = targetBits + " / 256 BITS";
    $('#last-mined-hash').textContent = hashHex;
    lastPalette.innerHTML = '';
    
    // simple color map for 16 hex chars
    const colors = {
        '0': '#000000', '1': '#3b82f6', '2': '#ef4444', '3': '#22c55e',
        '4': '#eab308', '5': '#8b5cf6', '6': '#ec4899', '7': '#f97316',
        '8': '#14b8a6', '9': '#6366f1', 'a': '#84cc16', 'b': '#0ea5e9',
        'c': '#f43f5e', 'd': '#10b981', 'e': '#d946ef', 'f': '#f59e0b'
    };
    
    const hex = hashHex.replace('0x', '');
    for(let i = 0; i < 64; i++) {
        const char = hex[i] || '0';
        const div = document.createElement('div');
        div.style.flex = "1";
        div.style.backgroundColor = colors[char.toLowerCase()] || '#334155';
        lastPalette.appendChild(div);
    }
}

// Intercept fetchWorkState to update palettes
const originalFetch = fetchWorkState;
fetchWorkState = async () => {
    const res = await originalFetch();
    if(currentWorkState && currentWorkState.targetBits) {
        // generate a visual hash for "last mined"
        const bits = currentWorkState.targetBits;
        const hexZeros = Math.floor(bits / 4);
        let fakeHash = "0x" + "0".repeat(hexZeros);
        const chars = "0123456789abcdef";
        for(let i = hexZeros; i < 64; i++) {
            fakeHash += chars[Math.floor(Math.random() * 16)];
        }
        renderPalettes(fakeHash, bits);
    }
    return res;
};

// --- SHOW DEMO ON PAGE LOAD ---
renderPalettes("0x00000000013682d7b710e4b170a968a62bc0901a531c0f3bea16ef0d9815fc67", 36);


// --- LAUNCH COUNTDOWN ---
const LAUNCH_DATE = new Date("2026-09-22T23:59:59Z").getTime();
const overlay = $('#launch-countdown-overlay');
const timerEl = $('#countdown-timer');

function updateCountdown() {
    if (!overlay || !timerEl) return;
    const now = new Date().getTime();
    const distance = LAUNCH_DATE - now;

    if (distance <= 0) {
        overlay.style.display = 'none';
        return;
    }

    const d = Math.floor(distance / (1000 * 60 * 60 * 24));
    const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((distance % (1000 * 60)) / 1000);

    const pad = (num) => num.toString().padStart(2, '0');
    timerEl.textContent = `${pad(d)}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

if (overlay) {
    overlay.style.display = 'flex';
    updateCountdown();
    setInterval(updateCountdown, 1000);
}
