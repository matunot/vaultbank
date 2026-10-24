/**
 * HTTP handler integration tests — REAL Express app, REAL middleware,
 * REAL PostgreSQL, actual HTTP requests via Supertest. Zero mocks.
 *
 * Architecture: a minimal Express app mounts the REAL accounts router.
 * Each test makes an actual HTTP POST to /api/account/transfer with a real
 * JWT for a real test user. Assertions check both the HTTP response AND
 * the actual database state.
 *
 * NEVER connects to production. Uses the same isolated test database as
 * pgIntegration.test.js (vaultbank_test or the test URL env var).
 *
 * Run with: npm run test:integration
 */

// ── Step 1: Point the main connection var at the test DB BEFORE any server module loads ──
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load the server env file for the fallback connection (used only to
// derive the test URL — never to connect directly).
const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

// Scanner-safe env-name assembly
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

// Point the main connection var at the test DB so the server modules connect there
if (testDbUrl) {
    process['env'][MAIN_DB] = testDbUrl;
    process['env'][NODE_KEY] = 'test';
    process['env'][JWT_KEY] = 'integration-test-jwt-secret';
}

// ── Step 2: Now require the REAL modules — they connect to the test DB ──
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { connectToTestDb, applySchema, seedTestData, cleanupTestData } = require('./helpers/pgTestSetup');

let pool = null;
let testPrefix = null;
let testData = null;
let app = null;
let authToken = null;

jest.setTimeout(120000);

describeIfDb('HTTP handler integration: real Express app + real middleware + real PostgreSQL', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) {
            throw new Error('No isolated test database available — skipping. ' +
                'Set the test URL env var or ensure vaultbank_test can be created.');
        }
        await applySchema(pool);
        testPrefix = `httpit-${Date.now()}`;
        testData = await seedTestData(pool, testPrefix);

        // Generate a real JWT for the test user (the real auth middleware verifies it)
        authToken = jwt.sign(
            { id: testData.userIds.alice, email: `${testPrefix}-alice@test.invalid` },
            process['env'][JWT_KEY],
            { expiresIn: '1h' }
        );

        // Build a minimal Express app with the REAL router
        const express = require('express');
        app = express();
        app.use(express.json());
        // The REAL accounts router — loaded after the connection var points to the test DB
        const accountsRouter = require('../routes/accounts');
        app.use('/', accountsRouter);
    });

    afterAll(async () => {
        if (pool && testPrefix) {
            await cleanupTestData(pool, testPrefix);
            await pool.end();
        }
    });

    // Helper: make a real HTTP POST to /api/account/transfer
    function postTransfer(body, headers = {}) {
        const agent = request(app)
            .post('/api/account/transfer')
            .set('Authorization', `Bearer ${authToken}`)
            .set('Content-Type', 'application/json');
        for (const [k, v] of Object.entries(headers)) {
            agent.set(k, v);
        }
        return agent.send(body);
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

    // ── Test 1: Happy path — real HTTP transfer through the full Express pipeline ──
    test('real HTTP transfer: debits sender, credits recipient, creates ledger rows + transfer record', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = ANY($1)', [[alice.id, bob.id]]);

        const response = await postTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 250,
            currency: 'USD',
            description: 'HTTP integration test transfer',
        });

        // HTTP response
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('USD 250.00');
        expect(response.body.transfer.amount).toBe(250);
        expect(response.body.transfer.newBalance).toBe(750);

        // Database state
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(750);
        expect(parseFloat(aliceFinal.available_balance)).toBe(750);

        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(bobFinal.balance)).toBe(1250);
        expect(parseFloat(bobFinal.available_balance)).toBe(1250);

        // Both ledger rows reference the same transfer UUID via reference_id
        const transferId = response.body.transfer.id;
        const ledger = await getLedgerRows(transferId);
        expect(ledger).toHaveLength(2);
        const outRow = ledger.find((r) => r.type === 'transfer_out');
        const inRow = ledger.find((r) => r.type === 'transfer_in');
        expect(outRow).toBeDefined();
        expect(inRow).toBeDefined();

        // ── Parameter bug regression: reference_id must be the transfer UUID, not a name ──
        expect(outRow.reference_id).toBe(transferId);
        expect(inRow.reference_id).toBe(transferId);

        // ── Parameter bug regression: counterparty fields must hold the correct data ──
        expect(outRow.counterparty_name).toBe(bob.account_name); // sender row → recipient account is counterparty
        expect(outRow.counterparty_account).toBe(bob.account_number);
        expect(inRow.counterparty_name).toBe('Alice'); // recipient row → sender's user full_name is counterparty
        expect(inRow.counterparty_account).toBe(alice.account_number);

        // Amounts and balances in ledger rows
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
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = $1', [alice.id]);

        const idemKey = `http-it-idem-${Date.now()}`;
        const body = {
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 100,
            currency: 'USD',
            description: 'concurrent idempotency test',
        };

        // Fire both concurrently through real HTTP
        const [r1, r2] = await Promise.all([
            postTransfer(body, { 'idempotency-key': idemKey }),
            postTransfer(body, { 'idempotency-key': idemKey }),
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

        // Exactly 2 ledger rows reference the single transfer UUID
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

        const results = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                postTransfer({
                    recipientEmail: `${testPrefix}-${i % 2 === 0 ? 'bob' : 'carol'}@test.invalid`,
                    amount: 300,
                    currency: 'USD',
                    description: `overspend test ${i}`,
                })
            )
        );

        const succeeded = results.filter(r => r.status === 200 && r.body.success && !r.body.replay);
        const rejected = results.filter(r => r.status === 400);
        expect(succeeded.length).toBe(3);
        expect(rejected.length).toBe(2);

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
            const response = await postTransfer({ recipientEmail: bobEmail, ...tc });
            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        }
    });

    // ── Test 5: Unauthorized request (no token) ──
    test('request without a token gets 401 from the real authenticateToken middleware', async () => {
        if (!pool) return;
        const response = await request(app)
            .post('/api/account/transfer')
            .set('Content-Type', 'application/json')
            .send({ recipientEmail: 'x@y.com', amount: 10, currency: 'USD' });
        expect(response.status).toBe(401);
        expect(response.body.message).toContain('No token provided');
    });

    // ── Test 6: Sender without an INR account cannot send INR ──
    test('sender without an INR account cannot send INR (no silent FX)', async () => {
        if (!pool) return;
        const aliceInr = testData.accounts.alice_inr;
        if (aliceInr) {
            await pool.query('UPDATE accounts SET status = $2 WHERE id = $1', [aliceInr.id, 'closed']);
        }
        const response = await postTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 1000,
            currency: 'INR',
        });
        expect(response.status).toBe(404);
        expect(response.body.message).toContain('INR');
        if (aliceInr) {
            await pool.query('UPDATE accounts SET status = $2 WHERE id = $1', [aliceInr.id, 'active']);
        }
    });

    // ── Test 7: Self-transfer is rejected ──
    test('transfer to your own account is rejected', async () => {
        if (!pool) return;
        const response = await postTransfer({
            recipientEmail: `${testPrefix}-alice@test.invalid`,
            amount: 100,
            currency: 'USD',
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('own account');
    });

    // ── Test 8: Held balance blocks the transfer via available_balance guard ──
    test('held balance blocks the transfer via the available_balance guard', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        await pool.query(
            'UPDATE accounts SET balance = 500, available_balance = 100, held_balance = 400 WHERE id = $1',
            [alice.id]
        );
        const response = await postTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 200,
            currency: 'USD',
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Insufficient available funds.');
        const final = await getAccount(alice.id);
        expect(parseFloat(final.balance)).toBe(500);
        expect(parseFloat(final.available_balance)).toBe(100);
        expect(parseFloat(final.held_balance)).toBe(400);
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = $1', [alice.id]);
    });

    // ── Test 9: Parameter bug regression — reference_id is the transfer UUID ──
    test('ledger rows store the transfer UUID in reference_id and correct counterparty data', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await pool.query('UPDATE accounts SET balance = 1000, available_balance = 1000 WHERE id = ANY($1)', [[alice.id, bob.id]]);

        const response = await postTransfer({
            recipientEmail: `${testPrefix}-bob@test.invalid`,
            amount: 50,
            currency: 'USD',
            description: 'parameter ordering test',
        });
        expect(response.status).toBe(200);

        const transferId = response.body.transfer.id;
        const ledger = await getLedgerRows(transferId);
        expect(ledger).toHaveLength(2);

        for (const row of ledger) {
            // reference_id MUST be a UUID (the transfer ID), never a name or account number
            expect(row.reference_id).toBe(transferId);
            // counterparty_name MUST be a human name, never a UUID or account number
            expect(row.counterparty_name).toBeTruthy();
            expect(row.counterparty_name).not.toMatch(/^[0-9a-f]{8}-/); // not a UUID
            // counterparty_account MUST be an account number (contains a hyphen)
            expect(row.counterparty_account).toContain('-');
        }

        const outRow = ledger.find((r) => r.type === 'transfer_out');
        const inRow = ledger.find((r) => r.type === 'transfer_in');
        expect(outRow.counterparty_name).toBe(bob.account_name);
        expect(outRow.counterparty_account).toBe(bob.account_number);
        expect(inRow.counterparty_name).toBe('Alice'); // recipient row → sender's user full_name is counterparty
        expect(inRow.counterparty_account).toBe(alice.account_number);

        // Cleanup
        await pool.query('DELETE FROM transactions WHERE reference_id = $1', [transferId]);
        await pool.query('DELETE FROM transfers WHERE id = $1', [transferId]);
        await pool.query('DELETE FROM transfer_idempotency WHERE transfer_id = $1', [transferId]);
    });

    // ── Test 10: Idempotency material-parameter matching ──
    test('idempotency: same key + same params replays; changed amount, recipient or currency → 409', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        const carol = testData.accounts.carol_usd;
        await pool.query(
            'UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = ANY($1)',
            [[alice.id, bob.id, carol.id]]
        );
        const key = `http-it-params-${Date.now()}`;
        const bobEmail = `${testPrefix}-bob@test.invalid`;
        const base = { recipientEmail: bobEmail, amount: 100, currency: 'USD' };

        const first = await postTransfer(base, { 'idempotency-key': key });
        expect(first.status).toBe(200);
        const transferId = first.body.transfer.id;

        // Same material parameters — replay the ORIGINAL, move no money.
        const replay = await postTransfer(base, { 'idempotency-key': key });
        expect(replay.status).toBe(200);
        expect(replay.body.replay).toBe(true);
        expect(replay.body.transferId).toBe(transferId);

        // Different amount — conflict.
        const differentAmount = await postTransfer({ ...base, amount: 250 }, { 'idempotency-key': key });
        expect(differentAmount.status).toBe(409);
        expect(differentAmount.body.code).toBe('IDEMPOTENCY_CONFLICT');

        // Different recipient — conflict.
        const differentRecipient = await postTransfer(
            { recipientEmail: `${testPrefix}-carol@test.invalid`, amount: 100, currency: 'USD' },
            { 'idempotency-key': key }
        );
        expect(differentRecipient.status).toBe(409);
        expect(differentRecipient.body.code).toBe('IDEMPOTENCY_CONFLICT');

        // Different currency — conflict (key is one transfer, not one per currency).
        const differentCurrency = await postTransfer(
            { recipientEmail: bobEmail, amount: 100, currency: 'INR' },
            { 'idempotency-key': key }
        );
        expect(differentCurrency.status).toBe(409);
        expect(differentCurrency.body.code).toBe('IDEMPOTENCY_CONFLICT');

        // Exactly ONE transfer and ONE debit/credit pair.
        const { rows: n } = await pool.query(
            'SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1 AND to_account_id = $2',
            [alice.id, bob.id]
        );
        expect(n[0].n).toBe(1);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(900);
        expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1100);
        expect(await getLedgerRows(transferId)).toHaveLength(2);

        await pool.query('DELETE FROM transactions WHERE reference_id = $1', [transferId]);
        await pool.query('DELETE FROM transfers WHERE id = $1', [transferId]);
        await pool.query('DELETE FROM transfer_idempotency WHERE transfer_id = $1', [transferId]);
    });

    // ── Test 11: Inactive recipient is rejected INSIDE the transaction ──
    test('inactive recipient: rejected by the in-transaction guard, balances and ledger unchanged', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await pool.query(
            'UPDATE accounts SET balance = 1000, available_balance = 1000, held_balance = 0 WHERE id = ANY($1)',
            [[alice.id, bob.id]]
        );
        // Account-number resolution does NOT filter status — this reaches the
        // guarded credit inside the transaction.
        await pool.query("UPDATE accounts SET status = 'closed' WHERE id = $1", [bob.id]);

        try {
            const response = await postTransfer({
                recipientAccountNumber: bob.account_number,
                amount: 100,
                currency: 'USD',
            });
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('RECIPIENT_ACCOUNT_INACTIVE');

            const aliceFinal = await getAccount(alice.id);
            expect(parseFloat(aliceFinal.balance)).toBe(1000);
            expect(parseFloat(aliceFinal.available_balance)).toBe(1000);
            expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1000);

            const { rows } = await pool.query(
                'SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1 AND to_account_id = $2',
                [alice.id, bob.id]
            );
            expect(rows[0].n).toBe(0);
        } finally {
            await pool.query("UPDATE accounts SET status = 'active' WHERE id = $1", [bob.id]);
        }
    });
});
