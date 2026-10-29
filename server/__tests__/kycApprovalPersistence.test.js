'use strict';

jest.mock('multer', () => {
  const multer = () => ({ single: () => (_req, _res, next) => next() });
  multer.diskStorage = jest.fn(() => ({}));
  return multer;
});

jest.mock('../config/db', () => ({
  query: jest.fn(),
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
    params: { id: 'kyc-document-1' },
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
        id: 'kyc-document-1',
        status: 'approved',
        reviewed_at: '2026-10-29T00:00:00.000Z',
        user_verified: true,
      }],
      rowCount: 1,
    });

    const handler = getHandler('/api/kyc/:id/approve', 'put');
    const req = {
      params: { id: 'kyc-document-1' },
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
      data: { id: 'kyc-document-1', status: 'approved' },
    });
    expect(database.query).toHaveBeenCalledTimes(1);
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain('UPDATE kyc_documents');
    expect(sql).toContain('UPDATE users');
    expect(sql).toContain("SET kyc_status = 'verified'");
    expect(params).toEqual(['admin-1', 'kyc-document-1']);
  });

  test('returns 404 when the KYC document does not exist', async () => {
    const res = await approve({ rows: [], rowCount: 0 });
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: 'KYC document not found.' });
  });

  test('does not report successful verification if user status was not persisted', async () => {
    const res = await approve({
      rows: [{
        id: 'kyc-document-1',
        status: 'approved',
        reviewed_at: '2026-10-29T00:00:00.000Z',
        user_verified: false,
      }],
      rowCount: 1,
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ success: false, message: 'Failed to approve KYC document.' });
  });
});
