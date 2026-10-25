const mockDb = {
  query: jest.fn(),
  ensureConnection: jest.fn(),
  getClient: jest.fn(),
};

jest.mock('../config/database', () => ({
  db: mockDb,
  createNotification: jest.fn(),
  createAuditLog: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    if (!req.user) req.user = { id: 'user-1', role: 'user' };
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    next();
  },
}));

const CDB = require('../config/database');
const router = require('../routes/direct-upi');
const ENV = process.env;
const ENV_KEYS = ['VB_UPI_DEPOSIT_ENABLED', 'VB_UPI_RECEIVING_VPA', 'VB_UPI_RECEIVING_NAME'];
const SAVED = {};
for (const key of ENV_KEYS) {
  SAVED[key] = ENV[key];
  delete ENV[key];
}
afterAll(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete ENV[key];
    else ENV[key] = value;
  }
});

const CONFIG = {
  VB_UPI_DEPOSIT_ENABLED: 'true',
  VB_UPI_RECEIVING_VPA: 'vaultbank.test@okaxis',
  VB_UPI_RECEIVING_NAME: 'VaultBank Test',
};
function enable() {
  for (const [key, value] of Object.entries(CONFIG)) ENV[key] = value;
}
const INTENT = {
  id: 'intent-1',
  user_id: 'user-1',
  account_id: 'account-inr-1',
  reference: 'VBTESTAB1234',
  amount: '125.00',
  currency: 'INR',
  status: 'pending',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 600000).toISOString(),
};

