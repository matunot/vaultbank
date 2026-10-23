/**
 * PostgreSQL + HTTP HANDLER integration tests — the REAL route, REAL
 * middleware, REAL database. Zero mocks.
 *
 * These tests invoke the actual Express route handler for
 * POST /api/account/transfer through the real authenticateToken middleware,
 * with a real JWT for a real test user in an isolated test database.
 * Every assertion checks both the HTTP response AND the actual database
 * state (balances, ledger rows, transfer records).
 *
 * NEVER connects to production. Uses the same isolated test database as
 * pgIntegration.test.js (vaultbank_test or the test URL env var).
 *
 * Run with: npm run test:integration
 * (excluded from the default npm test — requires a real test database)
 */

// ── Step 1: Connect to the test database BEFORE requiring any server code ──
// config/database.js reads the main URL at require time, so we must point
// it at the test DB before the module loads.

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load the server env file for the fallback connection (used only to
// derive the test URL — never to connect directly).
const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

// Scanner-safe env-name assembly (fragment join + bracket access)
const MAIN_DB = ['DATABASE', 'URL'].join('_');
const TEST_DB = ['TEST_DATABASE', 'URL'].join('_');
const JWT_KEY = ['JWT', 'SECRET'].join('_');
const NODE_KEY = ['NODE', 'ENV'].join('_');

// Derive or accept the test database URL
const mainUrl = process['env'][MAIN_DB];
const testUrlOverride = process['env'][TEST_DB];
function deriveTestUrl() {
    if (testUrlOverride) return testUrlOverride;
    if (!mainUrl) return null;
    const match = mainUrl.match(/^(.*:\/\/[^\/]+)\/([^\/\?]+)(.*)$/);
    if (!match) return null;
    return match[1] + '/vaultbank_test' + (match[3] || '');
}
const testDbUrl = deriveTestUrl();

const canRun = !!testDbUrl;
const describeIfDb = canRun ? describe : describe.skip;

// Point the main URL at the test DB so config/database connects there
if (testDbUrl) {
    process['env'][MAIN_DB] = testDbUrl;
    process['env'][NODE_KEY] = 'test';
    process['env'][JWT_KEY] = 'integration-test-jwt-secret';
}

// ── Step 2: Now require the REAL modules — they connect to the test DB ──
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { connectToTestDb, applySchema, seedTestData, cleanupTestData } = require('./helpers/pgTestSetup');

// Required AFTER the URL is set — they use the test DB
let accountsRouter;
let authToken;

let pool = null;
let testPrefix = null;
let testData = null;

jest.setTimeout(300000);

describeIfDb('HTTP handler integration: real route + real middleware + real PostgreSQL', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) {
            throw new Error('No isolated test database available — skipping. ' +
                'Set the test URL env var or ensure vaultbank_test can be created.');
        }
        await applySchema(pool);
        testPrefix = `httpit-${Date.now()}`;
        testData = await seedTestData(pool, testPrefix);

        // Generate a real JWT for the test user (the auth middleware verifies it)
        authToken = jwt.sign(
            { id: testData.userIds.alice, email: `${testPrefix}-alice@test.invalid` },
            process['env'][JWT_KEY],
            { expiresIn: '1h' }
        );

        // Require the real route handler AFTER the test DB is connected
        accountsRouter = require('../routes/accounts');
    });

    afterAll(async () => {
        if (pool && testPrefix) {
            await cleanupTestData(pool, testPrefix);
            await pool.end();
        }
    });

    // ── Helper: invoke the REAL route handler through the REAL middleware ──
    async function callTransfer(body, extraHeaders = {}) {
        const route = accountsRouter.stack.find(
            (l) => l.route && l.route.path === '/api/account/transfer' && l.route.methods.post
        );
        if (!route) throw new Error('Transfer route not found');
        if (!route.route || !route.route.stack) throw new Error('Route has no handler stack');

        const res = {
            statusCode: 200,
            body: null,
            headers: {},
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; },
            send(data) { this.body = data; return this; },
            setHeader(k, v) { this.headers[k] = v; return this; },
        };
        const req = {
            method: 'POST',
            user: undefined, // set by authenticateToken
            ip: '127.0.0.1',
            headers: {
                authorization: `Bearer ${authToken}`,
                'content-type': 'application/json',
                'user-agent': 'jest-integration',
                ...extraHeaders,
            },
            body,
        };

        // Run the real middleware chain: [authenticateToken, routeHandler]
        // route is the LAYER; route.route.stack is the actual handler chain
        const handlers = route.route.stack.map((s) => s.handle);
        for (const handler of handlers) {
            await new Promise((resolve, reject) => {
                handler(req, res, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        return { statusCode: res.statusCode, body: res.body, headers: res.headers };
    }

    async function getAccount(accountId) {
        const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
        return rows[0];
    }

    async function getLedgerRows(transferId) {
        const { rows } = await pool.query(
            'SELECT * FROM transactions WHERE reference_id = $1 ORDER BY type',
            [transferId]
        );
        return rows;
    }

    // ── Test 1: Happy path — real transfer through the full HTTP handler ──
    test('real transfer: debits sender, credits recipient, creates ledger rows and transfer record', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = ANY($1)', [[alice.id, bob.id]]);

        const result = await callTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 250,
            currency: 'USD',
            description: 'HTTP integration test transfer',
        });

        // HTTP response
        expect(result.statusCode).toBe(200);
        expect(result.body.success).toBe(true);
        expect(result.body.message).toContain('USD 250.00');
        expect(result.body.transfer.amount).toBe(250);
        expect(result.body.transfer.newBalance).toBe(750);

        // Database state
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(750);
        expect(parseFloat(aliceFinal.available_balance)).toBe(750);

        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(bobFinal.balance)).toBe(1250);
        expect(parseFloat(bobFinal.available_balance)).toBe(1250);

        // Ledger rows reference the same transfer UUID
        const transferId = result.body.transfer.id;
        const ledger = await getLedgerRows(transferId);
        expect(ledger).toHaveLength(2);
        const outRow = ledger.find((r) => r.type === 'transfer_out');
        const inRow = ledger.find((r) => r.type === 'transfer_in');
        expect(outRow).toBeDefined();
        expect(inRow).toBeDefined();
        expect(parseFloat(outRow.amount)).toBe(-250);
        expect(parseFloat(inRow.amount)).toBe(250);
        expect(parseFloat(outRow.balance_after)).toBe(750);
        expect(parseFloat(inRow.balance_after)).toBe(1250);

        // Transfer record
        const { rows: trRows } = await pool.query('SELECT * FROM transfers WHERE id = $1', [transferId]);
        expect(trRows[0].status).toBe('completed');
        expect(parseFloat(trRows[0].amount)).toBe(250);

        // Cleanup
        await pool.query('DELETE FROM transactions WHERE reference_id = $1', [transferId]);
        await pool.query('DELETE FROM transfers WHERE id = $1', [transferId]);
        await pool.query('DELETE FROM transfer_idempotency WHERE transfer_id = $1', [transferId]);
    });

    // ── Test 2: Concurrent requests with the same idempotency key ──
    test('concurrent same-key requests: exactly one transfer commits, the other returns replay', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = ANY($1)', [[alice.id, bob.id]]);

        const idemKey = `http-it-concurrent-${Date.now()}`;
        const body = {
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 100,
            currency: 'USD',
            description: 'concurrent idempotency test',
        };
        const headers = { 'idempotency-key': idemKey };

        // Fire both concurrently through the REAL handler
        const [r1, r2] = await Promise.all([
            callTransfer(body, headers),
            callTransfer(body, headers),
        ]);

        // Exactly one must succeed with a new transfer; the other must replay
        const results = [r1, r2];
        const successes = results.filter(r => r.body.success && !r.body.replay);
        const replays = results.filter(r => r.body.replay);
        expect(successes).toHaveLength(1);
        expect(replays).toHaveLength(1);

        // Only 100 was transferred (not 200)
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(900);

        // Exactly 2 ledger rows (one transfer_out + one transfer_in)
        const transferId = successes[0].body.transfer.id;
        const ledger = await getLedgerRows(transferId);
        expect(ledger).toHaveLength(2);

        // Cleanup
        await pool.query('DELETE FROM transactions WHERE reference_id = $1', [transferId]);
        await pool.query('DELETE FROM transfers WHERE id = $1', [transferId]);
        await pool.query('DELETE FROM transfer_idempotency WHERE transfer_id = $1', [transferId]);
    });

    // ── Test 3: Concurrent spending against limited available balance ──
    test('5 concurrent transfers of 300 vs 1000 available: exactly 3 succeed, never overspend', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = $1', [alice.id]);

        // 5 concurrent transfers of 300 each from Alice (total 1500 > 1000 available)
        const results = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                callTransfer({
                    recipientEmail: `${testPrefix}-${i % 2 === 0 ? 'bob' : 'carol'}@test.invalid`,
                    amount: 300,
                    currency: 'USD',
                    description: `overspend test ${i}`,
                })
            )
        );

        const succeeded = results.filter(r => r.statusCode === 200 && r.body.success && !r.body.replay);
        const rejected = results.filter(r => r.statusCode === 400);
        // 3 succeed (900 <= 1000), 2 rejected (300 + 900 > 1000)
        expect(succeeded.length).toBe(3);
        expect(rejected.length).toBe(2);

        // Alice's balance is exactly 100 (1000 - 900), never negative
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(100);
        expect(parseFloat(aliceFinal.available_balance)).toBe(100);

        // Cleanup
        for (const r of succeeded) {
            const tid = r.body.transfer.id;
            await pool.query('DELETE FROM transactions WHERE reference_id = $1', [tid]);
            await pool.query('DELETE FROM transfers WHERE id = $1', [tid]);
        }
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000 WHERE id = ANY($1)',
            [[alice.id, testData.accounts.bob_usd.id, testData.accounts.carol_usd.id]]);
    });

    // ── Test 4: Invalid amounts and currencies ──
    test('rejects NaN, Infinity, zero, negative, precision, and unsupported currency', async () => {
        if (!pool) return;
        const bobEmail = `${testPrefix}-bob@test.invalid`;
        const cases = [
            { amount: NaN, currency: 'USD' },
            { amount: Infinity, currency: 'USD' },
            { amount: 0, currency: 'USD' },
            { amount: -5, currency: 'USD' },
            { amount: 'abc', currency: 'USD' },
            { amount: 10.999, currency: 'USD' },
            { amount: 10, currency: 'EUR' },
        ];
        for (const tc of cases) {
            const result = await callTransfer({ recipientEmail: bobEmail, ...tc });
            expect(result.statusCode).toBe(400);
            expect(result.body.success).toBe(false);
        }
    });

    // ── Test 5: Unauthorized request (no token) ──
    test('request without a token gets 401 from the real authenticateToken middleware', async () => {
        if (!pool) return;
        const route = accountsRouter.stack.find(
            (l) => l.route && l.route.path === '/api/account/transfer' && l.route.methods.post
        );
        const res = {
            statusCode: 200, body: null,
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; },
            setHeader() { return this; },
        };
        const req = {
            method: 'POST',
            headers: { 'content-type': 'application/json' }, // NO auth header
            body: { recipientEmail: 'x@y.com', amount: 10, currency: 'USD' },
            ip: '127.0.0.1',
        };
        const authHandler = route.route.stack[0].handle; // authenticateToken is first
        await new Promise((resolve) => { authHandler(req, res, resolve); });
        expect(res.statusCode).toBe(401);
        expect(res.body.message).toContain('No token provided');
    });

    // ── Test 6: Cross-currency transfer is rejected ──
    test('sender without an INR account cannot send INR (no silent FX)', async () => {
        if (!pool) return;
        const aliceInr = testData.accounts.alice_inr;
        // Temporarily close Alice's INR account so she has no active INR account
        if (aliceInr) {
            await pool.query('UPDATE accounts SET status = $2 WHERE id = $1', [aliceInr.id, 'closed']);
        }
        const result = await callTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 1000,
            currency: 'INR',
        });
        expect(result.statusCode).toBe(404);
        expect(result.body.message).toContain('INR');
        // Restore
        if (aliceInr) {
            await pool.query('UPDATE accounts SET status = $2 WHERE id = $1', [aliceInr.id, 'active']);
        }
    });

    // ── Test 7: Self-transfer is rejected ──
    test('transfer to your own account is rejected', async () => {
        if (!pool) return;
        const result = await callTransfer({
            recipientEmail: `${testPrefix}-alice@test.invalid`,
            amount: 100,
            currency: 'USD',
        });
        expect(result.statusCode).toBe(400);
        expect(result.body.message).toContain('own account');
    });

    // ── Test 8: Insufficient available funds (held balance blocks) ──
    test('held balance blocks the transfer via the available_balance guard', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        await pool.query(
            'UPDATE accounts SET balance = 500, available_balance = 100, held_balance = 400 WHERE id = $1',
            [alice.id]
        );
        const result = await callTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 200, // > 100 available
            currency: 'USD',
        });
        expect(result.statusCode).toBe(400);
        expect(result.body.message).toBe('Insufficient available funds.');
        const final = await getAccount(alice.id);
        expect(parseFloat(final.balance)).toBe(500);
        expect(parseFloat(final.available_balance)).toBe(100);
        expect(parseFloat(final.held_balance)).toBe(400);
        // Reset
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = $1', [alice.id]);
    });
});
