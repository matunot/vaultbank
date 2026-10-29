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

async function approve(result) {
  database.query.mockResolvedValueOnce(result);
  const handler = getHandler('/api/kyc/:id/approve', 'put');
  const req = {
    params: { id: '11111111-1111-4111-8111-111111111111' },
    body: {},
    user: { id: 'admin-1', role: 'admin' },
    ip: '127.0.0.1',
    headers: {},
  };
  const res = makeResponse();
  await handler(req, res, () => {});
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('KYC approval persistence', () => {
  test('approving a document also persists users.kyc_status in the same SQL statement', async () => {
    database.query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        user_id: 'customer-1',
        status: 'approved',
        reviewed_at: '2026-10-29T00:00:00.000Z',
        user_verified: true,
      }],
      rowCount: 1,
    });

    const handler = getHandler('/api/kyc/:id/approve', 'put');
    const req = {
      params: { id: '11111111-1111-4111-8111-111111111111' },
      body: { note: 'Passport matches the account holder.' },
      user: { id: 'admin-1', role: 'admin' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = makeResponse();
    await handler(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      kycStatus: 'verified',
      data: { id: '11111111-1111-4111-8111-111111111111', status: 'approved' },
    });
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain('UPDATE kyc_documents');
    expect(sql).toContain('UPDATE users');
    expect(sql).toContain("SET kyc_status = 'verified'");
    // 007 renamed reviewer_id to reviewed_by; writing the old column would
    // fail against the real production schema.
    expect(sql).toContain('reviewed_by = $1');
    expect(sql).toContain("status = 'pending'");
    expect(params).toEqual(['admin-1', '11111111-1111-4111-8111-111111111111', 'Passport matches the account holder.']);
  });

  test('returns 404 when no pending KYC document matches', async () => {
    const res = await approve({ rows: [], rowCount: 0 });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      code: 'KYC_PENDING_DOCUMENT_NOT_FOUND',
    });
  });

  test('rejects a malformed document id without querying PostgreSQL', async () => {
    const handler = getHandler('/api/kyc/:id/approve', 'put');
    const res = makeResponse();
    await handler({
      params: { id: 'not-a-uuid' },
      body: {},
      user: { id: 'admin-1', role: 'admin' },
      headers: {},
    }, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_PENDING_DOCUMENT_NOT_FOUND' });
    expect(database.query).not.toHaveBeenCalled();
  });

  test('does not report successful verification if user status was not persisted', async () => {
    const res = await approve({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        user_id: 'customer-1',
        status: 'approved',
        reviewed_at: '2026-10-29T00:00:00.000Z',
        user_verified: false,
      }],
      rowCount: 1,
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ success: false, message: 'Failed to approve the KYC document.' });
  });
});

describe('KYC rejection', () => {
  test('requires a customer-visible review note', async () => {
    const handler = getHandler('/api/kyc/:id/reject', 'put');
    const req = {
      params: { id: '11111111-1111-4111-8111-111111111111' },
      body: { note: '' },
      user: { id: 'admin-1', role: 'admin' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = makeResponse();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'KYC_REVIEW_NOTE_REQUIRED' });
    expect(database.query).not.toHaveBeenCalled();
  });

  test('records the rejection reason and only downgrades a non-verified user', async () => {
    database.query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        user_id: 'customer-1',
        status: 'rejected',
        reviewed_at: '2026-10-29T00:00:00.000Z',
        review_notes: 'The document photo is not readable.',
        user_marked_rejected: true,
      }],
      rowCount: 1,
    });
    const handler = getHandler('/api/kyc/:id/reject', 'put');
    const req = {
      params: { id: '11111111-1111-4111-8111-111111111111' },
      body: { note: 'The document photo is not readable.' },
      user: { id: 'admin-1', role: 'admin' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = makeResponse();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, kycStatus: 'rejected' });
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain('reviewed_by = $1');
    expect(sql).toContain("kyc_status <> 'verified'");
    expect(params).toEqual(['admin-1', '11111111-1111-4111-8111-111111111111', 'The document photo is not readable.']);
  });
});
