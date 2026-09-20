import { workHash, leadingZeroBits, bytesToBigInt, hex } from './keccak.js';

onmessage = function(e) {
    const { wallet, prevWork, anchor, targetHex, startNonce, maxTries } = e.data;
    
    const target = BigInt(targetHex);
    let tries = 0n;
    let n = BigInt(startNonce);
    const max = BigInt(maxTries);
    
    let lastReport = performance.now();

    while (tries < max) {
        const h = workHash(wallet, n, prevWork, anchor);
        const val = bytesToBigInt(h);
        
        if (val < target) {
            postMessage({ 
                success: true, 
                nonce: n.toString(), 
                hash: hex(h), 
                bits: leadingZeroBits(h), 
                tries: Number(tries) 
            });
            return;
        }
        
        n++;
        tries++;
        
        // Report progress every ~500ms
        if (tries % 1000n === 0n) {
            const now = performance.now();
            if (now - lastReport > 500) {
                postMessage({ success: false, tries: Number(tries), currentNonce: n.toString() });
                lastReport = now;
            }
        }
    }
    
    postMessage({ success: false, done: true, tries: Number(tries), currentNonce: n.toString() });
};
