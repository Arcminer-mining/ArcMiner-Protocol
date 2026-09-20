// Minimal Keccak-256 using BigInt lanes. No dependencies.
const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,
  0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
  0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n
];
const R = [
  [0,36,3,41,18], [1,44,10,45,2], [62,6,43,15,61], [28,55,25,21,56], [27,20,39,8,14]
];
const rot = (x,n) => n===0 ? x : ((x<<BigInt(n)) | (x>>BigInt(64-n))) & MASK;

function permute(a){
  for(const rc of RC){
    const c = Array(5), d = Array(5), b = Array(25);
    for(let x=0;x<5;x++) c[x]=a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20];
    for(let x=0;x<5;x++) d[x]=c[(x+4)%5]^rot(c[(x+1)%5],1);
    for(let y=0;y<5;y++) for(let x=0;x<5;x++) a[x+5*y]=(a[x+5*y]^d[x])&MASK;
    for(let y=0;y<5;y++) for(let x=0;x<5;x++) b[((2*x+3*y)%5)*5 + y] = rot(a[x+5*y], R[x][y]);
    for(let y=0;y<5;y++) for(let x=0;x<5;x++) a[x+5*y] = b[x+5*y] ^ ((~b[(x+1)%5+5*y] & MASK) & b[(x+2)%5+5*y]);
    a[0]^=rc;
  }
}

export function keccak256(bytes){
  const rate=136;
  const msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const padLen = rate - (msg.length % rate);
  const padded = new Uint8Array(msg.length + padLen);
  padded.set(msg); padded[msg.length]=0x01; padded[padded.length-1]|=0x80;
  const a = Array(25).fill(0n);
  for(let off=0; off<padded.length; off+=rate){
    for(let i=0;i<rate/8;i++){
      let lane=0n;
      for(let j=0;j<8;j++) lane |= BigInt(padded[off+i*8+j]) << BigInt(8*j);
      a[i]^=lane;
    }
    permute(a);
  }
  const out=new Uint8Array(32);
  for(let i=0;i<4;i++) for(let j=0;j<8;j++) out[i*8+j]=Number((a[i]>>BigInt(8*j))&255n);
  return out;
}
export const hex = b => '0x'+[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
export const unhex = s => { s=s.replace(/^0x/,''); if(s.length%2) throw Error('hex length'); return Uint8Array.from(s.match(/../g)?.map(x=>parseInt(x,16))||[]); };
export const concat = (...xs) => { const n=xs.reduce((a,x)=>a+x.length,0), o=new Uint8Array(n); let p=0; for(const x of xs){o.set(x,p);p+=x.length;} return o; };
export function uint256be(v){ let x=BigInt(v), o=new Uint8Array(32); for(let i=31;i>=0;i--){o[i]=Number(x&255n);x>>=8n;} return o; }
export function packWork(miner, nonce, prevWork, anchor){
  const addr=unhex(miner); if(addr.length!==20) throw Error('miner must be 20 bytes');
  const p=unhex(prevWork), a=unhex(anchor); if(p.length!==32||a.length!==32) throw Error('bytes32');
  return concat(addr,uint256be(nonce),p,a);
}
export function workHash(miner,nonce,prevWork,anchor){ return keccak256(packWork(miner,nonce,prevWork,anchor)); }
export function leadingZeroBits(bytes){ let n=0; for(const v of bytes){ if(v===0){n+=8;continue;} for(let b=7;b>=0;b--){ if((v&(1<<b))!==0) return n; n++; } } return n; }
export function bytesToBigInt(bytes){ let x=0n; for(const b of bytes)x=(x<<8n)|BigInt(b); return x; }
