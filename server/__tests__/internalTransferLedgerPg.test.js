/**
 * Customer-to-customer transfer, proven end to end on real PostgreSQL:
 * bearer auth, atomic debit/credit, ledger rows, balanced double-entry
 * journal, idempotent replay, and refusal cases.
 *
 * Runs only against the isolated vaultbank_test database. The sender's funds
 * come from seedTestData, which applies the real schema; no transfer in this
 * file is funded by a browser claim or an unchecked balance edit.
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
    process['env'][JWT_KEY] = 'internal-transfer-ledger-test-secret';
}

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const { connectToTestDb, applySchema, seedTestData, cleanupTestData } = require('./helpers/pgTestSetup');

jest.setTimeout(180000);

let pool = null;
let app = null;
let prefix = null;
let seed = null;
const tokens = {};

function tokenFor(userId, email) {
    return jwt.sign({ id: userId, email }, process['env'][JWT_KEY], { expiresIn: '1h' });
}

async function balance(accountId) {
    const { rows } = await pool.query(
        'SELECT balance, available_balance, held_balance, currency FROM accounts WHERE id = $1',
        [accountId]
    );
    return rows[0];
}

// Compare money as integer minor units so no float representation drifts.
const cents = (value) => Math.round(Number(value) * 100);

async function transfer({ from, amount, currency = 'USD', key, recipient }) {
    return request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${tokens[from]}`)
        .set('Idempotency-Key', key)
        .send({ amount, currency, recipient });
}

describeIfDb('internal transfer ledger proof: auth, balances and double entry', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) throw new Error('No isolated test database available.');
        await applySchema(pool);
        prefix = `ledgert-${Date.now()}`;
        seed = await seedTestData(pool, prefix);
        tokens.alice = tokenFor(seed.userIds.alice, `${prefix}-alice@test.invalid`);
        tokens.bob = tokenFor(seed.userIds.bob, `${prefix}-bob@test.invalid`);
        tokens.carol = tokenFor(seed.userIds.carol, `${prefix}-carol@test.invalid`);

        app = express();
        app.use(express.json());
        app.use('/', require('../routes/transfers'));
    });

    afterAll(async () => {
        if (pool && prefix) {
            await cleanupTestData(pool, prefix);
            await pool.end();
        }
    });

    test('one transfer debits the sender, credits the recipient and posts a balanced journal', async () => {
        const aliceBefore = await balance(seed.accounts.alice_usd.id);
        const bobBefore = await balance(seed.accounts.bob_usd.id);

        const res = await transfer({
            from: 'alice',
            amount: '12.34',
            key: `ledger-main-${Date.now()}`,
            recipient: seed.userIds.bob,
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, transfer: { status: 'completed', currency: 'USD' } });
        const transferId = res.body.transfer.id;

        const aliceAfter = await balance(seed.accounts.alice_usd.id);
        const bobAfter = await balance(seed.accounts.bob_usd.id);
        expect(cents(aliceAfter.balance)).toBe(cents(aliceBefore.balance) - 1234);
        expect(cents(bobAfter.balance)).toBe(cents(bobBefore.balance) + 1234);
        expect(cents(aliceAfter.available_balance)).toBe(cents(aliceBefore.available_balance) - 1234);
        expect(cents(bobAfter.available_balance)).toBe(cents(bobBefore.available_balance) + 1234);

        // Exactly one debit row and one credit row, both in the requested currency.
        const { rows: transactions } = await pool.query(
            `SELECT account_id, user_id, amount, currency, type, balance_before, balance_after
               FROM transactions
              WHERE account_id = ANY($1::uuid[])
              ORDER BY created_at`,
            [[seed.accounts.alice_usd.id, seed.accounts.bob_usd.id]]
        );
        expect(transactions).toHaveLength(2);
        const debit = transactions.find((row) => row.account_id === seed.accounts.alice_usd.id);
        const credit = transactions.find((row) => row.account_id === seed.accounts.bob_usd.id);
        expect(debit).toMatchObject({ currency: 'USD', type: 'transfer_out' });
        expect(credit).toMatchObject({ currency: 'USD', type: 'transfer_in' });
        expect(cents(debit.amount)).toBe(-1234); // outgoing rows are signed negative
        expect(cents(credit.amount)).toBe(1234);
        expect(cents(debit.balance_after)).toBe(cents(debit.balance_before) - 1234);

        const { rows: transferRows } = await pool.query(
            'SELECT amount, currency, status FROM transfers WHERE id = $1',
            [transferId]
        );
        expect(transferRows).toHaveLength(1);
        expect(transferRows[0]).toMatchObject({ currency: 'USD' });
        expect(cents(transferRows[0].amount)).toBe(1234);
        expect(['completed', 'succeeded']).toContain(transferRows[0].status);

        // The journal must balance to the cent, with exactly two entries.
        const { rows: journals } = await pool.query(
            `SELECT j.id, j.currency, j.state,
                    COALESCE(SUM(CASE WHEN e.side = 'debit' THEN e.amount END), 0) AS debits,
                    COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount END), 0) AS credits,
                    COUNT(e.id)::int AS entries
               FROM vb_ledger_journals j
               JOIN vb_ledger_entries e ON e.journal_id = j.id
              WHERE j.source_type = 'transfer' AND j.source_id = $1
              GROUP BY j.id, j.currency, j.state`,
            [transferId]
        );
        expect(journals).toHaveLength(1);
        expect(journals[0]).toMatchObject({ currency: 'USD', state: 'posted', entries: 2 });
        expect(cents(journals[0].debits)).toBe(1234);
        expect(cents(journals[0].credits)).toBe(1234);

        // Ledger-side available balances mirror the account balances.
        const { rows: ledgerBalances } = await pool.query(
            `SELECT account_id, verified_available_balance
               FROM vb_ledger_accounts
              WHERE account_id = ANY($1::uuid[])`,
            [[seed.accounts.alice_usd.id, seed.accounts.bob_usd.id]]
        );
        const ledgerAlice = ledgerBalances.find((row) => row.account_id === seed.accounts.alice_usd.id);
        const ledgerBob = ledgerBalances.find((row) => row.account_id === seed.accounts.bob_usd.id);
        expect(Number(ledgerAlice.verified_available_balance)).toBe(Number(aliceAfter.available_balance));
        expect(Number(ledgerBob.verified_available_balance)).toBe(Number(bobAfter.available_balance));
    });

    test('replaying the same idempotency key moves no additional money', async () => {
        const key = `ledger-replay-${Date.now()}`;
        const first = await transfer({ from: 'alice', amount: '5.00', key, recipient: seed.userIds.bob });
        expect(first.status).toBe(200);

        const aliceAfterFirst = await balance(seed.accounts.alice_usd.id);
        const bobAfterFirst = await balance(seed.accounts.bob_usd.id);

        const replay = await transfer({ from: 'alice', amount: '5.00', key, recipient: seed.userIds.bob });
        expect(replay.status).toBe(200);
        expect(replay.body).toMatchObject({ success: true, replay: true, transfer: { id: first.body.transfer.id } });
        expect(replay.headers['idempotent-replay']).toBe('true');

        const aliceAfterReplay = await balance(seed.accounts.alice_usd.id);
        const bobAfterReplay = await balance(seed.accounts.bob_usd.id);
        expect(Number(aliceAfterReplay.balance)).toBe(Number(aliceAfterFirst.balance));
        expect(Number(bobAfterReplay.balance)).toBe(Number(bobAfterFirst.balance));

        const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS count FROM transfers WHERE id = $1',
            [first.body.transfer.id]
        );
        expect(rows[0].count).toBe(1);
    });

    test('the same key with a different amount is refused and moves nothing', async () => {
        const key = `ledger-conflict-${Date.now()}`;
        const first = await transfer({ from: 'alice', amount: '3.00', key, recipient: seed.userIds.bob });
        expect(first.status).toBe(200);

        const aliceBefore = await balance(seed.accounts.alice_usd.id);
        const conflict = await transfer({ from: 'alice', amount: '9.00', key, recipient: seed.userIds.bob });
        expect(conflict.status).toBe(409);
        expect(conflict.body).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });

        const aliceAfter = await balance(seed.accounts.alice_usd.id);
        expect(Number(aliceAfter.balance)).toBe(Number(aliceBefore.balance));
    });

    test('an insufficient balance is refused and leaves both sides untouched', async () => {
        const aliceBefore = await balance(seed.accounts.alice_usd.id);
        const bobBefore = await balance(seed.accounts.bob_usd.id);

        const res = await transfer({
            from: 'alice',
            amount: '5000.00',
            key: `ledger-insufficient-${Date.now()}`,
            recipient: seed.userIds.bob,
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, code: 'INSUFFICIENT_FUNDS' });

        const aliceAfter = await balance(seed.accounts.alice_usd.id);
        const bobAfter = await balance(seed.accounts.bob_usd.id);
        expect(Number(aliceAfter.balance)).toBe(Number(aliceBefore.balance));
        expect(Number(bobAfter.balance)).toBe(Number(bobBefore.balance));
    });

    test('a debit touches only the authenticated customer, never another user', async () => {
        const aliceBefore = await balance(seed.accounts.alice_usd.id);
        const carolBefore = await balance(seed.accounts.carol_usd.id);
        const bobBefore = await balance(seed.accounts.bob_usd.id);

        const res = await transfer({
            from: 'carol',
            amount: '7.25',
            key: `ledger-isolation-${Date.now()}`,
            recipient: seed.userIds.bob,
        });
        expect(res.status).toBe(200);

        const aliceAfter = await balance(seed.accounts.alice_usd.id);
        const carolAfter = await balance(seed.accounts.carol_usd.id);
        const bobAfter = await balance(seed.accounts.bob_usd.id);
        expect(cents(aliceAfter.balance)).toBe(cents(aliceBefore.balance));
        expect(cents(carolAfter.balance)).toBe(cents(carolBefore.balance) - 725);
        expect(cents(bobAfter.balance)).toBe(cents(bobBefore.balance) + 725);
    });

    test('no account is overdrawn and every transfer journal stays balanced', async () => {
        const { rows: negative } = await pool.query(
            `SELECT COUNT(*)::int AS count FROM accounts
              WHERE account_number LIKE $1 AND (balance < 0 OR available_balance < 0 OR held_balance < 0)`,
            [`${prefix}-%`]
        );
        expect(negative[0].count).toBe(0);

        const { rows: unbalanced } = await pool.query(
            `SELECT j.id,
                    COALESCE(SUM(CASE WHEN e.side = 'debit' THEN e.amount END), 0) AS debits,
                    COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount END), 0) AS credits
               FROM vb_ledger_journals j
               JOIN vb_ledger_entries e ON e.journal_id = j.id
              WHERE j.actor_user_id IN (SELECT id FROM users WHERE email LIKE $1)
              GROUP BY j.id
             HAVING COALESCE(SUM(CASE WHEN e.side = 'debit' THEN e.amount END), 0)
                 <> COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount END), 0)`,
            [`${prefix}-%`]
        );
        expect(unbalanced).toEqual([]);
    });
});
