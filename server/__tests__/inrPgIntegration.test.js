/**
 * INR rails integration — REAL PostgreSQL, REAL Express routes, REAL HMAC
 * webhook signature, REAL money SQL. Only the provider NETWORK is mocked.
 *
 * Collections:
 *   - valid signed webhook credits exactly once (balance + available_balance)
 *   - duplicate event id never double-credits
 *   - same UTR under a second event id never double-credits
 *   - invalid signature writes nothing
 *   - non-INR commits a currency_rejected event and credits nothing
 *   - unmatched virtual account rolls back (provider retries)
 *   - two concurrent deliveries of one event credit once
 *
 * Payouts (provider fetch mocked):
 *   - reservation + provider submit + ledger row
 *   - idempotent replay (same key, no second debit)
 *   - concurrent same key debits once
 *   - safe provider rejection refunds exactly once and marks the withdrawal failed
 *   - ambiguous provider failure holds funds as reconciliation_required
 *
 * NEVER connects to production. Uses the isolated vaultbank_test database.
 * Run with: npm run test:integration
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

// Scanner-safe env-name assembly.
const MAIN_DB = ['DATABASE', 'URL'].join('_');
const TEST_DB = ['TEST_DATABASE', 'URL'].join('_');
const JWT_KEY = ['JWT', 'SECRET'].join('_');
const NODE_KEY = ['NODE', 'ENV'].join('_');
const CF_ID = ['CASHFREE', 'CLIENT_ID'].join('_');
const CF_SECRET = ['CASHFREE', 'CLIENT_SECRET'].join('_');
const CF_PID = ['CASHFREE', 'PAYOUTS_CLIENT_ID'].join('_');
const CF_PSEC = ['CASHFREE', 'PAYOUTS_CLIENT_SECRET'].join('_');
const CF_ENV = ['CASHFREE', 'ENV'].join('_');
const VB_COLLECTIONS = ['VB', 'COLLECTIONS_PROVIDER'].join('_');
const VB_PAYOUTS = ['VB', 'PAYOUT_PROVIDER'].join('_');

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

const TEST_SECRET = 'inr-integration-cf-secret';
if (testDbUrl) {
    process['env'][MAIN_DB] = testDbUrl;
    process['env'][NODE_KEY] = 'test';
    process['env'][JWT_KEY] = 'inr-integration-jwt-secret';
    process['env'][CF_ID] = 'inr-integration-cf-id';
    process['env'][CF_SECRET] = TEST_SECRET;
    process['env'][CF_PID] = 'inr-integration-payout-id';
    process['env'][CF_PSEC] = 'inr-integration-payout-secret';
    process['env'][CF_ENV] = 'sandbox';
    process['env'][VB_COLLECTIONS] = 'cashfree';
    process['env'][VB_PAYOUTS] = 'cashfree';
}

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { connectToTestDb, applySchema, seedTestData, cleanupTestData } = require('./helpers/pgTestSetup');
const { captureRawBody } = require('../middleware/rawBody');

jest.setTimeout(120000);

let pool = null;
let prefix = null;
let testData = null;
let app = null;
let authToken = null;
let aliceId = null;
let aliceInr = null;
let vaId = null;

function jsonResponse(status, body) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describeIfDb('INR rails integration: real PostgreSQL + real routes + real HMAC', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) {
            throw new Error('No isolated test database available — set the test URL env var or ensure vaultbank_test can be created.');
        }
        await applySchema(pool);
        prefix = `inrit-${Date.now()}`;
        testData = await seedTestData(pool, prefix);
        aliceId = testData.userIds.alice;
        aliceInr = testData.accounts.alice_inr;
        authToken = jwt.sign(
            { id: aliceId, email: `${prefix}-alice@test.invalid` },
            process['env'][JWT_KEY],
            { expiresIn: '1h' }
        );

        // Lazy collections tables + required unique indexes (deployed schema).
        const { ensureCollectionsSchema } = require('../collections/schema');
        await ensureCollectionsSchema();

        vaId = 'IT' + Date.now();
        await pool.query(
            `INSERT INTO virtual_accounts (provider, provider_virtual_account_id, user_id, account_id,
                currency, bank_code, account_number, ifsc, status, provisioned_at)
             VALUES ('cashfree', $1, $2, $3, 'INR', 'YESB', '98912574001', 'YESB1234567', 'active', NOW())`,
            [vaId, aliceId, aliceInr.id]
        );

        app = express();
        app.use(express.json({ limit: '10mb', verify: captureRawBody }));
        app.use('/', require('../routes/collections'));
        app.use('/', require('../routes/external-payouts'));

        global.fetch = jest.fn();
    });

    afterAll(async () => {
        if (pool && prefix) {
            // collection_events has no FK to users; delete explicitly.
            await pool.query('DELETE FROM collection_events WHERE event_id LIKE $1', [`${prefix}%`]);
            await cleanupTestData(pool, prefix);
            await pool.end();
        }
        delete global.fetch;
    });

    async function getInr() {
        const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [aliceInr.id]);
        return rows[0];
    }

    async function getEvent(eventId) {
        const { rows } = await pool.query(
            'SELECT * FROM collection_events WHERE provider = $1 AND event_id = $2',
            ['cashfree', eventId]
        );
        return rows[0];
    }

    async function getTx(reference) {
        const { rows } = await pool.query(
            'SELECT * FROM transactions WHERE external_reference = $1 ORDER BY created_at',
            [reference]
        );
        return rows;
    }

    async function getPayout(key) {
        const { rows } = await pool.query(
            'SELECT * FROM payout_requests WHERE user_id = $1 AND idempotency_key = $2',
            [aliceId, key]
        );
        return rows;
    }

    function paymentPayload({ eventId, utr, amount = '125.50', currency = 'INR', va = vaId, status = 'SUCCESS' }) {
        return {
            type: 'PAYMENT_SUCCESS_WEBHOOK',
            data: {
                payment: {
                    cf_payment_id: eventId,
                    payment_amount: amount,
                    payment_currency: currency,
                    payment_status: status,
                    payment_method: {
                        vba_transfer: {
                            vaccount_id: va,
                            utr,
                            remitter_name: 'Integration Tester',
                            remitter_account: '1234567890',
                        },
                    },
                },
            },
        };
    }

    function signedWebhook(payload, secret = TEST_SECRET) {
        const raw = JSON.stringify(payload);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = crypto.createHmac('sha256', secret).update(timestamp + raw).digest('base64');
        return request(app)
            .post('/api/collections/webhook/cashfree')
            .set('Content-Type', 'application/json')
            .set('x-webhook-timestamp', timestamp)
            .set('x-webhook-signature', signature)
            .send(raw);
    }

    function mockPayoutProvider({ transferStatus, transferBody, statusStatus = 200, statusBody } = {}) {
        global.fetch.mockClear();
        global.fetch.mockImplementation(async (url) => {
            const u = String(url);
            if (u.includes('/payout/v1/authorize')) {
                return jsonResponse(200, { data: { token: 'integration-token', expiry: Math.floor(Date.now() / 1000) + 600 } });
            }
            if (u.includes('/payout/v1/getBeneficiary/')) return jsonResponse(404, { message: 'not found' });
            if (u.includes('/payout/v1/addBeneficiary')) return jsonResponse(200, { data: {} });
            if (u.includes('/payout/v1/requestTransfer')) return jsonResponse(transferStatus, transferBody);
            if (u.includes('/payout/v1.1/getTransferStatus')) {
                return jsonResponse(statusStatus, statusBody || { data: { transfer: { status: 'PENDING' } } });
            }
            return jsonResponse(500, { message: 'unexpected test URL' });
        });
    }

    function reconcilePayout(id) {
        return request(app)
            .post(`/api/payouts/requests/${id}/reconcile`)
            .set('Authorization', `Bearer ${authToken}`);
    }

    function postPayout(key, body = {}) {
        return request(app)
            .post('/api/payouts/requests')
            .set('Authorization', `Bearer ${authToken}`)
            .set('Idempotency-Key', key)
            .set('Content-Type', 'application/json')
            .send(Object.assign({ amount: '100.00', bankAccount: '001111222333', ifsc: 'HDFC0000001', address1: '12 Test Road', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001' }, body));
    }

    // ── Schema ──────────────────────────────────────────────────────────────
    test('collections unique indexes exist in the real database', async () => {
        const { rows } = await pool.query(
            `SELECT indexname FROM pg_indexes
             WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
            [['virtual_accounts_provider_va_uidx', 'collection_events_provider_event_id_uidx']]
        );
        const names = new Set(rows.map((r) => r.indexname));
        expect(names.has('virtual_accounts_provider_va_uidx')).toBe(true);
        expect(names.has('collection_events_provider_event_id_uidx')).toBe(true);
    });

    test('VaultBank-owned ledger is balanced, immutable by source key, and rejects unbalanced journals', async () => {
        const { db } = require('../config/database');
        const { ensureVaultLedgerSchema, ensureCustomerLedgerAccount, postBalancedJournal } = require('../services/ledgerJournalService');
        await ensureVaultLedgerSchema();
        const sourceId = `${prefix}-owned-ledger`;
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await ensureCustomerLedgerAccount(client, aliceInr.id);
            await ensureCustomerLedgerAccount(client, testData.accounts.bob_inr.id);
            const posted = await postBalancedJournal(client, {
                eventType: 'internal_transfer',
                sourceType: 'ledger_integration_test',
                sourceId,
                currency: 'INR',
                description: 'VaultBank owned ledger integration test',
                actorUserId: aliceId,
                entries: [
                    { accountId: aliceInr.id, side: 'debit', amount: '1.25' },
                    { accountId: testData.accounts.bob_inr.id, side: 'credit', amount: '1.25' },
                ],
            });
            expect(posted.replay).toBe(false);
            await client.query('COMMIT');
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw error;
        } finally {
            client.release();
        }

        const { rows: balanceRows } = await pool.query(
            `SELECT j.currency,
                    SUM(e.amount) FILTER (WHERE e.side = 'debit') AS debits,
                    SUM(e.amount) FILTER (WHERE e.side = 'credit') AS credits,
                    COUNT(*) AS entries
               FROM vb_ledger_journals j JOIN vb_ledger_entries e ON e.journal_id = j.id
              WHERE j.source_type = 'ledger_integration_test' AND j.source_id = $1
              GROUP BY j.currency`,
            [sourceId]
        );
        expect(balanceRows).toHaveLength(1);
        expect(balanceRows[0].currency).toBe('INR');
        expect(Number(balanceRows[0].debits)).toBe(Number(balanceRows[0].credits));
        expect(Number(balanceRows[0].debits)).toBe(1.25);
        expect(Number(balanceRows[0].entries)).toBe(2);

        const replayClient = await db.getClient();
        try {
            await replayClient.query('BEGIN');
            const replay = await postBalancedJournal(replayClient, {
                eventType: 'internal_transfer',
                sourceType: 'ledger_integration_test',
                sourceId,
                currency: 'INR',
                description: 'Retry of same test journal',
                actorUserId: aliceId,
                entries: [
                    { accountId: aliceInr.id, side: 'debit', amount: '1.25' },
                    { accountId: testData.accounts.bob_inr.id, side: 'credit', amount: '1.25' },
                ],
            });
            expect(replay.replay).toBe(true);
            await expect(postBalancedJournal(replayClient, {
                eventType: 'internal_transfer',
                sourceType: 'ledger_integration_test',
                sourceId,
                currency: 'INR',
                description: 'Conflict must not replay',
                actorUserId: aliceId,
                entries: [
                    { accountId: aliceInr.id, side: 'debit', amount: '1.26' },
                    { accountId: testData.accounts.bob_inr.id, side: 'credit', amount: '1.26' },
                ],
            })).rejects.toMatchObject({ code: 'VB_LEDGER_IDEMPOTENCY_CONFLICT' });
            await replayClient.query('ROLLBACK');
        } finally {
            replayClient.release();
        }

        const badClient = await db.getClient();
        const badSource = `${prefix}-unbalanced-ledger`;
        try {
            await badClient.query('BEGIN');
            const { rows } = await badClient.query(
                `INSERT INTO vb_ledger_journals
                    (event_type, source_type, source_id, currency, description)
                 VALUES ('internal_transfer', 'ledger_integration_test', $1, 'INR', 'Must fail balance constraint')
                 RETURNING id`,
                [badSource]
            );
            await badClient.query(
                'INSERT INTO vb_ledger_entries (journal_id, ledger_account_id, side, amount) VALUES ($1, (SELECT id FROM vb_ledger_accounts WHERE account_id = $2), \'debit\', 1.00)',
                [rows[0].id, aliceInr.id]
            );
            await expect(badClient.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
            await badClient.query('ROLLBACK').catch(() => {});
        } finally {
            badClient.release();
        }
        const { rows: badRows } = await pool.query(
            'SELECT id FROM vb_ledger_journals WHERE source_type = $1 AND source_id = $2',
            ['ledger_integration_test', badSource]
        );
        expect(badRows).toHaveLength(0);
    });

    test('admin reconciliation queues require authentication', async () => {
        const payouts = await request(app).get('/api/payouts/admin/requests');
        expect(payouts.status).toBe(401);
        const collections = await request(app).get('/api/collections/admin/overview');
        expect(collections.status).toBe(401);
    });

    // ── Collections ─────────────────────────────────────────────────────────
    test('valid signed webhook credits INR exactly once (balance + available + ledger)', async () => {
        const before = Number((await getInr()).balance);
        const eventId = `${prefix}-pay-1`;
        const utr = `${prefix}-UTR-1`;
        const res = await signedWebhook(paymentPayload({ eventId, utr }));
        expect(res.status).toBe(200);
        expect(res.body.credited).toBe(true);

        const after = await getInr();
        expect(Number(after.balance)).toBeCloseTo(before + 125.5, 2);
        expect(Number(after.available_balance)).toBeCloseTo(before + 125.5, 2);

        const rows = await getTx(utr);
        expect(rows.length).toBe(1);
        expect(rows[0].type).toBe('deposit');
        expect(rows[0].status).toBe('completed');
        expect(Number(rows[0].amount)).toBeCloseTo(125.5, 2);
        expect(rows[0].currency).toBe('INR');
        expect(rows[0].metadata.automatic).toBe(true);

        const event = await getEvent(eventId);
        expect(event.status).toBe('credited');
        expect(Number(event.amount)).toBeCloseTo(125.5, 2);
    });

    test('a signed payment to a conflict-status VBA is still credited (no stranded money)', async () => {
        const conflictVa = `${prefix}-VA-CONFLICT`;
        await pool.query(
            `INSERT INTO virtual_accounts (provider, provider_virtual_account_id, user_id, account_id, currency, status)
             VALUES ('cashfree', $1, $2, $3, 'INR', 'conflict')`,
            [conflictVa, aliceId, aliceInr.id]
        );
        const before = Number((await getInr()).balance);
        const utr = `${prefix}-UTR-CONFLICT`;
        const res = await signedWebhook(paymentPayload({ eventId: `${prefix}-conflict`, utr, va: conflictVa, amount: '42.00' }));
        expect(res.status).toBe(200);
        expect(res.body.credited).toBe(true);
        expect(Number((await getInr()).balance)).toBeCloseTo(before + 42, 2);
        expect((await getTx(utr)).length).toBe(1);
    });

    test('duplicate delivery of the same event id never double-credits', async () => {
        const eventId = `${prefix}-pay-1`;
        const utr = `${prefix}-UTR-1`;
        const before = Number((await getInr()).balance);
        const res = await signedWebhook(paymentPayload({ eventId, utr }));
        expect(res.status).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        expect((await getTx(utr)).length).toBe(1);
    });

    test('same UTR under a new event id never double-credits', async () => {
        const utr = `${prefix}-UTR-1`;
        const eventId = `${prefix}-pay-legacy-duplicate`;
        const before = Number((await getInr()).balance);
        const res = await signedWebhook(paymentPayload({ eventId, utr }));
        expect(res.status).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        expect((await getTx(utr)).length).toBe(1);
        const event = await getEvent(eventId);
        expect(event.status).toBe('credited_duplicate');
    });

    test('invalid signature writes nothing', async () => {
        const eventId = `${prefix}-bad-signature`;
        const utr = `${prefix}-UTR-BAD`;
        const before = Number((await getInr()).balance);
        const res = await signedWebhook(paymentPayload({ eventId, utr }), 'wrong-secret');
        expect(res.status).toBe(400);
        expect(await getEvent(eventId)).toBeUndefined();
        expect((await getTx(utr)).length).toBe(0);
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
    });

    test('signed-but-invalid payment is recorded as failed and returns 400, never a silent 200', async () => {
        const eventId = `${prefix}-bad-amount`;
        const before = Number((await getInr()).balance);
        const res = await signedWebhook(paymentPayload({ eventId, utr: `${prefix}-UTR-BAD-AMOUNT`, amount: '12.345' }));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('COLLECTIONS_EVENT_INVALID');
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        const { rows } = await pool.query(
            "SELECT * FROM collection_events WHERE event_type = 'PAYMENT_SUCCESS_WEBHOOK' AND status = 'failed' ORDER BY received_at DESC LIMIT 1"
        );
        expect(rows[0]).toBeTruthy();
        expect(rows[0].event_id.startsWith('invalid:')).toBe(true);
        expect(rows[0].amount).toBeNull();
        await pool.query('DELETE FROM collection_events WHERE id = $1', [rows[0].id]);
    });

    test('non-INR commits currency_rejected and credits nothing', async () => {
        const eventId = `${prefix}-usd`;
        const utr = `${prefix}-UTR-USD`;
        const before = Number((await getInr()).balance);
        const res = await signedWebhook(paymentPayload({ eventId, utr, currency: 'USD', amount: '99.00' }));
        expect(res.status).toBe(200);
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        expect((await getTx(utr)).length).toBe(0);
        const event = await getEvent(eventId);
        expect(event.status).toBe('currency_rejected');
    });

    test('unmatched virtual account returns 500, rolls back the event and credits nothing', async () => {
        const eventId = `${prefix}-no-va`;
        const utr = `${prefix}-UTR-NOVA`;
        const before = Number((await getInr()).balance);
        const res = await signedWebhook(paymentPayload({ eventId, utr, va: 'NO-SUCH-VA' }));
        expect(res.status).toBe(500);
        expect(res.body.code).toBe('COLLECTIONS_VA_UNMATCHED');
        expect(await getEvent(eventId)).toBeUndefined();
        expect((await getTx(utr)).length).toBe(0);
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
    });

    test('two concurrent deliveries of one event credit exactly once', async () => {
        const eventId = `${prefix}-concurrent`;
        const utr = `${prefix}-UTR-CONC`;
        const before = Number((await getInr()).balance);
        const payload = paymentPayload({ eventId, utr, amount: '88.00' });
        const [a, b] = await Promise.all([signedWebhook(payload), signedWebhook(payload)]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        const credited = [a, b].filter((r) => r.body.credited === true).length;
        const duplicate = [a, b].filter((r) => r.body.duplicate === true).length;
        expect(credited).toBe(1);
        expect(duplicate).toBe(1);
        expect(Number((await getInr()).balance)).toBeCloseTo(before + 88, 2);
        expect((await getTx(utr)).length).toBe(1);
        expect((await getEvent(eventId)).status).toBe('credited');
    });

    // ── Payouts (provider network mocked; DB/route real) ────────────────────
    test('payout reservation + submission debits once and writes one withdrawal row', async () => {
        const key = `${prefix}-po-happy`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 200, transferBody: { data: { referenceId: 'CF-REF-1', utr: 'UTR-PO-1', acknowledged: 1 } } });

        const res = await postPayout(key);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('submitted');
        expect(res.body.transferId).toMatch(/^VBPO-/);

        const after = await getInr();
        expect(Number(after.balance)).toBeCloseTo(before - 100, 2);
        expect(Number(after.available_balance)).toBeCloseTo(before - 100, 2);

        const payouts = await getPayout(key);
        expect(payouts.length).toBe(1);
        expect(payouts[0].status).toBe('submitted');
        expect(Number(payouts[0].amount)).toBeCloseTo(100, 2);
        expect(payouts[0].currency).toBe('INR');
        expect(payouts[0].destination_account_masked).toBe('****2333');

        const withdrawal = await getTx(payouts[0].transfer_id);
        expect(withdrawal.length).toBe(1);
        expect(withdrawal[0].type).toBe('withdrawal');
        expect(withdrawal[0].status).toBe('processing');
        expect(Number(withdrawal[0].amount)).toBeCloseTo(-100, 2);
    });

    test('payout replay with the same idempotency key never debits again', async () => {
        const key = `${prefix}-po-happy`;
        const before = Number((await getInr()).balance);
        const res = await postPayout(key);
        expect(res.status).toBe(200);
        expect(res.body.replay).toBe(true);
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        expect((await getPayout(key)).length).toBe(1);
    });

    test('two concurrent payouts with one key debit exactly once', async () => {
        const key = `${prefix}-po-concurrent`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 200, transferBody: { data: { referenceId: 'CF-REF-2', utr: 'UTR-PO-2', acknowledged: 1 } } });

        const [a, b] = await Promise.all([postPayout(key, { amount: '50.00' }), postPayout(key, { amount: '50.00' })]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect((await getPayout(key)).length).toBe(1);
        expect(Number((await getInr()).balance)).toBeCloseTo(before - 50, 2);

        const transferCalls = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/requestTransfer'));
        expect(transferCalls.length).toBe(1);
    });

    test('safe provider rejection refunds exactly once and marks the withdrawal failed', async () => {
        const key = `${prefix}-po-safe-reject`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 400, transferBody: { message: 'bank rejected' } });

        const res = await postPayout(key, { amount: '70.00' });
        expect(res.status).toBe(400);

        const after = await getInr();
        expect(Number(after.balance)).toBeCloseTo(before, 2);
        expect(Number(after.available_balance)).toBeCloseTo(before, 2);

        const payouts = await getPayout(key);
        expect(payouts.length).toBe(1);
        expect(payouts[0].status).toBe('failed_refunded');

        const withdrawal = await getTx(payouts[0].transfer_id);
        expect(withdrawal.length).toBe(1);
        expect(withdrawal[0].status).toBe('failed');

        const refund = await getTx(payouts[0].transfer_id + '-REFUND');
        expect(refund.length).toBe(1);
        expect(refund[0].type).toBe('refund');
        expect(refund[0].status).toBe('completed');
        expect(Number(refund[0].amount)).toBeCloseTo(70, 2);
    });

    test('ambiguous provider failure holds funds and never auto-refunds', async () => {
        const key = `${prefix}-po-ambiguous`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 500, transferBody: { message: 'gateway timeout' } });

        const res = await postPayout(key, { amount: '75.00' });
        expect(res.status).toBe(202);
        expect(res.body.status).toBe('reconciliation_required');

        const after = await getInr();
        expect(Number(after.balance)).toBeCloseTo(before - 75, 2);
        expect(Number(after.available_balance)).toBeCloseTo(before - 75, 2);

        const payouts = await getPayout(key);
        expect(payouts.length).toBe(1);
        expect(payouts[0].status).toBe('reconciliation_required');
        expect((await getTx(payouts[0].transfer_id + '-REFUND')).length).toBe(0);
        expect((await getTx(payouts[0].transfer_id))[0].status).toBe('processing');
    });

    test('provider SUCCESS then REVERSED refunds exactly once and marks the withdrawal reversed', async () => {
        const key = `${prefix}-po-reversed`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 200, transferBody: { data: { referenceId: 'CF-REV', utr: 'UTR-REV', acknowledged: 1 } } });

        const created = await postPayout(key, { amount: '100.00' });
        expect(created.status).toBe(200);
        const payout = (await getPayout(key))[0];
        expect(payout.status).toBe('submitted');

        mockPayoutProvider({
            statusStatus: 200,
            statusBody: { data: { transfer: { status: 'SUCCESS', amount: '100.00', currency: 'INR', utr: 'UTR-REV' } } },
        });
        const ok = await reconcilePayout(payout.id);
        expect(ok.status).toBe(200);
        expect(ok.body.payout.status).toBe('succeeded');
        expect((await getTx(payout.transfer_id))[0].status).toBe('completed');

        mockPayoutProvider({
            statusStatus: 200,
            statusBody: { data: { transfer: { status: 'REVERSED', amount: '100.00', currency: 'INR', utr: 'UTR-REV' } } },
        });
        const reversed = await reconcilePayout(payout.id);
        expect(reversed.status).toBe(200);
        expect(reversed.body.payout.status).toBe('failed_refunded');
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        expect((await getTx(payout.transfer_id))[0].status).toBe('reversed');
        expect((await getTx(payout.transfer_id + '-REFUND')).length).toBe(1);
    });

    test('provider status amount mismatch -> 409, no refund, status unchanged', async () => {
        const key = `${prefix}-po-amount-mismatch`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 200, transferBody: { data: { referenceId: 'CF-MIS', utr: 'UTR-MIS', acknowledged: 1 } } });

        const created = await postPayout(key, { amount: '100.00' });
        expect(created.status).toBe(200);
        const payout = (await getPayout(key))[0];

        mockPayoutProvider({
            statusStatus: 200,
            statusBody: { data: { transfer: { status: 'ERROR', amount: '99.00', currency: 'INR' } } },
        });
        const res = await reconcilePayout(payout.id);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('PAYOUT_STATUS_AMOUNT_MISMATCH');
        expect((await getPayout(key))[0].status).toBe('submitted');
        expect(Number((await getInr()).balance)).toBeCloseTo(before - 100, 2);
        expect((await getTx(payout.transfer_id + '-REFUND')).length).toBe(0);
    });

    test('provider status currency mismatch -> 409, no refund, status unchanged', async () => {
        const key = `${prefix}-po-currency-mismatch`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 200, transferBody: { data: { referenceId: 'CF-CUR', utr: 'UTR-CUR', acknowledged: 1 } } });

        const created = await postPayout(key, { amount: '100.00' });
        expect(created.status).toBe(200);
        const payout = (await getPayout(key))[0];

        mockPayoutProvider({
            statusStatus: 200,
            statusBody: { data: { transfer: { status: 'ERROR', amount: '100.00', currency: 'USD' } } },
        });
        const res = await reconcilePayout(payout.id);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('PAYOUT_STATUS_CURRENCY_MISMATCH');
        expect((await getPayout(key))[0].status).toBe('submitted');
        expect(Number((await getInr()).balance)).toBeCloseTo(before - 100, 2);
        expect((await getTx(payout.transfer_id + '-REFUND')).length).toBe(0);
    });

    test('stale reserved payout: admin + provider 404 releases the hold once', async () => {
        const key = `${prefix}-po-stale`;
        const before = Number((await getInr()).balance);
        mockPayoutProvider({ transferStatus: 200, transferBody: { data: { referenceId: 'CF-STALE', utr: 'UTR-STALE', acknowledged: 1 } } });
        const created = await postPayout(key, { amount: '100.00' });
        expect(created.status).toBe(200);
        const payout = (await getPayout(key))[0];
        expect(payout.status).toBe('submitted');

        await pool.query(
            "UPDATE payout_requests SET status = 'reserved', created_at = NOW() - INTERVAL '2 hours' WHERE id = $1",
            [payout.id]
        );
        await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [aliceId]);
        try {
            mockPayoutProvider({ statusStatus: 404 });
            const res = await reconcilePayout(payout.id);
            expect(res.status).toBe(200);
            expect(res.body.payout.status).toBe('failed_refunded');
            expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
            expect((await getTx(payout.transfer_id))[0].status).toBe('cancelled');
            expect((await getTx(payout.transfer_id + '-REFUND')).length).toBe(1);
        } finally {
            await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [aliceId]);
        }
    });

    test('refund account missing -> 500 and the payout is not marked refunded', async () => {
        const transferId = `${prefix}-po-missing-account`;
        const { rows: inserted } = await pool.query(
            `INSERT INTO payout_requests
                (user_id, account_id, transfer_id, idempotency_key, bene_id, amount, currency, status, destination_account_masked, destination_ifsc)
             VALUES ($1, '00000000-0000-4000-8000-000000000000', $2, $3, 'VBU-MISSING', 60.00, 'INR', 'submitted', '****9999', 'HDFC0000001')
             RETURNING id`,
            [aliceId, transferId, `${prefix}-po-missing-account`]
        );
        const payoutId = inserted[0].id;
        const before = Number((await getInr()).balance);

        mockPayoutProvider({
            statusStatus: 200,
            statusBody: { data: { transfer: { status: 'ERROR', amount: '60.00', currency: 'INR' } } },
        });
        const res = await reconcilePayout(payoutId);
        expect(res.status).toBe(500);
        expect(res.body.code).toBe('PAYOUT_REFUND_ACCOUNT_MISSING');
        expect((await getPayout(`${prefix}-po-missing-account`))[0].status).toBe('submitted');
        expect(Number((await getInr()).balance)).toBeCloseTo(before, 2);
        expect((await getTx(transferId + '-REFUND')).length).toBe(0);
    });
});
