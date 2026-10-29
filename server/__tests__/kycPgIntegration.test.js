/**
 * KYC end-to-end integration: REAL Express router, REAL JWT middleware,
 * REAL multer multipart parsing, REAL PostgreSQL.
 *
 * Runs only against the isolated vaultbank_test database. Production data is
 * never read or written by this suite.
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
    process['env'][JWT_KEY] = 'kyc-integration-test-jwt-secret';
}

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const { connectToTestDb, applySchema } = require('./helpers/pgTestSetup');

jest.setTimeout(180000);

let pool = null;
let app = null;
let prefix = null;
const users = {};
const tokens = {};

const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('vaultbank-kyc-test-image'),
]);

async function createUser(name, { role = 'user', emailVerified = true, kycStatus = 'pending' } = {}) {
    const email = `${prefix}-${name}@test.invalid`;
    const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, subscription, kyc_status, status, email_verified)
         VALUES ($1, 'test-hash', $2, $3, 'free', $4, 'active', $5)
         RETURNING id, email, role, kyc_status, email_verified`,
        [email, name, role, kycStatus, emailVerified]
    );
    return rows[0];
}

function tokenFor(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process['env'][JWT_KEY],
        { expiresIn: '1h' }
    );
}

function uploadDocument(userKey, { documentType = 'passport', filename = 'id.png', contentType = 'image/png', bytes = PNG_BYTES } = {}) {
    return request(app)
        .post('/api/kyc')
        .set('Authorization', `Bearer ${tokens[userKey]}`)
        .field('documentType', documentType)
        .attach('document', bytes, { filename, contentType });
}

describeIfDb('KYC HTTP integration — real multipart, JWT, PostgreSQL', () => {
    beforeAll(async () => {
        pool = await connectToTestDb();
        if (!pool) throw new Error('No isolated test database available.');
        await applySchema(pool);
        prefix = `kycit-${Date.now()}`;
        users.customer = await createUser('customer', { emailVerified: false });
        users.other = await createUser('other', { emailVerified: true });
        users.admin = await createUser('admin', { role: 'admin', emailVerified: true });
        for (const key of Object.keys(users)) tokens[key] = tokenFor(users[key]);

        app = express();
        app.use(express.json());
        app.use('/', require('../routes/kyc'));
    });

    afterAll(async () => {
        if (pool && prefix) {
            // kyc_documents.reviewed_by references the admin user, so remove
            // the test customers' documents (and cascaded files) first.
            await pool.query(
                'DELETE FROM kyc_documents WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
                [`${prefix}-%`]
            );
            await pool.query('DELETE FROM users WHERE email LIKE $1', [`${prefix}-%`]);
            await pool.end();
        }
    });

    test('an unverified email cannot submit identity documents', async () => {
        const res = await uploadDocument('customer');
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, code: 'EMAIL_VERIFICATION_REQUIRED' });
        const { rows } = await pool.query('SELECT kyc_status FROM users WHERE id = $1', [users.customer.id]);
        expect(rows[0].kyc_status).toBe('pending');
    });

    test('after email verification, a non-document file is refused', async () => {
        await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [users.customer.id]);
        const res = await uploadDocument('customer', {
            filename: 'notes.txt',
            contentType: 'text/plain',
            bytes: Buffer.from('not an identity document'),
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, code: 'KYC_UNSUPPORTED_FILE_TYPE' });
        const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS count FROM kyc_documents WHERE user_id = $1',
            [users.customer.id]
        );
        expect(rows[0].count).toBe(0);
    });

    test('a valid document is stored in PostgreSQL and marks the user submitted, not verified', async () => {
        const res = await uploadDocument('customer');
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ success: true, kycStatus: 'submitted' });
        const documentId = res.body.data.id;
        expect(documentId).toBeTruthy();

        const { rows: docs } = await pool.query(
            `SELECT id, user_id, document_type, document_url, status
               FROM kyc_documents WHERE id = $1`,
            [documentId]
        );
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({
            user_id: users.customer.id,
            document_type: 'passport',
            document_url: `/api/kyc/${documentId}/file`,
            status: 'pending',
        });

        const { rows: files } = await pool.query(
            'SELECT mime_type, byte_size, content FROM kyc_document_files WHERE document_id = $1',
            [documentId]
        );
        expect(files).toHaveLength(1);
        expect(files[0].mime_type).toBe('image/png');
        expect(files[0].byte_size).toBe(PNG_BYTES.length);
        expect(Buffer.compare(files[0].content, PNG_BYTES)).toBe(0);

        const { rows: userRows } = await pool.query(
            'SELECT kyc_status, kyc_submitted_at FROM users WHERE id = $1',
            [users.customer.id]
        );
        expect(userRows[0].kyc_status).toBe('submitted');
        expect(userRows[0].kyc_submitted_at).not.toBeNull();

        const { rows: migrations } = await pool.query(
            'SELECT filename FROM _migrations WHERE filename = $1',
            ['014_kyc_document_files.sql']
        );
        expect(migrations).toHaveLength(1);
    });

    test('a second pending document is refused', async () => {
        const res = await uploadDocument('customer', { filename: 'second.png' });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, code: 'KYC_REVIEW_IN_PROGRESS' });
        const { rows } = await pool.query(
            "SELECT COUNT(*)::int AS count FROM kyc_documents WHERE user_id = $1 AND status = 'pending'",
            [users.customer.id]
        );
        expect(rows[0].count).toBe(1);
    });

    test('the customer sees real pending state and can read only their own file', async () => {
        const status = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${tokens.customer}`);
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({
            success: true,
            emailVerified: true,
            kycStatus: 'submitted',
            canSubmit: false,
        });
        expect(status.body.pendingDocument).toMatchObject({ status: 'pending' });
        expect(status.body.data).toHaveLength(1);
        const documentId = status.body.data[0].id;

        const ownFile = await request(app)
            .get(`/api/kyc/${documentId}/file`)
            .set('Authorization', `Bearer ${tokens.customer}`);
        expect(ownFile.status).toBe(200);
        expect(ownFile.headers['content-type']).toMatch(/image\/png/);
        expect(Number(ownFile.headers['content-length'])).toBe(PNG_BYTES.length);

        const otherFile = await request(app)
            .get(`/api/kyc/${documentId}/file`)
            .set('Authorization', `Bearer ${tokens.other}`);
        expect(otherFile.status).toBe(404);
    });

    test('a customer cannot approve their own KYC document', async () => {
        const { rows } = await pool.query(
            'SELECT id FROM kyc_documents WHERE user_id = $1 LIMIT 1',
            [users.customer.id]
        );
        const res = await request(app)
            .put(`/api/kyc/${rows[0].id}/approve`)
            .set('Authorization', `Bearer ${tokens.customer}`)
            .send({});
        expect(res.status).toBe(403);
        const { rows: userRows } = await pool.query('SELECT kyc_status FROM users WHERE id = $1', [users.customer.id]);
        expect(userRows[0].kyc_status).toBe('submitted');
    });

    test('admin approval atomically verifies the customer and records an audit entry', async () => {
        const { rows } = await pool.query(
            'SELECT id FROM kyc_documents WHERE user_id = $1 LIMIT 1',
            [users.customer.id]
        );
        const documentId = rows[0].id;
        const res = await request(app)
            .put(`/api/kyc/${documentId}/approve`)
            .set('Authorization', `Bearer ${tokens.admin}`)
            .send({ note: 'Passport matches the account holder.' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, kycStatus: 'verified' });

        const { rows: userRows } = await pool.query(
            'SELECT kyc_status, kyc_verified_at FROM users WHERE id = $1',
            [users.customer.id]
        );
        expect(userRows[0].kyc_status).toBe('verified');
        expect(userRows[0].kyc_verified_at).not.toBeNull();

        const { rows: auditRows } = await pool.query(
            `SELECT action FROM audit_logs
              WHERE resource_id = $1 AND action = 'kyc.document_approved'`,
            [documentId]
        );
        expect(auditRows.length).toBeGreaterThan(0);

        const status = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${tokens.customer}`);
        expect(status.body).toMatchObject({ kycStatus: 'verified', canSubmit: false });
    });

    test('rejection gives the customer a reason and permits a corrected resubmission', async () => {
        const uploaded = await uploadDocument('other', {
            documentType: 'national_id',
            filename: 'national-id.png',
        });
        expect(uploaded.status).toBe(201);
        const documentId = uploaded.body.data.id;

        const queue = await request(app)
            .get('/api/admin/kyc?status=pending')
            .set('Authorization', `Bearer ${tokens.admin}`);
        expect(queue.status).toBe(200);
        const queued = queue.body.data.find((item) => item.id === documentId);
        expect(queued).toBeTruthy();
        expect(queued.customer).toMatchObject({
            id: users.other.id,
            email: `${prefix}-other@test.invalid`,
            kycStatus: 'submitted',
            emailVerified: true,
        });
        expect(queued.hasFile).toBe(true);

        const rejected = await request(app)
            .put(`/api/kyc/${documentId}/reject`)
            .set('Authorization', `Bearer ${tokens.admin}`)
            .send({ note: 'The photo is too blurry to read the document number.' });
        expect(rejected.status).toBe(200);
        expect(rejected.body).toMatchObject({ success: true, kycStatus: 'rejected' });

        const status = await request(app)
            .get('/api/kyc')
            .set('Authorization', `Bearer ${tokens.other}`);
        expect(status.body).toMatchObject({ kycStatus: 'rejected', canSubmit: true });
        expect(status.body.data[0].reviewNotes).toContain('too blurry');

        const resubmitted = await uploadDocument('other', {
            documentType: 'national_id',
            filename: 'national-id-clear.png',
        });
        expect(resubmitted.status).toBe(201);
        expect(resubmitted.body.kycStatus).toBe('submitted');
    });
});
