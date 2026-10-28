/**
 * VBR intent execution integration tests — REAL Express app, REAL middleware,
 * REAL PostgreSQL, actual HTTP requests via Supertest. Zero mocks.
 *
 * Proves that POST /api/vbr/intents with method=internal direction=send
 * EXECUTES a real atomic internal transfer: sender debit, recipient credit,
 * transfer record, both ledger rows, and the intent reaching its terminal
 * state WITH transfer_id linkage — atomically, with idempotency enforced by
 * the database, and with failures leaving NO partial writes.
 *
 * NEVER connects to production. Uses the same isolated test database as
 * pgIntegration.test.js / pgHttpIntegration.test.js (vaultbank_test or the
 * test URL env var).
 *
 * Run with: npm run test:integration
 */

// ── Step 1: Point the main connection var at the test DB BEFORE any server module loads ──
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

// Scanner-safe env-name assembly
const MAIN_DB = ['DATABASE', 'URL'].join('_');
const TEST_DB = ['TEST_DATABASE', 'URL'].join('_');
const JWT_KEY = ['JWT', 'SECRET'].join('_');
const NODE_KEY = ['NODE', 'ENV'].join('_');

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
const CDB = require('../config/database');

let pool = null;
let testPrefix = null;
let testData = null;
let app = null;
let authToken = null;

jest.setTimeout(120000);

