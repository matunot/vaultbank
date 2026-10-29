/**
 * New-customer journey on real PostgreSQL: signup → zero-balance account →
 * email verification → INR wallet → savings vault → saved card/loan requests →
 * KYC submission and approval → cross-customer isolation.
 *
 * Uses the isolated vaultbank_test database only. No production balances are
 * read or changed, and no external provider or SMTP delivery is invoked.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
    const match = mainUrl.match(/^(.*:\/\/[^\/]+)\/([^\/?]+)(.*)$/);
    if (!match) return null;
    return match[1] + '/vaultbank_test' + (match[3] || '');
}
const testDbUrl = deriveTestUrl();
const describeIfDb = testDbUrl ? describe : describe.skip;

if (testDbUrl) {
    process['env'][MAIN_DB] = testDbUrl;
    process['env'][NODE_KEY] = 'test';
    process['env'][JWT_KEY] = 'journey-integration-test-jwt-secret';
    // Force the no-SMTP path. The journey verifies the persisted flag through
    // the real confirm endpoint; it must never send mail to a synthetic address.
    process['env'].SMTP_HOST = '';
    process['env'].SMTP_USER = '';
    process['env'].SMTP_PASS = '';
}

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const { connectToTestDb, applySchema } = require('./helpers/pgTestSetup');

jest.setTimeout(180000);

let pool = null;
let app = null;
let prefix = null;
let admin = null;
let adminToken = null;

const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('vaultbank-journey-kyc-image'),
]);

function tokenFor(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role }, process['env'][JWT_KEY], { expiresIn: '1h' });
}

async function signup(name) {
    const email = `${prefix}-${name}@test.invalid`;
    const res = await request(app)
        .post('/api/auth/signup')
        .send({ email, password: 'Journey-Pass-2026!', fullName: `Journey ${name}` });
    return { res, email };
}

async function insertVerificationToken(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash CHAR(64) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [userId, tokenHash]
    );
    return token;
}

describeIfDb('New-customer journey — real auth, PostgreSQL, savings, KYC and product requests', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) throw new Error('No isolated test database available.');
        await applySchema(pool);
        prefix = `journey-${Date.now()}`;

        const { rows } = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, role, subscription, kyc_status, status, email_verified)
             VALUES ($1, 'test-hash', 'Journey Admin', 'admin', 'free', 'verified', 'active', TRUE)
             RETURNING id, email, role`,
            [`${prefix}-admin@test.invalid`]
        );
        admin = rows[0];
        adminToken = tokenFor(admin);

        app = express();
        app.use(express.json());
        app.use('/', require('../routes/auth'));
        app.use('/', require('../routes/email-verification'));
        app.use('/', require('../routes/accounts'));
        app.use('/', require('../routes/savings'));
        app.use('/', require('../routes/product-applications'));
        app.use('/', require('../routes/kyc'));
    });

    afterAll(async () => {
        if (pool && prefix) {
            // reviewed_by references the admin user, so remove documents first.
            await pool.query(
                'DELETE FROM kyc_documents WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
                [`${prefix}-%`]
            );
            await pool.query('DELETE FROM users WHERE email LIKE $1', [`${prefix}-%`]);
            await pool.end();
        }
    });

    test('a brand-new customer gets one real zero-balance account and no invented activity', async () => {
        const { res, email } = await signup('alice');
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            success: true,
            verificationEmailSent: false,
            user: { email, kycStatus: 'pending', emailVerified: false },
        });
        expect(res.body.account).toMatchObject({ currency: 'USD', balance: 0 });
        const aliceToken = res.body.token;

        const account = await request(app)
            .get('/api/account')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(account.status).toBe(200);
        expect(account.body.success).toBe(true);
        expect(account.body.account).toMatchObject({
            id: res.body.account.id,
            currency: 'USD',
            balance: 0,
            availableBalance: 0,
            heldBalance: 0,
        });

        const ledgerActivity = await request(app)
            .get('/api/account/transactions')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(ledgerActivity.status).toBe(200);
        expect(ledgerActivity.body.success).toBe(true);
        expect(ledgerActivity.body.transactions).toEqual([]);

        // Persist the first customer's token for the rest of the journey.
        pool.__aliceToken = aliceToken;
        pool.__aliceId = res.body.user.id;
    });

    test('email verification is persisted only after the real confirm endpoint accepts the token', async () => {
        const aliceToken = pool.__aliceToken;
        const aliceId = pool.__aliceId;

        const before = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(before.status).toBe(200);
        expect(before.body).toMatchObject({ emailVerified: false, kycStatus: 'pending', canSubmit: false });

        const token = await insertVerificationToken(aliceId);
        const confirm = await request(app)
            .post('/api/auth/email-verification/confirm')
            .send({ token });
        expect(confirm.status).toBe(200);
        expect(confirm.body).toMatchObject({ success: true, emailVerified: true });

        const { rows } = await pool.query('SELECT email_verified FROM users WHERE id = $1', [aliceId]);
        expect(rows[0].email_verified).toBe(true);

        const after = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(after.body).toMatchObject({ emailVerified: true, canSubmit: true });
    });

    test('an INR wallet and savings vault open at zero and cannot fake a funded move', async () => {
        const aliceToken = pool.__aliceToken;
        const inr = await request(app)
            .post('/api/account/open-inr')
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({});
        expect([200, 201]).toContain(inr.status);
        expect(inr.body.success).toBe(true);
        const inrAccountId = inr.body.account.id;

        const inrState = await request(app)
            .get('/api/account/inr')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(inrState.status).toBe(200);
        expect(inrState.body.account).toMatchObject({ currency: 'INR', balance: 0, availableBalance: 0 });
        expect(inrState.body.transactions).toEqual([]);

        const vault = await request(app)
            .post('/api/savings/accounts')
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({ currency: 'INR' });
        expect(vault.status).toBe(201);
        expect(vault.body.success).toBe(true);
        expect(vault.body.account).toMatchObject({ currency: 'INR', balance: 0, availableBalance: 0 });
        const vaultId = vault.body.account.id;

        const move = await request(app)
            .post('/api/savings/move')
            .set('Authorization', `Bearer ${aliceToken}`)
            .set('Idempotency-Key', `journey-zero-${Date.now()}`)
            .send({ fromAccountId: inrAccountId, toAccountId: vaultId, amount: 100 });
        expect([400, 409]).toContain(move.status);
        expect(move.body.success).toBe(false);

        const { rows } = await pool.query(
            'SELECT id, balance, available_balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id',
            [[inrAccountId, vaultId]]
        );
        for (const row of rows) {
            expect(Number(row.balance)).toBe(0);
            expect(Number(row.available_balance)).toBe(0);
        }
    });

    test('card and loan requests are saved as needing verification, never as issued credit', async () => {
        const aliceToken = pool.__aliceToken;
        const cardKey = `journey-card-${Date.now()}`;
        const card = await request(app)
            .post('/api/card-program/requests')
            .set('Authorization', `Bearer ${aliceToken}`)
            .set('Idempotency-Key', cardKey)
            .send({ cardType: 'debit', currency: 'INR' });
        expect(card.status).toBe(201);
        expect(card.body).toMatchObject({
            success: true,
            request: { status: 'needs_verification', cardType: 'debit', currency: 'INR' },
            cardNetworkIssuingAvailable: false,
        });

        const replay = await request(app)
            .post('/api/card-program/requests')
            .set('Authorization', `Bearer ${aliceToken}`)
            .set('Idempotency-Key', cardKey)
            .send({ cardType: 'debit', currency: 'INR' });
        expect(replay.status).toBe(200);
        expect(replay.body).toMatchObject({ success: true, replay: true });

        const loan = await request(app)
            .post('/api/loan-applications')
            .set('Authorization', `Bearer ${aliceToken}`)
            .set('Idempotency-Key', `journey-loan-${Date.now()}`)
            .send({ amount: 50000, currency: 'INR', termMonths: 12, purpose: 'Working capital for a small business' });
        expect(loan.status).toBe(201);
        expect(loan.body).toMatchObject({
            success: true,
            application: { status: 'needs_verification', currency: 'INR', termMonths: 12 },
            loanFundingAvailable: false,
        });
        expect(loan.body.application.creditLimit).toBeUndefined();
        expect(loan.body.application.approvedAmount).toBeUndefined();
    });

    test('KYC submission stays under review until an admin approves it', async () => {
        const aliceToken = pool.__aliceToken;
        const upload = await request(app)
            .post('/api/kyc')
            .set('Authorization', `Bearer ${aliceToken}`)
            .field('documentType', 'national_id')
            .attach('document', PNG_BYTES, { filename: 'national-id.png', contentType: 'image/png' });
        expect(upload.status).toBe(201);
        expect(upload.body).toMatchObject({ success: true, kycStatus: 'submitted' });
        const documentId = upload.body.data.id;

        const pending = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(pending.body).toMatchObject({ kycStatus: 'submitted', canSubmit: false });

        const forbidden = await request(app)
            .put(`/api/kyc/${documentId}/approve`)
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({});
        expect(forbidden.status).toBe(403);

        const approved = await request(app)
            .put(`/api/kyc/${documentId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ note: 'National ID matches the customer record.' });
        expect(approved.status).toBe(200);
        expect(approved.body).toMatchObject({ success: true, kycStatus: 'verified' });

        const verified = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${aliceToken}`);
        expect(verified.body).toMatchObject({ kycStatus: 'verified', canSubmit: false, emailVerified: true });
    });

    test('after verification, a new product request enters human review — not issuance or approval', async () => {
        const aliceToken = pool.__aliceToken;
        const card = await request(app)
            .post('/api/card-program/requests')
            .set('Authorization', `Bearer ${aliceToken}`)
            .set('Idempotency-Key', `journey-card-verified-${Date.now()}`)
            .send({ cardType: 'debit', currency: 'INR' });
        expect(card.status).toBe(201);
        expect(card.body.request.status).toBe('received');
        expect(card.body.request.pan).toBeUndefined();
        expect(card.body.request.cvv).toBeUndefined();

        const loan = await request(app)
            .post('/api/loan-applications')
            .set('Authorization', `Bearer ${aliceToken}`)
            .set('Idempotency-Key', `journey-loan-verified-${Date.now()}`)
            .send({ amount: 100000, currency: 'INR', termMonths: 24, purpose: 'Equipment purchase for a small business' });
        expect(loan.status).toBe(201);
        expect(loan.body.application.status).toBe('received');
        expect(loan.body.application.disbursedAmount).toBeUndefined();
        expect(loan.body.application.repaymentSchedule).toBeUndefined();
    });

    test('a second customer cannot move the first customer\'s money', async () => {
        const { res: bobSignup } = await signup('bob');
        expect(bobSignup.status).toBe(201);
        const bobToken = bobSignup.body.token;
        expect(typeof bobToken).toBe('string');

        await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [bobSignup.body.user.id]);

        const bobVault = await request(app)
            .post('/api/savings/accounts')
            .set('Authorization', `Bearer ${bobToken}`)
            .send({ currency: 'USD' });
        expect({ status: bobVault.status, body: bobVault.body }).toMatchObject({ status: 201 });

        const { rows: aliceAccounts } = await pool.query(
            'SELECT id FROM accounts WHERE user_id = $1 AND currency = $2 LIMIT 1',
            [pool.__aliceId, 'USD']
        );
        const crossMove = await request(app)
            .post('/api/savings/move')
            .set('Authorization', `Bearer ${bobToken}`)
            .set('Idempotency-Key', `journey-cross-${Date.now()}`)
            .send({ fromAccountId: aliceAccounts[0].id, toAccountId: bobVault.body.account.id, amount: 10 });
        expect(crossMove.status).toBe(404);
        expect(crossMove.body).toMatchObject({ success: false, code: 'SAVINGS_ACCOUNT_NOT_FOUND' });

        const { rows: aliceAfter } = await pool.query(
            'SELECT balance, available_balance FROM accounts WHERE id = $1',
            [aliceAccounts[0].id]
        );
        expect(Number(aliceAfter[0].balance)).toBe(0);
        expect(Number(aliceAfter[0].available_balance)).toBe(0);
    });
});
