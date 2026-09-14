/**
 * USDC deposit rail — receive-only, non-custodial, ZERO signup/process.
 *
 * How it works:
 *  1. Operator pastes an account-level XPUB into USDC_XPUB (public key only —
 *     it can generate addresses but NEVER spend; safe to handle).
 *  2. Each user gets a deterministic deposit address: xpub/0/index.
 *  3. Watcher scans public RPCs for USDC Transfer events to those addresses.
 *  4. Confirmed transfers auto-credit the internal VaultBank balance.
 *
 * Money safety: credits are idempotent on txHash:logIndex and use atomic
 * balance increments. On-chain funds stay parked until swept with the
 * offline xpriv (a later, explicitly-authorized step — never in this repo).
 *
 * Chains: Base + Polygon (cheap fees) + Ethereum (canonical USDT), 12
 * confirmations. Tokens: USDC (base, polygon) + USDT (polygon, ethereum).
 * USDT contracts verified: polygon on-chain (symbol USD₮0, 6 decimals),
 * ethereum from tether.to official docs (old ERC-20 standard — Transfer logs
 * are standard, only transfer() return differs, which this rail never calls).
 */

const { createHmac, createHash } = require('node:crypto');
const { keccak_256 } = require('js-sha3');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

const NETWORKS = {
    base: {
        chainId: 8453,
        rpc: 'https://mainnet.base.org',
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        label: 'Base',
    },
    polygon: {
        chainId: 137,
        // ponytail: polygon-rpc.com now 403s (API-key required) — publicnode
        rpc: 'https://polygon-bor-rpc.publicnode.com',
        usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        label: 'Polygon',
    },
    ethereum: {
        chainId: 1,
        rpc: 'https://ethereum-rpc.publicnode.com',
        usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        label: 'Ethereum',
    },
};

// Decimals per token on these chains (USDT on BSC is 18 — do not add blindly).
const TOKEN_DECIMALS = { usdc: 6, usdt: 6 };

const CONFIRMATIONS = 12;
const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ============================================================================
// Base58check (xpub decoding) — compact, no dependency
// ============================================================================
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s) {
    let n = 0n;
    for (const ch of s) {
        const d = B58.indexOf(ch);
        if (d < 0) throw new Error('Invalid base58 character.');
        n = n * 58n + BigInt(d);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let bytes = Buffer.from(hex, 'hex');
    // Leading '1's are zero bytes.
    let leading = 0;
    for (const ch of s) {
        if (ch !== '1') break;
        leading++;
    }
    if (bytes.length < leading) throw new Error('Invalid base58 string.');
    const out = Buffer.alloc(leading + bytes.length);
    bytes.copy(out, leading);
    return out;
}

function base58CheckDecode(s) {
    const raw = base58Decode(s);
    if (raw.length < 4) throw new Error('Too short.');
    const body = raw.subarray(0, -4);
    const check = raw.subarray(-4);
    const hash = Buffer.from(keccaklessDoubleSha(body));
    if (!check.equals(hash.subarray(0, 4))) throw new Error('Bad base58check checksum.');
    return body;
}

// Double-SHA256 without keccak (checksum only) — uses node:crypto.
function keccaklessDoubleSha(body) {
    const h1 = createHash('sha256').update(body).digest();
    return createHash('sha256').update(h1).digest();
}

// ============================================================================
// BIP32 non-hardened public derivation + EIP-55 addresses
// ============================================================================
function parseXpub(xpub) {
    const body = base58CheckDecode(String(xpub || '').trim());
    if (body.length !== 78) throw new Error('Invalid xpub length.');
    const version = body.readUInt32BE(0);
    if (version !== 0x0488b21e) throw new Error('Not an xpub (mainnet) key.');
    const pub = body.subarray(45, 78);
    if (pub.length !== 33 || (pub[0] !== 0x02 && pub[0] !== 0x03)) {
        throw new Error('Invalid xpub public key.');
    }
    return { chainCode: body.subarray(13, 45), pub };
}

function keccak(buf) {
    return Buffer.from(keccak_256.arrayBuffer(buf));
}

function deriveChildPub(parentPub, parentChain, index) {
    if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
        throw new Error('Only non-hardened indexes supported.');
    }
    const idx = Buffer.alloc(4);
    idx.writeUInt32BE(index, 0);
    const I = createHmac('sha512', parentChain).update(Buffer.concat([parentPub, idx])).digest();
    const IL = I.subarray(0, 32);
    const IR = I.subarray(32);
    // childPub = G*IL + parentPub (elliptic, pure JS)
    const parentPoint = ec.keyFromPublic(parentPub).getPublic();
    const childPoint = ec.g.mul(IL).add(parentPoint);
    return { pub: Buffer.from(childPoint.encodeCompressed()), chainCode: IR };
}

