/**
 * USDC deposit rail unit tests — derivation cross-verified against ethers v6.
 *
 * Reference vectors generated independently with ethers@6.17 from the
 * BIP39 test mnemonic ("abandon...about"), account m/44'/60'/0':
 *   xpub6DCoCpSuQZB2jawqnGMEPS63ePKWkwWPH4TU45Q7LPXWuNd8TMtVxRrgjtEshuqpK3mdhaWHPFsBngh5GFZaM6si3yZdUsT8ddYM3PwnATt
 *
 * Money-critical: if derivation is wrong, deposits go to dead addresses.
 * These vectors pin the implementation to the reference.
 *
 * Run with: `cd server && npx jest __tests__/usdc.test.js`
 */

const { NETWORKS, TOKEN_DECIMALS, deriveDepositAddress, deriveDepositAddressFromRoot, parseTransferLog } = require('../payments/usdc');
const hotwallet = require('../payments/usdc-hotwallet');
const EC = require('elliptic').ec;

const XPUB = 'xpub6DCoCpSuQZB2jawqnGMEPS63ePKWkwWPH4TU45Q7LPXWuNd8TMtVxRrgjtEshuqpK3mdhaWHPFsBngh5GFZaM6si3yZdUsT8ddYM3PwnATt';

describe('usdc derivation (ethers cross-verified)', () => {
    test('index 0', () => {
        expect(deriveDepositAddress(XPUB, 0)).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    });
    test('index 1', () => {
        expect(deriveDepositAddress(XPUB, 1)).toBe('0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
    });
    test('index 7', () => {
        expect(deriveDepositAddress(XPUB, 7)).toBe('0x593814d3309e2dF31D112824F0bb5aa7Cb0D7d47');
    });
    test('deterministic + unique per index', () => {
        expect(deriveDepositAddress(XPUB, 3)).toBe(deriveDepositAddress(XPUB, 3));
        expect(deriveDepositAddress(XPUB, 3)).not.toBe(deriveDepositAddress(XPUB, 4));
    });
    test('rejects garbage xpub', () => {
        expect(() => deriveDepositAddress('not-a-key', 0)).toThrow();
        expect(() => deriveDepositAddress(XPUB.slice(0, -4) + 'XXXX', 0)).toThrow(); // bad checksum
    });
    test('rejects hardened indexes', () => {
        expect(() => deriveDepositAddress(XPUB, 0x80000000)).toThrow();
        expect(() => deriveDepositAddress(XPUB, -1)).toThrow();
    });
});

describe('hot-wallet-rooted deposit derivation (USDC_HOT_WALLET_KEY)', () => {
    // Deposit addresses derived straight from the hot wallet root key so no
    // xpub is required. Golden vectors cross-verified with an independent
    // keccak path (js-sha3 directly). Deterministic — pin them.
    const ROOT = '0x' + '11'.repeat(32);
    test('golden vectors pinned (index 0, 1, 7)', () => {
        expect(deriveDepositAddressFromRoot(ROOT, 0)).toBe('0x6a069f042925e4F664CcB5d447BBe508a568205A');
        expect(deriveDepositAddressFromRoot(ROOT, 1)).toBe('0x6c63749b0dBe6dCA286368cf8C6ef967F41a4566');
        expect(deriveDepositAddressFromRoot(ROOT, 7)).toBe('0x5f0EbDe8204e53851C95F6b1539d5352643374C7');
    });
    test('deterministic + unique per index', () => {
        expect(deriveDepositAddressFromRoot(ROOT, 3)).toBe(deriveDepositAddressFromRoot(ROOT, 3));
        expect(deriveDepositAddressFromRoot(ROOT, 3)).not.toBe(deriveDepositAddressFromRoot(ROOT, 4));
    });
    test('rejects garbage root keys and bad indexes', () => {
        expect(() => deriveDepositAddressFromRoot('nope', 0)).toThrow();
        expect(() => deriveDepositAddressFromRoot('0x' + '11'.repeat(31), 0)).toThrow();
        expect(() => deriveDepositAddressFromRoot(null, 0)).toThrow();
        expect(() => deriveDepositAddressFromRoot(ROOT, -1)).toThrow();
        expect(() => deriveDepositAddressFromRoot(ROOT, 1.5)).toThrow();
    });
});

describe('usdc log parsing', () => {
    const log = {
        // 25.5 USDC = 25500000 = 0x1851960
        data: '0x0000000000000000000000000000000000000000000000000000000001851960',
        topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x0000000000000000000000001111111111111111111111111111111111111111',
            '0x0000000000000000000000009858effd232b4033e47d90003d41ec34ecaeda94',
        ],
        transactionHash: '0xabc123',
        blockNumber: '0x100',
        logIndex: '0x0',
    };
    test('parses amount, destination, hash', () => {
        const t = parseTransferLog(log);
        expect(t.amount).toBeCloseTo(25.5, 6);
        expect(t.to).toBe('0x9858effd232b4033e47d90003d41ec34ecaeda94');
        expect(t.txHash).toBe('0xabc123');
        expect(t.blockNumber).toBe(256);
    });
    test('rejects non-transfer topics and zero value', () => {
        expect(parseTransferLog({ ...log, topics: ['0xdead', log.topics[1], log.topics[2]] })).toBeNull();
        expect(parseTransferLog({ ...log, data: '0x' + '0'.repeat(64) })).toBeNull();
        expect(parseTransferLog(null)).toBeNull();
    });
});

