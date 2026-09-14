/**
 * VaultBank Chain — hot wallet core. 100% owned code, zero third party.
 *
 * Signs and broadcasts ERC-20 transfers (USDC/USDT) directly to public RPC
 * endpoints on Base / Polygon. Hand-rolled RLP + EIP-155 signing using the
 * already-installed js-sha3 (keccak256) + elliptic (secp256k1) — no web3 lib.
 *
 * Env:
 *   USDC_HOT_WALLET_KEY — 0x-prefixed 32-byte private key of the hot wallet.
 *   Without it, withdrawals return 503 + how-to (deposits are unaffected).
 */

const { keccak256 } = require('js-sha3');
const EC = require('elliptic').ec;

const ec = new EC('secp256k1');

const NETWORKS = {
    base: {
        label: 'Base',
        chainId: 8453,
        rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
        explorer: 'https://basescan.org',
        tokens: {
            usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
            usdt: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
        },
    },
    polygon: {
        label: 'Polygon PoS',
        chainId: 137,
        rpc: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
        explorer: 'https://polygonscan.com',
        tokens: {
            usdc: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
            usdt: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
        },
    },
};

// ---------------------------------------------------------------------------
// Minimal RLP encoding
// ---------------------------------------------------------------------------
function rlpEncode(input) {
    if (Array.isArray(input)) {
        const payload = input.map(rlpEncode).map((b) => hexToBytes(b)).reduce((a, b) => a.concat(b), []);
        return bytesToHex(rlpEncodeLength(payload, 0xc0));
    }
    const bytes = typeof input === 'string' ? hexToBytes(input) : input;
    if (bytes.length === 1 && bytes[0] < 0x80) return bytesToHex(bytes);
    return bytesToHex(rlpEncodeLength(bytes, 0x80));
}

function rlpEncodeLength(bytes, offset) {
    if (bytes.length <= 55) return [offset + bytes.length].concat(bytes);
    const lenBytes = intToBytes(bytes.length);
    return [offset + 55 + lenBytes.length].concat(lenBytes, bytes);
}

function intToBytes(n) {
    const out = [];
    let v = n;
    while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); }
    return out;
}

function hexToBytes(hex) {
    let h = String(hex).toLowerCase().replace(/^0x/, '');
    if (h.length % 2 === 1) h = '0' + h;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
}

function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Integer (or hex quantity) -> minimal big-endian hex string for RLP
function toRlpInt(value) {
    if (value === 0 || value === '0x0' || value === '0') return '0x';
    let h = typeof value === 'number' ? value.toString(16) : String(value).toLowerCase().replace(/^0x/, '');
    if (h.length % 2 === 1) h = '0' + h;
    // strip leading zero bytes
    while (h.length > 2 && h.startsWith('00')) h = h.slice(2);
    return '0x' + h;
}

// ---------------------------------------------------------------------------
// Key / address helpers
// ---------------------------------------------------------------------------
function isValidAddress(addr) {
    return /^0x[0-9a-fA-F]{40}$/.test(String(addr || ''));
}

function privateKeyToAddress(privHex) {
    const key = ec.keyFromPrivate(String(privHex).replace(/^0x/, ''), 'hex');
    let pub = key.getPublic(false, 'hex'); // uncompressed (may include 04 prefix)
    let pubBytes = hexToBytes(pub);
    if (pubBytes.length === 65 && pubBytes[0] === 4) pubBytes = pubBytes.slice(1); // strip 04 prefix
    const hash = keccak256(new Uint8Array(pubBytes));
    return '0x' + hash.slice(-40);
}

function getHotWallet() {
    const key = process.env.USDC_HOT_WALLET_KEY || '';
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
    return { key, address: privateKeyToAddress(key) };
}

// ---------------------------------------------------------------------------
// JSON-RPC (public endpoints, no provider service)
// ---------------------------------------------------------------------------
async function rpc(network, method, params) {
    const r = await fetch(NETWORKS[network].rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }),
    });
    const data = await r.json();
    if (data.error) throw new Error('RPC error: ' + (data.error.message || JSON.stringify(data.error)));
    return data.result;
}