function pubToAddress(pubCompressed) {
    const key = ec.keyFromPublic(pubCompressed);
    const uncompressed = Buffer.from(key.getPublic(false, 'array')).subarray(1);
    const hash = keccak(uncompressed);
    const addr = hash.subarray(-20).toString('hex');
    // EIP-55 checksum
    const hashHex = keccak(Buffer.from(addr, 'ascii')).toString('hex');
    let out = '0x';
    for (let i = 0; i < addr.length; i++) {
        out += parseInt(hashHex[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
    }
    return out;
}

/**
 * Deposit address for a wallet index: xpub/0/index.
 * Cross-verified against ethers v6 (see __tests__/usdc.test.js vectors).
 */
function deriveDepositAddress(xpub, index) {
    const { chainCode, pub } = parseXpub(xpub);
    const change = deriveChildPub(pub, chainCode, 0);
    const child = deriveChildPub(change.pub, change.chainCode, index);
    return pubToAddress(child.pub);
}

/**
 * Deposit address derived from a root PRIVATE key (USDC_HOT_WALLET_KEY):
 * HMAC-SHA512(root, "vaultbank-deposit/v1/" + index) -> secp256k1 scalar -> address.
 * Domain-separated label keeps these keys independent of any other use of the
 * root. Private keys are NEVER stored or returned — only the address, so a DB
 * leak reveals nothing. Same address on all EVM chains (Base/Polygon/Ethereum).
 */
function deriveDepositAddressFromRoot(rootKeyHex, index) {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid index.');
    const root = String(rootKeyHex || '').toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root key.');
    const rootBytes = Buffer.from(root, 'hex');
    const nBig = BigInt(ec.curve.n.toString(10));
    for (let counter = 0; ; counter++) {
        const label = Buffer.from('vaultbank-deposit/v1/' + index + (counter ? '/' + counter : ''), 'ascii');
        const I = createHmac('sha512', rootBytes).update(label).digest();
        const sBig = BigInt('0x' + I.subarray(0, 32).toString('hex'));
        if (sBig === 0n || sBig >= nBig) continue; // astronomically rare — re-derive
        return pubToAddress(Buffer.from(ec.keyFromPrivate(I.subarray(0, 32)).getPublic(true, 'array')));
    }
}

// ============================================================================
// Chain scanning (public RPC, no keys)
// ============================================================================
function padTopic(addr) {
    return '0x' + '0'.repeat(24) + addr.toLowerCase().replace(/^0x/, '');
}

function parseTransferLog(log, decimals = 6) {
    try {
        if (!log || !Array.isArray(log.topics) || log.topics.length < 3) return null;
        if (String(log.topics[0]).toLowerCase() !== TRANSFER_SIG) return null;
        const to = '0x' + String(log.topics[2]).slice(-40);
        const amount = Number(BigInt(log.data || '0x0')) / 10 ** decimals; // USDC/USDT: 6
        if (!(amount > 0)) return null;
        return {
            to: to.toLowerCase(),
            amount,
            txHash: String(log.transactionHash || ''),
            blockNumber: parseInt(log.blockNumber, 16),
            logIndex: log.logIndex,
        };
    } catch (e) {
        return null;
    }
}

async function rpc(network, method, params) {
    const net = NETWORKS[network];
    if (!net) throw new Error('Unknown network.');
    const r = await fetch(net.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!r.ok) throw new Error(`RPC ${network} failed: ${r.status}`);
    const data = await r.json();
    if (data.error) throw new Error(`RPC ${network} error: ${data.error.message}`);
    return data.result;
}

/**
 * Scan confirmed transfers of `token` (usdc|usdt) to `addresses` since
 * `fromBlock`. Returns { transfers, latest } where latest is the highest
 * block SAFE to advance scan state to (latest chain head minus confirmations).
 */
async function scanDeposits(network, addresses, fromBlock, token = 'usdc') {
    const net = NETWORKS[network];
    if (!net) throw new Error('Unknown network.');
    const contract = net[token];
    if (!contract) throw new Error(`Token ${token} not supported on ${network}.`);
    const head = parseInt(await rpc(network, 'eth_blockNumber', []), 16);
    const safeHead = head - CONFIRMATIONS;
    if (safeHead < fromBlock) return { transfers: [], latest: fromBlock };
    const out = [];
    const addrs = addresses.map((a) => a.toLowerCase());
    const decimals = TOKEN_DECIMALS[token] || 6;
    // One getLogs call per address keeps RPC load tiny.
    for (const addr of addrs) {
        const logs = await rpc(network, 'eth_getLogs', [{
            address: contract,
            topics: [TRANSFER_SIG, null, padTopic(addr)],
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: '0x' + safeHead.toString(16),
        }]);
        for (const log of logs || []) {
            const t = parseTransferLog(log, decimals);
            if (t && t.blockNumber <= safeHead) out.push(t);
        }
    }
    return { transfers: out, latest: safeHead };
}

async function checkChainId(network) {
    const idHex = await rpc(network, 'eth_chainId', []);
    return parseInt(idHex, 16) === NETWORKS[network].chainId;
}

module.exports = {
    NETWORKS,
    TOKEN_DECIMALS,
    CONFIRMATIONS,
    deriveDepositAddress,
    deriveDepositAddressFromRoot,
    parseXpub,
    parseTransferLog,
    scanDeposits,
    checkChainId,
};