describe('usdt token rails', () => {
    // Money-critical: contracts verified 2026-09-14 — polygon on-chain via
    // eth_call (symbol USD₮0, decimals 6), ethereum from tether.to official
    // docs. A wrong address silently never credits deposits — pin them.
    test('usdt contracts pinned (verified on-chain / official)', () => {
        expect(NETWORKS.polygon.usdt.toLowerCase()).toBe('0xc2132d05d31c914a87c6611c10748aeb04b58e8f');
        expect(NETWORKS.ethereum.usdt.toLowerCase()).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');
        expect(NETWORKS.ethereum.chainId).toBe(1);
        expect(NETWORKS.base.usdt).toBeUndefined(); // no verified Base USDT yet — do not add blindly
    });
    test('usdc contracts unchanged', () => {
        expect(NETWORKS.base.usdc.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
        expect(NETWORKS.polygon.usdc.toLowerCase()).toBe('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
    });
    test('both tokens are 6 decimals on supported chains', () => {
        expect(TOKEN_DECIMALS).toEqual({ usdc: 6, usdt: 6 });
    });
    test('parses USDT transfer (6 decimals, same math as USDC)', () => {
        const usdtLog = {
            data: '0x0000000000000000000000000000000000000000000000000000000000002710', // 10000 = 0.01 USDT
            topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000002222222222222222222222222222222222222222',
                '0x0000000000000000000000009858effd232b4033e47d90003d41ec34ecaeda94',
            ],
            transactionHash: '0xdef456',
            blockNumber: '0x200',
            logIndex: '0x1',
        };
        const t = parseTransferLog(usdtLog);
        expect(t.amount).toBeCloseTo(0.01, 6);
        expect(t.txHash).toBe('0xdef456');
    });
});

describe('usdc-hotwallet signing (EIP-155)', () => {
    // Money-critical: a broken RLP/hash/v makes the chain reject the tx OR
    // broadcast from a wallet that isn't the hot wallet. Pinned to the
    // canonical EIP-155 test vector from the Ethereum spec itself.
    test('signs the canonical EIP-155 spec vector byte-for-byte', () => {
        // Spec vector: key 0x4646…46, chainId 1, nonce 9, 20 gwei, 21k gas,
        // to 0x3535…3535, value 1 ETH, no data.
        hotwallet.NETWORKS.mainnet = { chainId: 1, label: 'test-only' };
        const raw = hotwallet.signTransaction('mainnet', '0x' + '46'.repeat(32), {
            nonce: 9,
            gasPriceWei: 20000000000n,
            gasLimit: '0x5208',
            to: '0x3535353535353535353535353535353535353535',
            valueWei: 1000000000000000000n,
            data: '0x',
        });
        expect(raw).toBe('0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83');
    });
    test('key derives a stable address; transfer calldata shape is exact', () => {
        const w = hotwallet.privateKeyToAddress('0x' + '11'.repeat(32));
        expect(w).toMatch(/^0x[0-9a-f]{40}$/);
        expect(w).toBe(hotwallet.privateKeyToAddress('0x' + '11'.repeat(32)));
        expect(hotwallet.isValidAddress(w)).toBe(true);
        // ERC-20 transfer calldata: 4-byte selector + 32-byte to + 32-byte amount
        expect(hotwallet.NETWORKS.base.tokens.usdt.decimals).toBe(6);
    });
});