async function getNonce(network, address) {
    const nonceHex = await rpc(network, 'eth_getTransactionCount', [address.toLowerCase(), 'pending']);
    return parseInt(nonceHex, 16);
}

async function getGasPrice(network) {
    const weiHex = await rpc(network, 'eth_gasPrice', []);
    return BigInt(weiHex);
}

// Hot wallet native (gas) + token balances
async function getHotWalletBalances(network, walletAddress) {
    const [nativeWeiHex, tokenHex] = await Promise.all([
        rpc(network, 'eth_getBalance', [walletAddress.toLowerCase(), 'latest']),
        rpc(network, 'eth_call', [
            { to: NETWORKS[network].tokens.usdc.address, data: '0x70a08231' + walletAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0') },
            'latest',
        ]),
    ]);
    return {
        native: Number(BigInt(nativeWeiHex)) / 1e18,
        usdc: parseInt(tokenHex, 16) / 1e6,
    };
}

// ---------------------------------------------------------------------------
// EIP-155 signing — legacy type-0 tx, works on Base and Polygon
// ---------------------------------------------------------------------------
function signTransaction(network, privKey, { nonce, gasPriceWei, gasLimit, to, valueWei, data }) {
    const chainId = NETWORKS[network].chainId;
    const unsigned = [
        toRlpInt(nonce),
        toRlpInt('0x' + gasPriceWei.toString(16)),
        toRlpInt(gasLimit),
        to.toLowerCase(),
        toRlpInt('0x' + valueWei.toString(16)),
        data.toLowerCase(),
        toRlpInt(chainId),
        '0x',
        '0x',
    ];
    const sigHash = hexToBytes(keccak256(new Uint8Array(hexToBytes(rlpEncode(unsigned)))));
    const key = ec.keyFromPrivate(String(privKey).replace(/^0x/, ''), 'hex');
    const sig = key.sign(sigHash, { canonical: true });
    const n = ec.curve.n;
    let s = sig.s.toArrayLike ? Buffer.from(sig.s.toArray('be')) : hexToBytes(sig.s.toString(16));
    let recovery = sig.recoveryParam;
    if (Buffer.compare(s, Buffer.from(n.subn(1).toArray('be')) ) > 0) {
        s = Buffer.from(n.sub(s).toArray('be'));
    }
    if (recovery === null || recovery === undefined) throw new Error('Signing failed: no recovery param');
    const v = chainId * 2 + 35 + recovery;
    const signed = [
        toRlpInt(nonce),
        toRlpInt('0x' + gasPriceWei.toString(16)),
        toRlpInt(gasLimit),
        to.toLowerCase(),
        toRlpInt('0x' + valueWei.toString(16)),
        data.toLowerCase(),
        toRlpInt(v),
        toRlpInt('0x' + sig.r.toString(16)),
        toRlpInt('0x' + bytesToHex(s)),
    ];
    return '0x' + rlpEncode(signed);
}

// Build the ERC-20 transfer(uint256,uint256) calldata for a 6-decimal token
function buildTransferData(tokenAddress, toAddress, amountUnits) {
    const selector = 'a9059cbb';
    const toPart = String(toAddress).toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const amountHex = BigInt(amountUnits).toString(16).padStart(64, '0');
    return '0x' + selector + toPart + amountHex;
}

// Full send: sign + broadcast an ERC-20 transfer from the hot wallet.
// Returns { txHash }
async function sendTokens(network, token, privKey, walletAddress, toAddress, amountUnits) {
    const tokenCfg = NETWORKS[network].tokens[token];
    if (!tokenCfg) throw new Error('Unknown token: ' + token);
    const nonce = await getNonce(network, walletAddress);
    const gasPriceWei = await getGasPrice(network);
    const data = buildTransferData(tokenCfg.address, toAddress, amountUnits);
    const raw = signTransaction(network, privKey, {
        nonce,
        gasPriceWei,
        gasLimit: 120000,
        to: tokenCfg.address,
        valueWei: BigInt(0),
        data,
    });
    const txHash = await rpc(network, 'eth_sendRawTransaction', [raw]);
    return { txHash };
}

module.exports = {
    NETWORKS,
    isValidAddress,
    privateKeyToAddress,
    getHotWallet,
    getHotWalletBalances,
    sendTokens,
};