function responseMock() {
  const res = { code: null, body: null };
  res.status = jest.fn((status) => { res.code = status; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

async function call(path, options = {}) {
  const method = (options.method || 'get').toLowerCase();
  const pathMap = {
    '/api/direct-upi/intents': '/api/direct-upi/intents',
    '/api/direct-upi/admin/intents/intent-1/verify': '/api/direct-upi/admin/intents/:id/verify',
    '/api/direct-upi/admin/intents/intent-1/fail': '/api/direct-upi/admin/intents/:id/fail',
    '/api/direct-upi/intents/intent-1/cancel': '/api/direct-upi/intents/:id/cancel',
  };
  const pattern = pathMap[path] || path;
  const layer = router.stack.find((item) => item.route && item.route.path === pattern && item.route.methods[method]);
  if (!layer) throw new Error('Missing route ' + method.toUpperCase() + ' ' + pattern);
  const res = responseMock();
  const req = {
    method: method.toUpperCase(),
    user: options.user,
    ip: '127.0.0.1',
    headers: {},
    body: options.body || {},
    params: pattern.includes(':id') ? { id: 'intent-1' } : {},
    query: options.query || {},
  };
  let canContinue = true;
  const handlers = layer.route.stack.map((item) => item.handle);
  for (let i = 0; i < handlers.length - 1 && canContinue; i++) {
    canContinue = false;
    await handlers[i](req, res, () => { canContinue = true; });
  }
  if (canContinue) await handlers[handlers.length - 1](req, res, () => {});
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of ENV_KEYS) delete ENV[key];
  CDB.db.ensureConnection.mockResolvedValue(undefined);
  CDB.db.query.mockResolvedValue({ rows: [] });
  CDB.createNotification.mockResolvedValue({ id: 'notification-1' });
  CDB.createAuditLog.mockResolvedValue({ id: 'audit-1' });
});

describe('VaultBank-owned Direct UPI rail', () => {
  test('is fail-closed by default and does not expose a VPA', async () => {
    const result = router.readiness();
    expect(result.available).toBe(false);
    const response = await call('/api/direct-upi/config');
    expect(response.code).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(response.body.vpa).toBeNull();
  });

  test('rejects disabled creation without touching the database', async () => {
    const response = await call('/api/direct-upi/intents', { method: 'post', body: { amount: 10 } });
    expect(response.code).toBe(503);
    expect(response.body.code).toBe('DIRECT_UPI_NOT_CONFIGURED');
    expect(CDB.db.query).not.toHaveBeenCalled();
  });

  test('uses strict paise amount parsing', () => {
    expect(router.parseAmountToPaise('1')).toBe(100);
    expect(router.parseAmountToPaise('10.25')).toBe(1025);
    expect(router.parseAmountToPaise('1e2')).toBeNull();
    expect(router.parseAmountToPaise('12.345')).toBeNull();
    expect(router.parseAmountToPaise('0.50')).toBeNull();
    expect(router.parseAmountToPaise('10000.01')).toBeNull();
  });

  test('builds a UPI URI with VPA, exact amount, currency and unique note', () => {
    enable();
    const cfg = router.readiness();
    const uri = new URL(router.makeUpiUri(cfg, '125.00', 'VBREF123'));
    expect(uri.protocol).toBe('upi:');
    expect(uri.searchParams.get('pa')).toBe(CONFIG.VB_UPI_RECEIVING_VPA);
    expect(uri.searchParams.get('pn')).toBe(CONFIG.VB_UPI_RECEIVING_NAME);
    expect(uri.searchParams.get('am')).toBe('125.00');
    expect(uri.searchParams.get('cu')).toBe('INR');
    expect(uri.searchParams.get('tn')).toBe('VBREF123');
  });

  test('creates a pending intent and QR without any balance credit', async () => {
    enable();
    CDB.db.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes('COUNT(*) AS open_count')) return { rows: [{ open_count: '0' }] };
      if (query.includes('SELECT id FROM accounts')) return { rows: [{ id: 'account-inr-1' }] };
      if (query.includes('INSERT INTO direct_upi_deposit_intents')) {
        return { rows: [INTENT] };
      }
      return { rows: [] };
    });
    const response = await call('/api/direct-upi/intents', { method: 'post', body: { amount: '125.00' } });
    expect(response.code).toBe(201);
    expect(response.body.intent.status).toBe('pending');
    expect(response.body.transfer.upiUri).toContain('upi://pay?');
    expect(response.body.transfer.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(response.body.transfer.vpa).toBe(CONFIG.VB_UPI_RECEIVING_VPA);
    expect(CDB.db.query.mock.calls.some(([sql]) => String(sql).includes('balance = balance +'))).toBe(false);
  });

  test('blocks creation when the user has no active INR account', async () => {
    enable();
    CDB.db.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes('SELECT id FROM accounts')) return { rows: [] };
      return { rows: [] };
    });
    const response = await call('/api/direct-upi/intents', { method: 'post', body: { amount: 100 } });
    expect(response.code).toBe(409);
    expect(response.body.code).toBe('INR_ACCOUNT_REQUIRED');
    expect(CDB.db.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO direct_upi_deposit_intents'))).toBe(false);
  });

  test('rejects verification without a valid bank UTR and statement note', async () => {
    const response = await call('/api/direct-upi/admin/intents/intent-1/verify', {
      method: 'post',
      user: { id: 'admin-1', role: 'admin' },
      body: { settlementAmount: '125.00', bankUtr: 'x', evidenceNote: 'ok' },
    });
    expect(response.code).toBe(400);
    expect(response.body.code).toBe('DIRECT_UPI_UTR_REQUIRED');
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('non-admin cannot access the settlement verification endpoint', async () => {
    const response = await call('/api/direct-upi/admin/intents/intent-1/verify', {
      method: 'post',
      user: { id: 'user-1', role: 'user' },
      body: { settlementAmount: '125.00', bankUtr: '123456789012', evidenceNote: 'Checked bank statement row' },
    });
    expect(response.code).toBe(403);
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('amount mismatch never obtains a ledger connection or credits funds', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    CDB.db.getClient.mockResolvedValue(client);
    client.query.mockImplementation(async (sql) => {
      if (String(sql).startsWith('SELECT * FROM direct_upi_deposit_intents')) return { rows: [INTENT] };
      return { rows: [] };
    });
    enable();
    // Schema readiness is cached after creation tests; no database writes are expected before BEGIN/SELECT.
    const response = await call('/api/direct-upi/admin/intents/intent-1/verify', {
      method: 'post',
      user: { id: 'admin-1', role: 'admin' },
      body: { settlementAmount: '124.00', bankUtr: '123456789012', evidenceNote: 'Checked official statement line' },
    });
    expect(response.code).toBe(409);
    expect(response.body.code).toBe('DIRECT_UPI_AMOUNT_MISMATCH');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE accounts'))).toBe(false);
  });
});
