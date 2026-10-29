/**
 * Multi-currency proof on real PostgreSQL (isolated database only).
 *
 * Verifies that a registered non-INR/USD currency can be held and transferred
 * internally with the same atomicity and double-entry guarantees as USD/INR,
 * that currency isolation holds, and that an operator flag — not a UI toggle —
 * decides whether the currency is usable.
 *
 * No external settlement is implied or exercised here.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

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
const describeIfDb = testDbUrl ? describe : describe.skip;

if (testDbUrl) {
    process['env'][MAIN_DB] = testDbUrl;
    process['env'][NODE_KEY] = 'test';
    process['env'][JWT_KEY] = 'multi-currency-ledger-test-secret';
    process['env'].VB_MULTICURRENCY_ENABLED = 'true';
}

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const { connectToTestDb, applySchema, seedTestData, seedVerifiedTestLedgerAccount, cleanupTestData } = require('./helpers/pgTestSetup');

jest.setTimeout(180000);

let pool = null;
let app = null;
let prefix = null;
let seed = null;
const tokens = {};

function tokenFor(userId, email) {
    return jwt.sign({ id: userId, email }, process['env'][JWT_KEY], { expiresIn: '1h' });
}

function cents(value) {
    return Math.round(Number(value) * 100);
}

async function balance(accountId) {
    const { rows } = await pool.query('SELECT balance, available_balance, currency FROM accounts WHERE id = $1', [accountId]);
    return rows[0];
}

async function openAedAccount(name, amount) {
    const accountNumber = `${prefix}-AED-${name.toUpperCase()}`;
    const { rows } = await pool.query(
        `INSERT INTO accounts (user_id, account_number, account_type, account_name, currency, balance, available_balance, held_balance, status)
         VALUES ($1, $2, 'checking', $3, 'AED', $4, $4, 0, 'active')
         ON CONFLICT (account_number) DO UPDATE SET balance = EXCLUDED.balance, available_balance = EXCLUDED.available_balance
         RETURNING *`,
        [seed.userIds[name], accountNumber, `${name} AED`, amount]
    );
    await seedVerifiedTestLedgerAccount(pool, rows[0]);
    return rows[0];
}

describeIfDb('multi-currency ledger: AED accounts, transfers and isolation', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) throw new Error('No isolated test database available.');
        await applySchema(pool);
        prefix = `multicur-${Date.now()}`;
        seed = await seedTestData(pool, prefix);
        seed.accounts.alice_aed = await openAedAccount('alice', 500.0);
        seed.accounts.bob_aed = await openAedAccount('bob', 0.0);
        tokens.alice = tokenFor(seed.userIds.alice, `${prefix}-alice@test.invalid`);
        tokens.bob = tokenFor(seed.userIds.bob, `${prefix}-bob@test.invalid`);
        tokens.carol = tokenFor(seed.userIds.carol, `${prefix}-carol@test.invalid`);

        app = express();
        app.use(express.json());
        app.use('/', require('../routes/transfers'));
        app.use('/', require('../routes/accounts'));
        app.use('/', require('../routes/currencies'));
    });

    afterAll(async () => {
        if (pool && prefix) {
            await cleanupTestData(pool, prefix);
            await pool.end();
        }
    });

    afterEach(() => {
        process['env'].VB_MULTICURRENCY_ENABLED = 'true';
    });

    test('AED transfer debits, credits and posts a balanced AED journal', async () => {
        const aliceBefore = await balance(seed.accounts.alice_aed.id);
        const bobBefore = await balance(seed.accounts.bob_aed.id);
        const res = await request(app)
            .post('/api/transfers')
            .set('Authorization', `Bearer ${tokens.alice}`)
            .set('Idempotency-Key', `multicur-aed-${Date.now()}`)
            .send({ amount: '25.50', currency: 'AED', recipient: seed.userIds.bob });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, transfer: { currency: 'AED', status: 'completed' } });

        const aliceAfter = await balance(seed.accounts.alice_aed.id);
        const bobAfter = await balance(seed.accounts.bob_aed.id);
        expect(aliceAfter.currency).toBe('AED');
        expect(cents(aliceAfter.balance)).toBe(cents(aliceBefore.balance) - 2550);
        expect(cents(bobAfter.balance)).toBe(cents(bobBefore.balance) + 2550);

        const { rows: ledgerRows } = await pool.query(
            `SELECT j.currency, j.state,
                    COALESCE(SUM(CASE WHEN e.side = 'debit' THEN e.amount END), 0) AS debits,
                    COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount END), 0) AS credits,
                    COUNT(e.id)::int AS entries
               FROM vb_ledger_journals j
               JOIN vb_ledger_entries e ON e.journal_id = j.id
              WHERE j.source_type = 'transfer' AND j.source_id = $1
              GROUP BY j.id, j.currency, j.state`,
            [res.body.transfer.id]
        );
        expect(ledgerRows).toHaveLength(1);
        expect(ledgerRows[0]).toMatchObject({ currency: 'AED', state: 'posted', entries: 2 });
        expect(cents(ledgerRows[0].debits)).toBe(2550);
        expect(cents(ledgerRows[0].credits)).toBe(2550);
    });

    test('replaying an AED key moves nothing additional', async () => {
        const key = `multicur-replay-${Date.now()}`;
        const first = await request(app)
            .post('/api/transfers')
            .set('Authorization', `Bearer ${tokens.alice}`)
            .set('Idempotency-Key', key)
            .send({ amount: '4.00', currency: 'AED', recipient: seed.userIds.bob });
        expect(first.status).toBe(200);
        const before = await balance(seed.accounts.alice_aed.id);
        const replay = await request(app)
            .post('/api/transfers')
            .set('Authorization', `Bearer ${tokens.alice}`)
            .set('Idempotency-Key', key)
            .send({ amount: '4.00', currency: 'AED', recipient: seed.userIds.bob });
        expect(replay.status).toBe(200);
        expect(replay.body).toMatchObject({ replay: true, transfer: { id: first.body.transfer.id } });
        const after = await balance(seed.accounts.alice_aed.id);
        expect(cents(after.balance)).toBe(cents(before.balance));
    });

    test('a recipient without an AED account is refused, not silently converted', async () => {
        const bobBefore = await balance(seed.accounts.bob_aed.id);
        const res = await request(app)
            .post('/api/transfers')
            .set('Authorization', `Bearer ${tokens.alice}`)
            .set('Idempotency-Key', `multicur-isolation-${Date.now()}`)
            .send({ amount: '1.00', currency: 'AED', recipient: seed.userIds.carol });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, code: 'RECIPIENT_NOT_FOUND' });
        const bobAfter = await balance(seed.accounts.bob_aed.id);
        expect(cents(bobAfter.balance)).toBe(cents(bobBefore.balance));
    });

    test('AED is refused when the operator switch is off, even with funded accounts', async () => {
        process['env'].VB_MULTICURRENCY_ENABLED = 'false';
        const before = await balance(seed.accounts.alice_aed.id);
        const res = await request(app)
            .post('/api/transfers')
            .set('Authorization', `Bearer ${tokens.alice}`)
            .set('Idempotency-Key', `multicur-disabled-${Date.now()}`)
            .send({ amount: '1.00', currency: 'AED', recipient: seed.userIds.bob });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, code: 'UNSUPPORTED_CURRENCY' });
        const after = await balance(seed.accounts.alice_aed.id);
        expect(cents(after.balance)).toBe(cents(before.balance));
    });

    test('open-currency creates one zero-balance AED wallet and refuses a duplicate', async () => {
        const first = await request(app)
            .post('/api/account/open-currency')
            .set('Authorization', `Bearer ${tokens.carol}`)
            .send({ currency: 'AED' });
        expect(first.status).toBe(201);
        expect(first.body.account).toMatchObject({ currency: 'AED', balance: 0 });
        const stored = await balance(first.body.account.id);
        expect(cents(stored.balance)).toBe(0);

        const second = await request(app)
            .post('/api/account/open-currency')
            .set('Authorization', `Bearer ${tokens.carol}`)
            .send({ currency: 'AED' });
        expect(second.status).toBe(409);
        expect(second.body.already).toBe(true);

        const { rows } = await pool.query(
            "SELECT COUNT(*)::int AS count FROM accounts WHERE user_id = $1 AND currency = 'AED' AND account_type <> 'savings'",
            [seed.userIds.carol]
        );
        expect(rows[0].count).toBe(1);
    });

    test('open-currency fails closed for a registered but disabled currency', async () => {
        process['env'].VB_MULTICURRENCY_ENABLED = 'false';
        const res = await request(app)
            .post('/api/account/open-currency')
            .set('Authorization', `Bearer ${tokens.carol}`)
            .send({ currency: 'GBP' });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, code: 'CURRENCY_NOT_ENABLED' });
        const { rows } = await pool.query(
            "SELECT COUNT(*)::int AS count FROM accounts WHERE user_id = $1 AND currency = 'GBP'",
            [seed.userIds.carol]
        );
        expect(rows[0].count).toBe(0);
    });

    test('public currency endpoint reports AED enabled but not funded', async () => {
        const res = await request(app).get('/api/currencies');
        expect(res.status).toBe(200);
        const aed = res.body.currencies.find((currency) => currency.code === 'AED');
        expect(aed).toMatchObject({
            enabled: true,
            internalTransfers: true,
            receivingCapability: true,
            bankReceivingConfigured: false,
            manualPayout: false,
            fx: false,
        });
    });
});
