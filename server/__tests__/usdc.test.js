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

const { deriveDepositAddress, parseTransferLog } = require('../payments/usdc');

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
