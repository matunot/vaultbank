/**
 * Hot-wallet BROADCAST SERIALIZATION contract.
 *
 * The withdrawal hot wallet has a single nonce source. If two concurrent
 * requests read 'pending' at the same instant, both sign the SAME nonce and
 * the loser hits the node's duplicate-nonce rejection, which the typed
 * taxonomy classifies as AMBIGUOUS (funds held, operator queue). The engine
 * must therefore serialize the read-nonce -> broadcast span per wallet, so
 * concurrent withdrawals queue behind each other and each sees a fresh nonce.
 *
 * 100% SIMULATED: the JSON-RPC seam is a scripted global.fetch queue keyed by
 * method; no real RPC node is contacted; no key material exists in this file.
 */
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn() },
    isDemo: false,
    findAccountByUserId: jest.fn(),
    createTransaction: jest.fn(),
    createNotification: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => { req.user = { id: 'u-1' }; next(); },
    generateToken: () => 't',
}));

const chain = require('../payments/usdc-hotwallet');

const PRIV = '0x' + 'ab'.repeat(32);   // repetition-built fake; no real bytes
const FROM = '0x' + 'cf'.repeat(20);   // hot wallet (fake)
const TO1 = '0x' + '22'.repeat(20);
const TO2 = '0x' + '33'.repeat(20);
const HASH1 = '0x' + '11'.repeat(32);
const HASH2 = '0x' + '12'.repeat(32);

describe('hot-wallet broadcast serialization (single nonce source)', () => {
    let calls;
    beforeEach(() => {
        calls = [];
        const queues = {
            eth_getTransactionCount: ['0x0', '0x1'],   // 0 for first caller, 1 for second
            eth_gasPrice: ['0x3b9aca00', '0x3b9aca00'],
            eth_sendRawTransaction: [HASH1, HASH2],
        };
        global.fetch = jest.fn(async (url, opts) => {
            const method = JSON.parse(opts.body).method;
            calls.push(method);
            const result = queues[method].shift();
            return { json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
        });
    });

    test('concurrent withdrawals never share a nonce: #2 reads AFTER #1 broadcast', async () => {
        const [a, b] = await Promise.all([
            chain.sendTokens('base', 'usdc', PRIV, FROM, TO1, 1000n),
            chain.sendTokens('base', 'usdc', PRIV, FROM, TO2, 2000n),
        ]);
        expect(a.txHash).toBe(HASH1);
        expect(b.txHash).toBe(HASH2);

        // The second caller's nonce read must happen only after the first
        // caller's raw transaction reached the node.
        const firstSend = calls.indexOf('eth_sendRawTransaction');
        const secondRead = calls.lastIndexOf('eth_getTransactionCount');
        expect(firstSend).toBeGreaterThanOrEqual(0);
        expect(secondRead).toBeGreaterThan(firstSend);

        // Full expected call shape: read, gas, send, read, gas, send.
        expect(calls).toEqual([
            'eth_getTransactionCount', 'eth_gasPrice', 'eth_sendRawTransaction',
            'eth_getTransactionCount', 'eth_gasPrice', 'eth_sendRawTransaction',
        ]);
    });

    test('sequential sends still work normally and consume nonces in order', async () => {
        const a = await chain.sendTokens('base', 'usdc', PRIV, FROM, TO1, 1000n);
        const b = await chain.sendTokens('base', 'usdc', PRIV, FROM, TO1, 1000n);
        expect(a.txHash).toBe(HASH1);
        expect(b.txHash).toBe(HASH2);
        expect(calls.filter((m) => m === 'eth_sendRawTransaction')).toHaveLength(2);
    });

    test('a pre-broadcast failure unblocks the queue for the next withdrawal', async () => {
        queuesFailFirstSend('eth_sendRawTransaction');
        await expect(chain.sendTokens('base', 'usdc', PRIV, FROM, TO1, 1000n))
            .rejects.toMatchObject({ stage: 'broadcast' });

        // Next request proceeds without waiting on the failed one.
        const result = await chain.sendTokens('base', 'usdc', PRIV, FROM, TO2, 1000n);
        expect(result.txHash).toBe(HASH2);
        // Read the nonce twice for the first+second send and never interleave.
        expect(calls.filter((m) => m === 'eth_getTransactionCount')).toHaveLength(2);
    });

    function queuesFailFirstSend(methodToFail) {
        // Rebuild the script so ONLY the first sendRaw rejects with a PROVABLE
        // node rejection (gas price below floor — SAFE_REJECT_RE family) while
        // the nonce counter still advances per read.
        let nonce = 0;
        let failLeft = 1;
        global.fetch = jest.fn(async (url, opts) => {
            const method = JSON.parse(opts.body).method;
            calls.push(method);
            if (method === 'eth_getTransactionCount') { nonce += 1; return { json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' + nonce.toString(16) }) }; }
            if (method === 'eth_gasPrice') return { json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x3b9aca00' }) };
            if (method === methodToFail) {
                if (failLeft-- > 0) return { json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'transaction gas price below minimum' } }) };
                return { json: async () => ({ jsonrpc: '2.0', id: 1, result: HASH2 }) };
            }
            return { json: async () => ({ jsonrpc: '2.0', id: 1, result: HASH2 }) };
        });
    }
});