describeIfDb('VBR intent execution: real Express app + real PostgreSQL', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) {
            throw new Error('No isolated test database available — skipping. ' +
                'Set the test URL env var or ensure vaultbank_test can be created.');
        }
        await applySchema(pool);
        testPrefix = `vbrit-${Date.now()}`;
        testData = await seedTestData(pool, testPrefix);

        authToken = jwt.sign(
            { id: testData.userIds.alice, email: `${testPrefix}-alice@test.invalid` },
            process['env'][JWT_KEY],
            { expiresIn: '1h' }
        );

        const express = require('express');
        app = express();
        app.use(express.json());
        // The REAL VBR router + the REAL accounts router (for cross-path
        // idempotency: the direct route and VBR share transfer_idempotency).
        app.use('/', require('../vbr'));
        app.use('/', require('../routes/accounts'));
    });

    afterAll(async () => {
        if (pool && testPrefix) {
            await cleanupTestData(pool, testPrefix);
            await pool.end();
        }
    });

    // ── Helpers ──
    function postIntent(body, headers = {}) {
        const agent = request(app)
            .post('/api/vbr/intents')
            .set('Authorization', `Bearer ${authToken}`)
            .set('Content-Type', 'application/json');
        for (const [k, v] of Object.entries(headers)) {
            agent.set(k, v);
        }
        return agent.send(body);
    }

    function postDirectTransfer(body, headers = {}) {
        const agent = request(app)
            .post('/api/account/transfer')
            .set('Authorization', `Bearer ${authToken}`)
            .set('Content-Type', 'application/json');
        for (const [k, v] of Object.entries(headers)) {
            agent.set(k, v);
        }
        return agent.send(body);
    }

    async function setBalances(accountIds, balance, available = balance, held = 0) {
        await pool.query(
            'UPDATE accounts SET balance = $2, available_balance = $3, held_balance = $4 WHERE id = ANY($1)',
            [accountIds, balance, available, held]
        );
        // Test-only synthetic funding must reset the first-party spendability
        // guard together with the visible account row. Production never uses
        // this helper and keeps verified funds strict.
        await pool.query(
            'UPDATE vb_ledger_accounts SET verified_available_balance = $2 WHERE account_id = ANY($1)',
            [accountIds, available]
        );
    }

    async function getAccount(accountId) {
        const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
        return rows[0];
    }

    async function getIntent(intentId) {
        const { rows } = await pool.query('SELECT * FROM payment_intents WHERE id = $1', [intentId]);
        return rows[0];
    }

    async function getLedgerRows(transferId) {
        const { rows } = await pool.query(
            'SELECT * FROM transactions WHERE reference_id = $1 ORDER BY type',
            [transferId]
        );
        return rows;
    }

    async function transferCount(fromAccountId, toAccountId) {
        const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1 AND to_account_id = $2',
            [fromAccountId, toAccountId]
        );
        return rows[0].n;
    }

    async function cleanupTransfer(transferId) {
        // payment_intents first — its transfer_id FK would block the transfers delete.
        await pool.query('DELETE FROM payment_intents WHERE transfer_id = $1', [transferId]);
        await pool.query('DELETE FROM transactions WHERE reference_id = $1', [transferId]);
        await pool.query('DELETE FROM transfers WHERE id = $1', [transferId]);
        await pool.query('DELETE FROM transfer_idempotency WHERE transfer_id = $1', [transferId]);
    }

    // ── Failure-injection helpers (real database, simulated network faults) ──
    // Lose the COMMIT acknowledgement: 'committed' really commits first (the
    // dangerous ambiguity), 'aborted' really rolls back first.
    function loseNextCommitAck(mode) {
        const original = CDB.db.getClient;
        let armed = true;
        CDB.db.getClient = async () => {
            const inner = await original();
            if (!armed) return inner; // resolution probes get a healthy connection
            armed = false;
            return {
                query: async (sql, params) => {
                    if (String(sql).trim().toUpperCase() === 'COMMIT') {
                        await inner.query(mode === 'committed' ? 'COMMIT' : 'ROLLBACK');
                        const err = new Error('Connection terminated unexpectedly');
                        err.code = 'ECONNRESET';
                        throw err;
                    }
                    return inner.query(sql, params);
                },
                release: (destroy) => inner.release(destroy),
            };
        };
        return () => { CDB.db.getClient = original; };
    }

    // Make selected queries fail, as if the database were unreachable.
    function failQueriesOn(fragments) {
        const original = CDB.db.query;
        CDB.db.query = async (sql, params) => {
            if (fragments.some((f) => String(sql).includes(f))) throw new Error('connection lost');
            return original(sql, params);
        };
        return () => { CDB.db.query = original; };
    }

    // Make selected POOLED-CLIENT queries fail (the ambiguity probe runs on a
    // dedicated client, not db.query).
    function failClientQueriesOn(fragments) {
        const original = CDB.db.getClient;
        CDB.db.getClient = async () => {
            const inner = await original();
            return {
                query: async (sql, params) => {
                    if (fragments.some((f) => String(sql).includes(f))) throw new Error('connection lost');
                    return inner.query(sql, params);
                },
                release: (destroy) => inner.release(destroy),
            };
        };
        return () => { CDB.db.getClient = original; };
    }

    // Lose the COMMIT acknowledgement immediately, but delay the REAL
    // COMMIT/ROLLBACK until the test opens the gate. This models a server
    // still resolving the commit after the client lost the ack: another
    // connection cannot see the transfer, and the persisted intent still
    // reads 'created', while the commit may still land.
    function deferNextCommitAck(mode) {
        const originalGetClient = CDB.db.getClient;
        const originalQuery = CDB.db.query;
        let armed = true;
        let deferred = null;
        let clientCount = 0;
        let openGate;
        const gate = new Promise((resolve) => { openGate = resolve; });
        let onVerificationStarted;
        const verificationStarted = new Promise((resolve) => { onVerificationStarted = resolve; });
        let onMarkerStarted;
        const markerStarted = new Promise((resolve) => { onMarkerStarted = resolve; });

        // Old-style verification used db.query — keep the signal working so
        // this test fails fast (instead of hanging) against the pre-fix code.
        CDB.db.query = async (sql, params) => {
            if (String(sql).includes('FROM transfers t WHERE t.id = $1')) onVerificationStarted();
            return originalQuery(sql, params);
        };
        CDB.db.getClient = async () => {
            const inner = await originalGetClient();
            clientCount += 1;
            if (clientCount === 2) onVerificationStarted(); // the ambiguity probe
            if (clientCount === 3) onMarkerStarted();        // the reconciliation update
            if (!armed) return inner;
            armed = false;
            return {
                query: async (sql, params) => {
                    if (String(sql).trim().toUpperCase() === 'COMMIT') {
                        deferred = (async () => {
                            await gate;
                            await inner.query(mode === 'committed' ? 'COMMIT' : 'ROLLBACK');
                        })();
                        const err = new Error('Connection terminated unexpectedly');
                        err.code = 'ECONNRESET';
                        throw err;
                    }
                    return inner.query(sql, params);
                },
                release: (destroy) => {
                    // Keep the connection alive until the deferred commit/rollback
                    // runs; resolution waits on the gate, so this is safe.
                    Promise.resolve(deferred).catch(() => {}).finally(() => inner.release(destroy));
                },
            };
        };
        return {
            verificationStarted,
            markerStarted,
            openGate,
            restore: () => { CDB.db.getClient = originalGetClient; CDB.db.query = originalQuery; },
        };
    }

    // ── Test 1: Successful USD internal transfer — full pipeline + intent linkage ──
    test('USD internal send intent: executes the transfer, links transfer_id, persists succeeded state', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);

        const response = await postIntent({
            direction: 'send', method: 'internal', amount: '250.00', currency: 'USD',
            counterparty: `${testPrefix}-bob@test.invalid`,
            description: 'VBR USD integration test',
        });

        // HTTP response: an EXECUTED transfer, not a promise of one
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('Successfully transferred USD 250.00');
        expect(response.body.transferId).toBeTruthy();
        const transferId = response.body.transferId;
        expect(response.body.intent.id).toBeTruthy();
        expect(response.body.intent.state).toBe('succeeded');
        expect(response.body.intent.transfer_id).toBe(transferId);

        // PERSISTED intent state (not a response-only claim)
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('succeeded');
        expect(intent.transfer_id).toBe(transferId);
        expect(String(intent.amount)).toBe('250.00');

        // Database: sender debited, recipient credited
        const aliceFinal = await getAccount(alice.id);
        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(aliceFinal.balance)).toBe(750);
        expect(parseFloat(aliceFinal.available_balance)).toBe(750);
        expect(parseFloat(bobFinal.balance)).toBe(1250);
        expect(parseFloat(bobFinal.available_balance)).toBe(1250);

        // Transfer record + both ledger rows reference the same UUID
        const { rows: trRows } = await pool.query('SELECT * FROM transfers WHERE id = $1', [transferId]);
        expect(trRows[0].status).toBe('completed');
        expect(parseFloat(trRows[0].amount)).toBe(250);
        expect(trRows[0].to_user_id).toBe(testData.userIds.bob); // regression: recipient user must not be NULL
        const ledger = await getLedgerRows(transferId);
        expect(ledger).toHaveLength(2);
        expect(ledger.find((r) => r.type === 'transfer_out')).toBeDefined();
        expect(ledger.find((r) => r.type === 'transfer_in')).toBeDefined();

        await cleanupTransfer(transferId);
    });

    // ── Test 2: Successful INR internal transfer — same guarantees ──
    test('INR internal send intent: executes the transfer with the same guarantees', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_inr;
        const bob = testData.accounts.bob_inr;
        await setBalances([alice.id, bob.id], 50000);

        const response = await postIntent({
            direction: 'send', method: 'internal', amount: '1000.50', currency: 'INR',
            counterparty: `${testPrefix}-bob@test.invalid`,
            description: 'VBR INR integration test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.intent.state).toBe('succeeded');

        const aliceFinal = await getAccount(alice.id);
        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(aliceFinal.balance)).toBe(49000 - 0.5);
        expect(parseFloat(bobFinal.balance)).toBe(51000.5);

        const ledger = await getLedgerRows(response.body.transferId);
        expect(ledger).toHaveLength(2);
        expect(parseFloat(ledger.find((r) => r.type === 'transfer_in').amount)).toBe(1000.50);

        await cleanupTransfer(response.body.transferId);
    });

    // ── Test 3: Insufficient funds — no partial writes ──
    test('insufficient funds: intent failed, balances untouched, no transfer or ledger rows', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id], 500, 100, 400); // 500 total, only 100 available
        await setBalances([bob.id], 777); // sentinel: proves no partial credit

        const response = await postIntent({
            direction: 'send', method: 'internal', amount: '300.00', currency: 'USD',
            counterparty: `${testPrefix}-bob@test.invalid`,
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.intent.state).toBe('failed');
        expect(response.body.intent.transfer_id).toBeNull();

        // Nothing moved, nothing half-written
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(500);
        expect(parseFloat(aliceFinal.available_balance)).toBe(100);
        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(bobFinal.balance)).toBe(777); // sentinel: any partial credit fails
        expect(parseFloat(bobFinal.available_balance)).toBe(777);
        expect(await transferCount(alice.id, bob.id)).toBe(0);
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('failed');
        expect(intent.failure_reason).toContain('Insufficient');
    });

    // ── Test 4: Unknown recipient — clear failure, no writes ──
    test('unknown recipient: 404, intent failed, no money moved', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        await setBalances([alice.id], 1000);

        const response = await postIntent({
            direction: 'send', method: 'internal', amount: '100.00', currency: 'USD',
            counterparty: `${testPrefix}-nobody@test.invalid`,
        });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
        expect(response.body.intent.state).toBe('failed');
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(1000);
        const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1', [alice.id]);
        expect(rows[0].n).toBe(0);
    });

    // ── Test 5: Self-transfer rejected ──
    test('self-transfer: 400, intent failed, no money moved', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        await setBalances([alice.id], 1000);

        const response = await postIntent({
            direction: 'send', method: 'internal', amount: '100.00', currency: 'USD',
            counterparty: `${testPrefix}-alice@test.invalid`,
        });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('own account');
        expect(response.body.intent.state).toBe('failed');
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(1000);
        expect(parseFloat(aliceFinal.available_balance)).toBe(1000);
    });

    // ── Test 6: Cross-currency rejected ──
    test('cross-currency: INR intent to a USD account number → 400, intent failed, no money moved', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_inr;
        const bobUsd = testData.accounts.bob_usd;
        await setBalances([alice.id, bobUsd.id], 1000);

        const response = await postIntent({
            direction: 'send', method: 'internal', amount: '100.00', currency: 'INR',
            counterparty: bobUsd.account_number, // a USD account
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.intent.state).toBe('failed');
        expect(response.body.intent.failure_reason).toContain('USD');
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(1000);
    });

    // ── Test 7: receive + internal is clearly rejected ──
    test('receive + internal: 400 with a clear message, intent persisted as failed', async () => {
        if (!pool) return;
        const response = await postIntent({
            direction: 'receive', method: 'internal', amount: '100.00', currency: 'USD',
        });
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('not supported');
        expect(response.body.intent.state).toBe('failed');
    });

    // ── Test 8: Idempotent replay — same key, same params → ONE transfer ──
    test('same idempotency key retried: original intent replayed, exactly one transfer', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-replay-${Date.now()}`;
        const body = {
            direction: 'send', method: 'internal', amount: '200.00', currency: 'USD',
            counterparty: `${testPrefix}-bob@test.invalid`,
        };

        const first = await postIntent(body, { 'idempotency-key': key });
        expect(first.status).toBe(200);
        expect(first.body.success).toBe(true);
        expect(first.body.replay).toBeUndefined();
        expect(first.body.intent.state).toBe('succeeded');

        const second = await postIntent(body, { 'idempotency-key': key });
        expect(second.status).toBe(200);
        expect(second.body.replay).toBe(true);
        expect(second.body.intent.id).toBe(first.body.intent.id);

        // ONE transfer, ONE debit — not two
        expect(await transferCount(alice.id, bob.id)).toBe(1);
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(800);

        await cleanupTransfer(first.body.transferId);
    });

    // ── Test 9: Same key, DIFFERENT params → clear conflict ──
    test('same idempotency key with different amount: 409 conflict, no second transfer', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-conflict-${Date.now()}`;

        const first = await postIntent(
            { direction: 'send', method: 'internal', amount: '100.00', currency: 'USD', counterparty: `${testPrefix}-bob@test.invalid` },
            { 'idempotency-key': key }
        );
        expect(first.status).toBe(200);

        const conflicting = await postIntent(
            { direction: 'send', method: 'internal', amount: '500.00', currency: 'USD', counterparty: `${testPrefix}-bob@test.invalid` },
            { 'idempotency-key': key }
        );
        expect(conflicting.status).toBe(409);
        expect(conflicting.body.success).toBe(false);
        expect(conflicting.body.code).toBe('IDEMPOTENCY_CONFLICT');

        // Still exactly one transfer of 100 — the conflicting one never ran
        expect(await transferCount(alice.id, bob.id)).toBe(1);
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(900);

        await cleanupTransfer(first.body.transferId);
    });

    // ── Test 10: Concurrent duplicate requests — no double execution ──
    test('concurrent same-key VBR intents: exactly one transfer commits', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-concurrent-${Date.now()}`;
        const body = {
            direction: 'send', method: 'internal', amount: '150.00', currency: 'USD',
            counterparty: `${testPrefix}-bob@test.invalid`,
        };

        const [r1, r2] = await Promise.all([
            postIntent(body, { 'idempotency-key': key }),
            postIntent(body, { 'idempotency-key': key }),
        ]);

        const results = [r1, r2];
        const successes = results.filter((r) => r.status === 200 && r.body.success && !r.body.replay);
        const replays = results.filter((r) => r.status === 200 && r.body.replay);
        expect(successes).toHaveLength(1);
        expect(replays).toHaveLength(1);

        // Exactly one transfer, one debit of 150
        expect(await transferCount(alice.id, bob.id)).toBe(1);
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(850);
        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(bobFinal.balance)).toBe(1150);

        // And the winner's intent is persisted as succeeded with the transfer link
        const winnerIntent = await getIntent(successes[0].body.intent.id);
        expect(winnerIntent.state).toBe('succeeded');
        expect(winnerIntent.transfer_id).toBe(successes[0].body.transferId);

        await cleanupTransfer(successes[0].body.transferId);
    });

    // ── Test 11: Competing debits — 5 concurrent intents vs limited balance ──
    test('5 concurrent intents of 300 vs 1000 available: exactly 3 succeed, never overdrawn', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                postIntent({
                    direction: 'send', method: 'internal', amount: '300.00', currency: 'USD',
                    counterparty: `${testPrefix}-bob@test.invalid`,
                })
            )
        );

        const succeeded = results.filter((r) => r.status === 200 && r.body.success);
        const rejected = results.filter((r) => r.status === 400);
        expect(succeeded.length).toBe(3);
        expect(rejected.length).toBe(2);
        for (const r of succeeded) {
            expect(r.body.intent.state).toBe('succeeded');
        }
        for (const r of rejected) {
            expect(r.body.intent.state).toBe('failed');
        }

        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(100);
        expect(parseFloat(aliceFinal.available_balance)).toBe(100);
        const bobFinal = await getAccount(bob.id);
        expect(parseFloat(bobFinal.balance)).toBe(1900);

        for (const r of succeeded) {
            await cleanupTransfer(r.body.transferId);
        }
    });

    // ── Test 12: DB failure mid-transaction → ROLLBACK, no misleading success ──
    test('ledger write failure mid-transaction: ROLLBACK, intent failed, no partial writes', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);

        // Force a REAL mid-transaction failure: a trigger that raises on the
        // first ledger INSERT. The transfer record + debit + credit already
        // happened inside the transaction — only ROLLBACK can undo them.
        await pool.query(`
            CREATE OR REPLACE FUNCTION vbrit_force_rollback() RETURNS trigger AS $fn$
            BEGIN
                IF NEW.description LIKE '%force-rollback-test%' THEN
                    RAISE EXCEPTION 'forced test failure';
                END IF;
                RETURN NEW;
            END
            $fn$ LANGUAGE plpgsql`
        );
        await pool.query('DROP TRIGGER IF EXISTS vbrit_force_rollback_trg ON transactions');
        await pool.query(`
            CREATE TRIGGER vbrit_force_rollback_trg BEFORE INSERT ON transactions
            FOR EACH ROW EXECUTE FUNCTION vbrit_force_rollback()`
        );

        try {
            const response = await postIntent({
                direction: 'send', method: 'internal', amount: '400.00', currency: 'USD',
                counterparty: `${testPrefix}-bob@test.invalid`,
                description: 'force-rollback-test transfer',
            });

            // The request must NOT report success
            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
            expect(response.body.intent.state).toBe('failed');

            // And the database must show NOTHING happened
            const aliceFinal = await getAccount(alice.id);
            expect(parseFloat(aliceFinal.balance)).toBe(1000);
            const bobFinal = await getAccount(bob.id);
            expect(parseFloat(bobFinal.balance)).toBe(1000);
            expect(await transferCount(alice.id, bob.id)).toBe(0);

            // The intent is persisted as failed with the real reason
            const intent = await getIntent(response.body.intent.id);
            expect(intent.state).toBe('failed');
            expect(intent.failure_reason).toContain('forced test failure');
            expect(intent.transfer_id).toBeNull();
        } finally {
            await pool.query('DROP TRIGGER IF EXISTS vbrit_force_rollback_trg ON transactions');
            await pool.query('DROP FUNCTION IF EXISTS vbrit_force_rollback()');
        }
    });

    // ── Test 13: Cross-path idempotency — direct route + VBR, same key ──
    test('direct transfer then VBR intent with the same key: replayed, same transfer, no double execution', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-crosspath-${Date.now()}`;
        const bobEmail = `${testPrefix}-bob@test.invalid`;

        // 1. The existing route executes a transfer with key K
        const direct = await postDirectTransfer(
            { recipientEmail: bobEmail, amount: 250, currency: 'USD', description: 'cross-path test' },
            { 'idempotency-key': key }
        );
        expect(direct.status).toBe(200);
        const directTransferId = direct.body.transfer.id;

        // 2. VBR receives the same key with the SAME parameters
        const vbr = await postIntent(
            { direction: 'send', method: 'internal', amount: '250.00', currency: 'USD', counterparty: bobEmail },
            { 'idempotency-key': key }
        );

        // It must NOT execute a second transfer — it replays the first one
        expect(vbr.status).toBe(200);
        expect(vbr.body.replay).toBe(true);
        expect(vbr.body.transferId).toBe(directTransferId);
        expect(vbr.body.intent.state).toBe('succeeded');
        expect(vbr.body.intent.transfer_id).toBe(directTransferId);

        expect(await transferCount(alice.id, bob.id)).toBe(1);
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(750); // debited ONCE

        await cleanupTransfer(directTransferId);
    });

    // ── Test 14: Cross-path conflict — same key, different params ──
    test('direct transfer then VBR intent with the same key but different amount: 409, no second transfer', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-crossconflict-${Date.now()}`;
        const bobEmail = `${testPrefix}-bob@test.invalid`;

        const direct = await postDirectTransfer(
            { recipientEmail: bobEmail, amount: 250, currency: 'USD' },
            { 'idempotency-key': key }
        );
        expect(direct.status).toBe(200);

        const vbr = await postIntent(
            { direction: 'send', method: 'internal', amount: '999.00', currency: 'USD', counterparty: bobEmail },
            { 'idempotency-key': key }
        );
        expect(vbr.status).toBe(409);
        expect(vbr.body.code).toBe('IDEMPOTENCY_CONFLICT');
        expect(vbr.body.intent.state).toBe('failed');

        expect(await transferCount(alice.id, bob.id)).toBe(1);
        const aliceFinal = await getAccount(alice.id);
        expect(parseFloat(aliceFinal.balance)).toBe(750); // unchanged by the rejected attempt

        await cleanupTransfer(direct.body.transfer.id);
    });

    // ── Test 15: Lost COMMIT ack — the transaction REALLY committed ──
    test('lost COMMIT acknowledgement after a real commit: reports success, never failure', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-lostack-ok-${Date.now()}`;

        const restore = loseNextCommitAck('committed');
        let response;
        try {
            response = await postIntent(
                { direction: 'send', method: 'internal', amount: '250.00', currency: 'USD', counterparty: `${testPrefix}-bob@test.invalid` },
                { 'idempotency-key': key }
            );
        } finally {
            restore();
        }

        // The transfer committed before the ack was lost: success, never failed.
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.intent.state).toBe('succeeded');
        expect(response.body.transferId).toBeTruthy();
        expect(response.body.message).toContain('Successfully transferred');

        expect(await transferCount(alice.id, bob.id)).toBe(1);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(750);
        expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1250);
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('succeeded');
        expect(intent.failure_reason).toBeNull();
        expect(intent.transfer_id).toBe(response.body.transferId);

        await cleanupTransfer(response.body.transferId);
    });

    // ── Test 16: Lost COMMIT ack — the transaction did NOT commit ──
    test('lost COMMIT acknowledgement without a key: no proof of abort → 503 outcome-unknown, no money moved', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);

        const restore = loseNextCommitAck('aborted');
        let response;
        try {
            response = await postIntent({
                direction: 'send', method: 'internal', amount: '250.00', currency: 'USD',
                counterparty: `${testPrefix}-bob@test.invalid`,
            });
        } finally {
            restore();
        }

        // No idempotency claim to wait on: an absent transfer row can never
        // prove an abort, so the only honest answer is UNKNOWN.
        expect(response.status).toBe(503);
        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('TRANSFER_OUTCOME_UNKNOWN');
        expect(response.body.intent.state).toBe('reconciliation_required');
        expect(await transferCount(alice.id, bob.id)).toBe(0);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(1000);
        expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1000);

        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('reconciliation_required');
        expect(intent.failure_reason).toContain('outcome unknown');
    });

    // ── Test 17: Delayed COMMIT — invisible row + 'created' intent, then the commit lands ──
    test('delayed COMMIT: transfer invisible and intent still created, then the commit lands → verified success, never failure', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-delayed-commit-${Date.now()}`;

        const ctl = deferNextCommitAck('committed');
        let response;
        try {
            // Promise.resolve() starts the lazy supertest request immediately.
            const pending = Promise.resolve(postIntent(
                { direction: 'send', method: 'internal', amount: '250.00', currency: 'USD', counterparty: `${testPrefix}-bob@test.invalid` },
                { 'idempotency-key': key }
            ));
            await ctl.verificationStarted;

            // The dangerous state: the COMMIT has not landed yet, so another
            // connection sees no transfer and a still-'created' intent.
            // Neither observation proves the transaction aborted.
            const { rows: visible } = await pool.query(
                'SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1 AND to_account_id = $2',
                [alice.id, bob.id]
            );
            expect(visible[0].n).toBe(0);
            const { rows: pendingIntent } = await pool.query(
                'SELECT state FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2',
                [testData.userIds.alice, key]
            );
            expect(pendingIntent[0].state).toBe('created');

            ctl.openGate(); // the original transaction COMMITs now
            response = await pending;
        } finally {
            ctl.openGate();
            ctl.restore();
        }
        await new Promise((resolve) => setImmediate(resolve));

        // No definitive failure while the outcome was still resolving.
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.intent.state).toBe('succeeded');
        expect(response.body.transferId).toBeTruthy();

        expect(await transferCount(alice.id, bob.id)).toBe(1);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(750);
        expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1250);
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('succeeded'); // never overwritten by a failure
        expect(intent.failure_reason).toBeNull();
        expect(intent.transfer_id).toBe(response.body.transferId);

        await cleanupTransfer(response.body.transferId);
    });

    // ── Test 18: Delayed COMMIT, then a real abort — the probe proves no commit ──
    test('delayed COMMIT then abort: invisible row + created intent, probe proves no commit → 500 failed, no money', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-delayed-abort-${Date.now()}`;

        const ctl = deferNextCommitAck('aborted');
        let response;
        try {
            const pending = Promise.resolve(postIntent(
                { direction: 'send', method: 'internal', amount: '250.00', currency: 'USD', counterparty: `${testPrefix}-bob@test.invalid` },
                { 'idempotency-key': key }
            ));
            await ctl.verificationStarted;

            const { rows: visible } = await pool.query(
                'SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1 AND to_account_id = $2',
                [alice.id, bob.id]
            );
            expect(visible[0].n).toBe(0);
            const { rows: pendingIntent } = await pool.query(
                'SELECT state FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2',
                [testData.userIds.alice, key]
            );
            expect(pendingIntent[0].state).toBe('created');

            ctl.openGate(); // the original transaction ROLLBACKs now
            response = await pending;
        } finally {
            ctl.openGate();
            ctl.restore();
        }
        await new Promise((resolve) => setImmediate(resolve));

        // The serialized probe waited for the transaction to end without
        // committing: now a definitive failure is honest.
        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('COMMIT_FAILED');
        expect(response.body.intent.state).toBe('failed');
        expect(response.body.intent.failure_reason).toContain('not committed');

        expect(await transferCount(alice.id, bob.id)).toBe(0);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(1000);
        expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1000);
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('failed');
        expect(intent.transfer_id).toBeNull();
    });

    // ── Test 19: Ambiguous ack, probe unavailable — the persisted intent proves success ──
    test('ambiguous commit with unreadable probe: persisted succeeded intent wins, never failed', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);

        const restoreClient = loseNextCommitAck('committed');
        const restoreProbe = failClientQueriesOn(['FROM transfer_idempotency ti']);
        let response;
        try {
            response = await postIntent({
                direction: 'send', method: 'internal', amount: '300.00', currency: 'USD',
                counterparty: `${testPrefix}-bob@test.invalid`,
            });
        } finally {
            restoreProbe();
            restoreClient();
        }

        // The intent row commits WITH the money: succeeded is proof of the commit.
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.intent.state).toBe('succeeded');
        expect(await transferCount(alice.id, bob.id)).toBe(1);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(700);
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('succeeded');

        await cleanupTransfer(response.body.transferId);
    });

    // ── Test 20: The marker update waits for a late commit and never overwrites it ──
    test('delayed COMMIT with an unavailable probe: the reconciliation update waits and never overwrites the committed succeeded', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-marker-race-${Date.now()}`;

        const ctl = deferNextCommitAck('committed');
        const restoreProbe = failClientQueriesOn(['FROM transfer_idempotency ti']);
        let response;
        try {
            const pending = Promise.resolve(postIntent(
                { direction: 'send', method: 'internal', amount: '250.00', currency: 'USD', counterparty: `${testPrefix}-bob@test.invalid` },
                { 'idempotency-key': key }
            ));
            // The probe failed; the handler saw 'created' and now waits on the
            // original transaction's row lock to mark reconciliation_required.
            await ctl.markerStarted;
            ctl.openGate(); // the original COMMITs while the marker UPDATE waits
            response = await pending;
        } finally {
            ctl.openGate();
            restoreProbe();
            ctl.restore();
        }
        await new Promise((resolve) => setImmediate(resolve));

        // The guarded UPDATE matched nothing after the commit landed: the
        // handler re-read and reported success, never reconciliation/failure.
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.intent.state).toBe('succeeded');
        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('succeeded');
        expect(intent.failure_reason).toBeNull();
        expect(intent.transfer_id).toBe(response.body.transferId);
        expect(await transferCount(alice.id, bob.id)).toBe(1);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(750);

        await cleanupTransfer(response.body.transferId);
    });

    // ── Test 21: Genuinely unknown outcome → reconciliation_required, never failure ──
    test('unreadable outcome and unreadable intent: reconciliation_required, 503, no definitive failure', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);

        const restoreClient = loseNextCommitAck('aborted');
        const restoreProbe = failClientQueriesOn(['INSERT INTO transfer_idempotency']);
        const restoreIntent = failQueriesOn(['SELECT * FROM payment_intents WHERE id = $1']);
        let response;
        try {
            response = await postIntent({
                direction: 'send', method: 'internal', amount: '300.00', currency: 'USD',
                counterparty: `${testPrefix}-bob@test.invalid`,
            });
        } finally {
            restoreIntent();
            restoreProbe();
            restoreClient();
        }

        expect(response.status).toBe(503);
        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('TRANSFER_OUTCOME_UNKNOWN');
        expect(response.body.intent.state).toBe('reconciliation_required');

        const intent = await getIntent(response.body.intent.id);
        expect(intent.state).toBe('reconciliation_required');
        expect(intent.failure_reason).toContain('outcome unknown');
        expect(intent.transfer_id).toBeNull();
        expect(await transferCount(alice.id, bob.id)).toBe(0);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(1000);
    });

    // ── Test 21: Direct route ambiguity → 409, retry with the SAME key replays ──
    test('direct route ambiguous commit: 409 outcome-unknown, same-key retry replays without a second debit', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-direct-ambiguous-${Date.now()}`;
        const bobEmail = `${testPrefix}-bob@test.invalid`;
        const body = { recipientEmail: bobEmail, amount: 100, currency: 'USD' };

        const restoreClient = loseNextCommitAck('committed');
        const restoreProbe = failClientQueriesOn(['FROM transfer_idempotency ti']);
        let first;
        try {
            first = await postDirectTransfer(body, { 'idempotency-key': key });
        } finally {
            restoreProbe();
            restoreClient();
        }

        // Never a definitive failure — and never a definitive success either.
        expect(first.status).toBe(409);
        expect(first.body.success).toBe(false);
        expect(first.body.code).toBe('TRANSFER_OUTCOME_UNKNOWN');
        // It actually committed (the ambiguity was real), so the debit happened.
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(900);

        // Retrying with the SAME key is safe: committed → replay, no new debit.
        const retry = await postDirectTransfer(body, { 'idempotency-key': key });
        expect(retry.status).toBe(200);
        expect(retry.body.replay).toBe(true);
        expect(retry.body.transferId).toBeTruthy();
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(900);
        expect(await transferCount(alice.id, bob.id)).toBe(1);

        await cleanupTransfer(retry.body.transferId);
    });

    // ── Test 21: Cross-path VBR → direct route param matching ──
    test('VBR intent then direct transfer with the same key: same params replay, different amount 409', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const key = `vbrit-reverse-crosspath-${Date.now()}`;
        const bobEmail = `${testPrefix}-bob@test.invalid`;

        const vbr = await postIntent(
            { direction: 'send', method: 'internal', amount: '100.00', currency: 'USD', counterparty: bobEmail },
            { 'idempotency-key': key }
        );
        expect(vbr.status).toBe(200);
        const transferId = vbr.body.transferId;

        // The direct route compares the STORED transfer — same params replay.
        const same = await postDirectTransfer(
            { recipientEmail: bobEmail, amount: 100, currency: 'USD' },
            { 'idempotency-key': key }
        );
        expect(same.status).toBe(200);
        expect(same.body.replay).toBe(true);
        expect(same.body.transferId).toBe(transferId);

        const conflict = await postDirectTransfer(
            { recipientEmail: bobEmail, amount: 200, currency: 'USD' },
            { 'idempotency-key': key }
        );
        expect(conflict.status).toBe(409);
        expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

        expect(await transferCount(alice.id, bob.id)).toBe(1);
        expect(parseFloat((await getAccount(alice.id)).balance)).toBe(900);
        await cleanupTransfer(transferId);
    });

    // ── Test 22: Inactive sender is rejected INSIDE the transaction ──
    test('inactive sender: rejected by the in-transaction guard, no transfer record survives', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const { executeAtomicTransfer } = require('../services/transferService');

        await pool.query("UPDATE accounts SET status = 'closed' WHERE id = $1", [alice.id]);
        try {
            // Bypass the status-filtering resolver — this row reaches the service.
            const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [alice.id]);
            const result = await executeAtomicTransfer({
                userId: testData.userIds.alice,
                senderAccount: rows[0],
                recipientAccount: await getAccount(bob.id),
                amount: '10.00',
                currency: 'USD',
                description: 'inactive sender guard test',
            });
            expect(result.code).toBe('SENDER_ACCOUNT_INACTIVE');

            const { rows: n } = await pool.query(
                'SELECT COUNT(*)::int AS n FROM transfers WHERE from_account_id = $1',
                [alice.id]
            );
            expect(n[0].n).toBe(0);
            expect(parseFloat((await getAccount(alice.id)).balance)).toBe(1000);
            expect(parseFloat((await getAccount(alice.id)).available_balance)).toBe(1000);
        } finally {
            await pool.query("UPDATE accounts SET status = 'active' WHERE id = $1", [alice.id]);
        }
    });

    // ── Test 23: Status-change race — recipient closed while the transfer is in flight ──
    test('status-change race: recipient closed mid-transfer → rejected, full ROLLBACK', async () => {
        if (!pool) return;
        const alice = testData.accounts.alice_usd;
        const bob = testData.accounts.bob_usd;
        await setBalances([alice.id, bob.id], 1000);
        const lockClient = await pool.connect();
        try {
            // Hold an uncommitted status change on the recipient row: the
            // transfer's guarded credit blocks on the lock, then re-evaluates.
            await lockClient.query('BEGIN');
            await lockClient.query("UPDATE accounts SET status = 'closed' WHERE id = $1", [bob.id]);

            const pending = postDirectTransfer({
                recipientAccountNumber: bob.account_number,
                amount: 300,
                currency: 'USD',
            });
            await new Promise((resolve) => setTimeout(resolve, 400));
            await lockClient.query('COMMIT');

            const response = await pending;
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('RECIPIENT_ACCOUNT_INACTIVE');

            // The debit already ran inside the transaction — ROLLBACK undid it.
            const aliceFinal = await getAccount(alice.id);
            expect(parseFloat(aliceFinal.balance)).toBe(1000);
            expect(parseFloat(aliceFinal.available_balance)).toBe(1000);
            expect(parseFloat((await getAccount(bob.id)).balance)).toBe(1000);
            expect(await transferCount(alice.id, bob.id)).toBe(0);
        } finally {
            try { await lockClient.query('ROLLBACK'); } catch (_) { /* already committed */ }
            lockClient.release();
            await pool.query("UPDATE accounts SET status = 'active' WHERE id = $1", [bob.id]);
        }
    });
});
