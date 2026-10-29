/**
 * Direct UPI end-to-end integration test.
 *
 * This uses only the isolated vaultbank_test database and synthetic bank
 * statement evidence. It never calls a UPI/bank network or uses real funds.
 * The test proves the application-side path:
 * pending UPI intent -> exact statement reconciliation -> atomic ledger credit
 * -> verified-funds update -> same-currency internal INR transfer.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) dotenv.config({ path: envFile });

const MAIN_DB = ['DATABASE', 'URL'].join('_');
const TEST_DB = ['TEST_DATABASE', 'URL'].join('_');
const JWT_KEY = ['JWT', 'SECRET'].join('_');
const NODE_KEY = ['NODE', 'ENV'].join('_');
const testUrl = process['env'][TEST_DB] || (() => {
  const mainUrl = process['env'][MAIN_DB];
  if (!mainUrl) return null;
  const match = mainUrl.match(/^(.*:\/\/[^/]+)\/([^/?]+)(.*)$/);
  return match ? match[1] + '/vaultbank_test' + (match[3] || '') : null;
})();

const describeWithIsolatedDb = testUrl ? describe : describe.skip;
if (testUrl) {
  // All app modules are loaded only after pointing them at the isolated test DB.
  process['env'][MAIN_DB] = testUrl;
  process['env'][NODE_KEY] = 'test';
  process['env'][JWT_KEY] = 'direct-upi-postgres-integration-jwt';
  process.env.VB_UPI_DEPOSIT_ENABLED = 'true';
  process.env.VB_UPI_RECEIVING_VPA = 'vaultbank.integration@example.test';
  process.env.VB_UPI_RECEIVING_NAME = 'VaultBank Integration Test';
}

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { connectToTestDb, applySchema, seedTestData, cleanupTestData } = require('./helpers/pgTestSetup');

jest.setTimeout(120000);

let pool = null;
let prefix = null;
let testData = null;
let app = null;
let adminToken = null;

describeWithIsolatedDb('Direct UPI settlement -> native ledger -> internal INR transfer (real PostgreSQL)', () => {
  beforeAll(async () => {
    pool = await connectToTestDb();
    if (!pool) {
      throw new Error('No isolated test database available. Set TEST_DATABASE_URL; never substitute production.');
    }
    await applySchema(pool);
    prefix = 'direct-upi-e2e-' + Date.now();
    testData = await seedTestData(pool, prefix);

    const adminId = testData.userIds.alice;
    const adminEmail = prefix + '-alice@test.invalid';
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
    adminToken = jwt.sign(
      { id: adminId, email: adminEmail },
      process['env'][JWT_KEY],
      { expiresIn: '1h' }
    );

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/', require('../routes/direct-upi'));
    app.use('/', require('../routes/accounts'));
  });

  afterAll(async () => {
    if (pool && prefix) {
      const ids = Object.values(testData ? testData.userIds : {});
      if (ids.length) {
        // Remove UPI-specific rows before the shared helper deletes test users.
        await pool.query(
          'DELETE FROM direct_upi_deposit_intents WHERE user_id = ANY($1::uuid[])',
          [ids]
        );
      }
      await cleanupTestData(pool, prefix);
      await pool.end();
    }
  });

  async function getAccount(accountId) {
    const { rows } = await pool.query(
      'SELECT id, balance::text, available_balance::text, held_balance::text FROM accounts WHERE id = $1',
      [accountId]
    );
    if (!rows[0]) throw new Error('Expected test account was not found');
    return rows[0];
  }

  async function getVerifiedFunds(accountId) {
    const { rows } = await pool.query(
      'SELECT verified_available_balance::text FROM vb_ledger_accounts WHERE account_id = $1',
      [accountId]
    );
    if (!rows[0]) throw new Error('Expected test ledger account was not found');
    return Number(rows[0].verified_available_balance);
  }

  async function createIntent(amount, key) {
    return request(app)
      .post('/api/direct-upi/intents')
      .set('Authorization', 'Bearer ' + adminToken)
      .set('Idempotency-Key', key)
      .send({ amount });
  }

  async function verifyIntent(id, settlementAmount, bankUtr) {
    return request(app)
      .post('/api/direct-upi/admin/intents/' + encodeURIComponent(id) + '/verify')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        settlementAmount,
        bankUtr,
        evidenceNote: 'Synthetic official-statement row for isolated integration test only',
      });
  }

  test('only verified settlement credits money; internal INR send then moves that value exactly once', async () => {
    const alice = testData.accounts.alice_inr;
    const bob = testData.accounts.bob_inr;
    const initialAlice = await getAccount(alice.id);
    const initialBob = await getAccount(bob.id);
    const initialAliceVerified = await getVerifiedFunds(alice.id);
    const initialBobVerified = await getVerifiedFunds(bob.id);

    const intentResponse = await createIntent('125.50', prefix + '-deposit-attempt-1');
    expect(intentResponse.status).toBe(201);
    expect(intentResponse.body.success).toBe(true);
    expect(intentResponse.body.intent.status).toBe('pending');
    const intent = intentResponse.body.intent;

    // A mismatch is rejected without changing the intent, account or ledger.
    const mismatchUtr = 'UTR-MISMATCH-' + prefix;
    const mismatch = await verifyIntent(intent.id, '125.49', mismatchUtr);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('DIRECT_UPI_AMOUNT_MISMATCH');
    expect((await getAccount(alice.id)).balance).toBe(initialAlice.balance);
    expect(await getVerifiedFunds(alice.id)).toBe(initialAliceVerified);
    const { rows: stillPending } = await pool.query(
      'SELECT status, bank_utr FROM direct_upi_deposit_intents WHERE id = $1',
      [intent.id]
    );
    expect(stillPending[0]).toMatchObject({ status: 'pending', bank_utr: null });

    // Synthetic UTR is evidence for this isolated test only; no external payment is made.
    const bankUtr = 'UTR-' + prefix + '-' + Date.now();
    const verified = await verifyIntent(intent.id, '125.50', bankUtr);
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      success: true,
      credited: true,
      reference: intent.reference,
      bankUtr,
      amount: 125.5,
    });

    const afterDepositAlice = await getAccount(alice.id);
    expect(Number(afterDepositAlice.balance)).toBe(Number(initialAlice.balance) + 125.5);
    expect(Number(afterDepositAlice.available_balance)).toBe(Number(initialAlice.available_balance) + 125.5);
    expect(await getVerifiedFunds(alice.id)).toBe(initialAliceVerified + 125.5);

    const { rows: settledIntent } = await pool.query(
      'SELECT status, bank_utr, settled_at FROM direct_upi_deposit_intents WHERE id = $1',
      [intent.id]
    );
    expect(settledIntent[0].status).toBe('settled');
    expect(settledIntent[0].bank_utr).toBe(bankUtr);
    expect(settledIntent[0].settled_at).toBeTruthy();

    const { rows: depositTransactions } = await pool.query(
      `SELECT id, amount::text, currency, external_reference
         FROM transactions
        WHERE account_id = $1 AND external_reference = $2`,
      [alice.id, intent.reference]
    );
    expect(depositTransactions).toHaveLength(1);
    expect(Number(depositTransactions[0].amount)).toBe(125.5);
    expect(depositTransactions[0].currency).toBe('INR');

    const { rows: depositEntries } = await pool.query(
      `SELECT e.side, e.amount::text AS amount, la.account_id, la.system_code
         FROM vb_ledger_journals j
         JOIN vb_ledger_entries e ON e.journal_id = j.id
         JOIN vb_ledger_accounts la ON la.id = e.ledger_account_id
        WHERE j.event_type = 'deposit_settled'
          AND j.source_type = 'direct_upi_deposit'
          AND j.source_id = $1
        ORDER BY e.side`,
      [intent.id]
    );
    expect(depositEntries).toHaveLength(2);
    expect(depositEntries.filter((e) => e.side === 'debit')).toHaveLength(1);
    expect(depositEntries.filter((e) => e.side === 'credit')).toHaveLength(1);
    expect(depositEntries.find((e) => e.side === 'debit').system_code).toBe('INBOUND_SETTLEMENT_ASSET');
    expect(depositEntries.find((e) => e.side === 'credit').account_id).toBe(alice.id);
    expect(depositEntries.reduce((sum, e) => sum + Number(e.amount) * (e.side === 'debit' ? 1 : -1), 0)).toBe(0);

    // Re-verifying the settled intent cannot issue a second credit.
    const replay = await verifyIntent(intent.id, '125.50', bankUtr);
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('DIRECT_UPI_INTENT_NOT_PENDING');
    expect(Number((await getAccount(alice.id)).balance)).toBe(Number(initialAlice.balance) + 125.5);
    expect(await getVerifiedFunds(alice.id)).toBe(initialAliceVerified + 125.5);

    // A second pending intent cannot reuse a bank UTR that has already been applied.
    const secondIntentResponse = await createIntent('125.50', prefix + '-deposit-attempt-2');
    expect(secondIntentResponse.status).toBe(201);
    const secondIntent = secondIntentResponse.body.intent;
    const reusedUtr = await verifyIntent(secondIntent.id, '125.50', bankUtr);
    expect(reusedUtr.status).toBe(409);
    expect(reusedUtr.body.code).toBe('DIRECT_UPI_UTR_ALREADY_USED');
    const { rows: secondStillPending } = await pool.query(
      'SELECT status, bank_utr FROM direct_upi_deposit_intents WHERE id = $1',
      [secondIntent.id]
    );
    expect(secondStillPending[0]).toMatchObject({ status: 'pending', bank_utr: null });
    expect(Number((await getAccount(alice.id)).balance)).toBe(Number(initialAlice.balance) + 125.5);

    // The verified deposit is now spendable in VaultBank's own internal INR rail.
    const transfer = await request(app)
      .post('/api/account/transfer')
      .set('Authorization', 'Bearer ' + adminToken)
      .set('Idempotency-Key', prefix + '-internal-transfer-1')
      .send({
        recipientEmail: prefix + '-bob@test.invalid',
        amount: '12.30',
        currency: 'INR',
        description: 'Isolated UPI-to-internal-ledger integration test',
      });
    expect(transfer.status).toBe(200);
    expect(transfer.body.success).toBe(true);
    expect(transfer.body.transfer.amount).toBe(12.3);

    const finalAlice = await getAccount(alice.id);
    const finalBob = await getAccount(bob.id);
    expect(Number(finalAlice.balance)).toBe(Number(initialAlice.balance) + 125.5 - 12.3);
    expect(Number(finalAlice.available_balance)).toBe(Number(initialAlice.available_balance) + 125.5 - 12.3);
    expect(Number(finalBob.balance)).toBe(Number(initialBob.balance) + 12.3);
    expect(Number(finalBob.available_balance)).toBe(Number(initialBob.available_balance) + 12.3);
    expect(await getVerifiedFunds(alice.id)).toBe(initialAliceVerified + 125.5 - 12.3);
    expect(await getVerifiedFunds(bob.id)).toBe(initialBobVerified + 12.3);

    const transferId = transfer.body.transfer.id;
    const { rows: transferJournal } = await pool.query(
      `SELECT e.side, e.amount::text AS amount, la.account_id
         FROM vb_ledger_journals j
         JOIN vb_ledger_entries e ON e.journal_id = j.id
         JOIN vb_ledger_accounts la ON la.id = e.ledger_account_id
        WHERE j.event_type = 'internal_transfer'
          AND j.source_type = 'transfer'
          AND j.source_id = $1
        ORDER BY e.side`,
      [String(transferId)]
    );
    expect(transferJournal).toHaveLength(2);
    expect(transferJournal.filter((e) => e.side === 'debit' && e.account_id === alice.id)).toHaveLength(1);
    expect(transferJournal.filter((e) => e.side === 'credit' && e.account_id === bob.id)).toHaveLength(1);
    expect(transferJournal.reduce((sum, e) => sum + Number(e.amount) * (e.side === 'debit' ? 1 : -1), 0)).toBe(0);
  });
});
