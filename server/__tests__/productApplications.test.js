'use strict';

jest.mock('../config/database', () => ({
  db: {
    query: jest.fn(),
    ensureConnection: jest.fn(),
  },
  isDemo: false,
  createAuditLog: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    if (!req.user) req.user = { id: 'user-1', email_verified: false, kyc_status: 'pending', role: 'user' };
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

jest.mock('../middleware/rateLimiter', () => ({
  authStrictLimiter: (_req, _res, next) => next(),
}));

const database = require('../config/database');
const router = require('../routes/product-applications');

function makeResponse() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

function layerFor(path, method) {
  const layer = router.stack.find((entry) =>
    entry.route && entry.route.path === path && entry.route.methods[method]
  );
  if (!layer) throw new Error('Route not found: ' + method.toUpperCase() + ' ' + path);
  return layer;
}

async function callRoute(path, method, options = {}) {
  const layer = layerFor(path, method);
  const req = {
    method: method.toUpperCase(),
    user: { id: 'user-1', email_verified: false, kyc_status: 'pending', role: 'user' },
    ip: '127.0.0.1',
    headers: {},
    body: {},
    params: {},
    query: {},
    ...options,
  };
  const res = makeResponse();
  for (const item of layer.route.stack) {
    let continued = false;
    await item.handle(req, res, () => { continued = true; });
    if (!continued) break;
  }
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  database.db.ensureConnection.mockResolvedValue(undefined);
  database.db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  database.createAuditLog.mockResolvedValue({ id: 'audit-1' });
});

describe('card program request tracking', () => {
  test('requires an idempotency key and does not touch the database without one', async () => {
    const res = await callRoute('/api/card-program/requests', 'post', {
      body: { cardType: 'debit', currency: 'INR' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(database.db.query).not.toHaveBeenCalled();
  });

  test('stores an unverified customer request without claiming that a card was issued', async () => {
    database.db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO card_program_requests')) {
        return {
          rows: [{
            id: '41',
            user_id: 'user-1',
            card_type: 'debit',
            currency: 'INR',
            status: 'needs_verification',
            created_at: '2026-10-29T00:00:00Z',
            updated_at: '2026-10-29T00:00:00Z',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await callRoute('/api/card-program/requests', 'post', {
      headers: { 'idempotency-key': 'card-request-0001' },
      body: { cardType: 'debit', currency: 'INR' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      cardNetworkIssuingAvailable: false,
      request: { id: '41', cardType: 'debit', currency: 'INR', status: 'needs_verification' },
    });
    expect(res.body.message).toContain('Verify your email');
    expect(res.body.request).not.toHaveProperty('cardNumber');
    expect(res.body.request).not.toHaveProperty('cvv');
  });

  test('idempotent retry returns the existing matching request and rejects changed details', async () => {
    const existing = {
      id: '41',
      user_id: 'user-1',
      card_type: 'debit',
      currency: 'INR',
      status: 'needs_verification',
      created_at: '2026-10-29T00:00:00Z',
      updated_at: '2026-10-29T00:00:00Z',
    };
    database.db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO card_program_requests')) return { rows: [], rowCount: 0 };
      if (String(sql).includes('SELECT * FROM card_program_requests WHERE user_id')) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const replay = await callRoute('/api/card-program/requests', 'post', {
      headers: { 'idempotency-key': 'card-request-0002' },
      body: { cardType: 'debit', currency: 'INR' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.body.replay).toBe(true);

    const conflict = await callRoute('/api/card-program/requests', 'post', {
      headers: { 'idempotency-key': 'card-request-0002' },
      body: { cardType: 'credit', currency: 'USD' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('refuses to mark a card request as issued/approved without an issuer', async () => {
    const res = await callRoute('/api/admin/card-program/requests/:id/status', 'patch', {
      user: { id: 'admin-1', role: 'admin' },
      params: { id: '41' },
      body: { status: 'approved', note: 'Approved for issue immediately' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('CARD_REVIEW_INVALID');
    expect(database.db.query).not.toHaveBeenCalled();
  });

  test('blocks issuer review until both email and KYC verification are persisted', async () => {
    database.db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT u.email_verified')) {
        return { rows: [{ email_verified: true, kyc_status: 'pending' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await callRoute('/api/admin/card-program/requests/:id/status', 'patch', {
      user: { id: 'admin-1', role: 'admin' },
      params: { id: '41' },
      body: { status: 'under_review', note: 'Prepare request for issuer review' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('CUSTOMER_VERIFICATION_REQUIRED');
    expect(database.db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE card_program_requests'),
      expect.anything(),
    );
  });
});

describe('loan application tracking', () => {
  test('rejects unsupported amount/term/purpose combinations before writing', async () => {
    const res = await callRoute('/api/loan-applications', 'post', {
      headers: { 'idempotency-key': 'loan-request-0001' },
      body: { amount: 10, currency: 'INR', termMonths: 9, purpose: 'car' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('LOAN_APPLICATION_INVALID');
    expect(database.db.query).not.toHaveBeenCalled();
  });

  test('stores a loan request without creating credit or claiming disbursement', async () => {
    database.db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO loan_applications')) {
        return {
          rows: [{
            id: '73',
            user_id: 'user-1',
            amount: '10000.00',
            currency: 'INR',
            term_months: 12,
            purpose: 'Repair a family home',
            status: 'needs_verification',
            created_at: '2026-10-29T00:00:00Z',
            updated_at: '2026-10-29T00:00:00Z',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await callRoute('/api/loan-applications', 'post', {
      headers: { 'idempotency-key': 'loan-request-0002' },
      body: { amount: 10000, currency: 'INR', termMonths: 12, purpose: 'Repair a family home' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      loanFundingAvailable: false,
      application: { id: '73', amount: 10000, currency: 'INR', termMonths: 12, status: 'needs_verification' },
    });
    expect(res.body.message).toContain('Verify your email');
  });

  test('does not allow an admin to label an application approved or disbursed', async () => {
    const res = await callRoute('/api/admin/loan-applications/:id/status', 'patch', {
      user: { id: 'admin-1', role: 'admin' },
      params: { id: '73' },
      body: { status: 'approved', note: 'Approved for payout immediately' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('LOAN_REVIEW_INVALID');
    expect(database.db.query).not.toHaveBeenCalled();
  });

  test('blocks loan review until email and KYC verification are persisted', async () => {
    database.db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT u.email_verified')) {
        return { rows: [{ email_verified: true, kyc_status: 'pending' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await callRoute('/api/admin/loan-applications/:id/status', 'patch', {
      user: { id: 'admin-1', role: 'admin' },
      params: { id: '73' },
      body: { status: 'under_review', note: 'Review financial application' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('CUSTOMER_VERIFICATION_REQUIRED');
    expect(database.db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE loan_applications'),
      expect.anything(),
    );
  });
});
