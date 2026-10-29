'use strict';

jest.mock('multer', () => {
  const multer = () => ({ single: () => (_req, _res, next) => next() });
  multer.diskStorage = jest.fn(() => ({}));
  multer.memoryStorage = jest.fn(() => ({}));
  return multer;
});

jest.mock('../config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  isDemo: false,
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));

const database = require('../config/db');
const router = require('../routes/kyc');

function getHandler(path, method) {
  const layer = router.stack.find((entry) =>
    entry.route && entry.route.path === path && entry.route.methods[method]
  );
  if (!layer) throw new Error('Route not found: ' + method.toUpperCase() + ' ' + path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeResponse() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-image-bytes'),
]);

function uploadRequest(overrides = {}) {
  return {
    file: {
      buffer: PNG_BYTES,
      mimetype: 'image/png',
      originalname: 'id.png',
    },
    body: { documentType: 'passport' },
    user: { id: 'customer-1', role: 'user', email_verified: true, kyc_status: 'pending' },
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  };
}

async function runUpload(req) {
  const res = makeResponse();
  await getHandler('/api/kyc', 'post')(req, res, () => {});
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('KYC upload validation', () => {
  test('rejects an upload with no document before touching the database', async () => {
    const res = await runUpload(uploadRequest({ file: undefined }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_DOCUMENT_REQUIRED' });
    expect(database.query).not.toHaveBeenCalled();
  });

  test('refuses KYC before the account email is verified', async () => {
    const res = await runUpload(uploadRequest({
      user: { id: 'customer-1', role: 'user', email_verified: false, kyc_status: 'pending' },
    }));
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'EMAIL_VERIFICATION_REQUIRED' });
    expect(database.query).not.toHaveBeenCalled();
  });

  test('refuses a second document after identity is already verified', async () => {
    const res = await runUpload(uploadRequest({
      user: { id: 'customer-1', role: 'user', email_verified: true, kyc_status: 'verified' },
    }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_ALREADY_VERIFIED' });
  });

  test('requires a supported document type', async () => {
    const res = await runUpload(uploadRequest({ body: { documentType: 'utility-bill-selfie' } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_DOCUMENT_TYPE_INVALID' });
  });

  test('refuses a file whose bytes are not the declared document format', async () => {
    const res = await runUpload(uploadRequest({
      file: {
        buffer: Buffer.from('<html><script>alert(1)</script></html>'),
        mimetype: 'image/png',
        originalname: 'passport.png',
      },
    }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_FILE_CONTENT_MISMATCH' });
    expect(database.query).not.toHaveBeenCalled();
  });

  test('refuses a duplicate pending submission', async () => {
    database.query.mockResolvedValueOnce({ rows: [{ id: 'existing-doc' }], rowCount: 1 });
    const res = await runUpload(uploadRequest());
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_REVIEW_IN_PROGRESS' });
    expect(database.query).toHaveBeenCalledTimes(1);
  });
});

describe('KYC customer status', () => {
  test('reports the persisted state and a next step without inventing verification', async () => {
    database.query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-1',
        document_type: 'passport',
        document_name: 'passport.png',
        status: 'pending',
        submitted_at: '2026-10-28T00:00:00.000Z',
        reviewed_at: null,
        review_notes: null,
      }],
      rowCount: 1,
    });
    const res = makeResponse();
    await getHandler('/api/kyc', 'get')({
      user: { id: 'customer-1', role: 'user', email_verified: true, kyc_status: 'submitted' },
      headers: {},
    }, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      emailVerified: true,
      kycStatus: 'submitted',
      canSubmit: false,
    });
    expect(res.body.pendingDocument).toMatchObject({ id: 'doc-1', status: 'pending' });
    expect(res.body.nextStep).toContain('waiting for human review');
  });
});

describe('KYC document access', () => {
  test('hides another customer\'s document file', async () => {
    database.query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        user_id: 'other-customer',
        document_name: 'passport.pdf',
        mime_type: 'application/pdf',
        content: Buffer.from('%PDF-test'),
      }],
      rowCount: 1,
    });
    const res = makeResponse();
    await getHandler('/api/kyc/:id/file', 'get')({
      params: { id: '11111111-1111-4111-8111-111111111111' },
      user: { id: 'customer-1', role: 'user' },
      headers: {},
    }, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: 'KYC document not found.' });
  });
});

describe('KYC admin queue', () => {
  test('defaults to pending and includes customer identity state without file bytes', async () => {
    database.query.mockResolvedValueOnce({
      rows: [{
        id: 'doc-1',
        user_id: 'customer-1',
        document_type: 'passport',
        document_name: 'passport.png',
        status: 'pending',
        submitted_at: '2026-10-28T00:00:00.000Z',
        reviewed_at: null,
        review_notes: null,
        email: 'customer@example.invalid',
        full_name: 'Test Customer',
        kyc_status: 'submitted',
        email_verified: true,
        has_file: true,
      }],
      rowCount: 1,
    });
    const res = makeResponse();
    await getHandler('/api/admin/kyc', 'get')({
      query: {},
      user: { id: 'admin-1', role: 'admin' },
      headers: {},
    }, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: 'doc-1',
      hasFile: true,
      customer: { id: 'customer-1', kycStatus: 'submitted', emailVerified: true },
    });
    expect(res.body.data[0].content).toBeUndefined();
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain('JOIN users u ON u.id = d.user_id');
    expect(params).toEqual(['pending']);
  });
});
