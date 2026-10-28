jest.mock('../config/database', () => ({
  db: {
    query: jest.fn(),
    ensureConnection: jest.fn(),
    getClient: jest.fn(),
  },
  findUserById: jest.fn(),
  createNotification: jest.fn(),
  createAuditLog: jest.fn(),
}));

jest.mock('../services/ledgerJournalService', () => ({
  ensureVaultLedgerSchema: jest.fn().mockResolvedValue(undefined),
  ensureCustomerLedgerAccount: jest.fn().mockResolvedValue({ id: 'ledger-account-1', currency: 'INR', accountId: 'account-inr-1' }),
  postBalancedJournal: jest.fn().mockResolvedValue({ journalId: 'journal-1', replay: false }),
  toMinorUnits: (value) => {
    const input = String(value == null ? '' : value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(input)) throw new Error('invalid amount');
    const parts = input.split('.');
    return BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0') || '0');
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    if (!req.user) req.user = { id: 'user-1', role: 'admin' };
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    next();
  },
}));

const CDB = require('../config/database');
const route = require('../routes/direct-bank-payouts');

const ENV_KEYS = ['VB_DIRECT_BANK_PAYOUTS_ENABLED', 'VB_DIRECT_PAYOUT_ENCRYPTION_KEY', 'VB_DIRECT_BANK_PAYOUT_CUSTOMER_ACCESS_ENABLED'];
const SAVED_ENV = {};
for (const key of ENV_KEYS) {
  SAVED_ENV[key] = process.env[key];
  delete process.env[key];
}
afterAll(() => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ENCRYPTION_KEY = 'a7'.repeat(32);
const REQUEST = {
  id: 'payout-1',
  user_id: 'user-1',
  account_id: 'account-inr-1',
  request_reference: 'VBW-REQ0001',
  idempotency_key: 'payout-attempt-0001',
  amount: '100.00',
  currency: 'INR',
  beneficiary_name: 'Alice User',
  destination_account_encrypted: '',
  destination_fingerprint: '',
  destination_account_masked: '****6789',
  destination_ifsc: 'HDFC0001234',
  status: 'reserved',
  bank_utr: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  completed_at: null,
};

function enable() {
  process.env.VB_DIRECT_BANK_PAYOUTS_ENABLED = 'true';
  process.env.VB_DIRECT_PAYOUT_ENCRYPTION_KEY = ENCRYPTION_KEY;
}

function responseMock() {
  const res = { statusCode: null, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

async function call(path, options = {}) {
  const method = (options.method || 'get').toLowerCase();
  const patterns = {
    '/api/direct-bank-payouts/availability': '/api/direct-bank-payouts/availability',
    '/api/direct-bank-payouts/requests': '/api/direct-bank-payouts/requests',
    '/api/direct-bank-payouts/admin/requests/payout-1/confirm': '/api/direct-bank-payouts/admin/requests/:id/confirm',
    '/api/direct-bank-payouts/admin/requests/payout-1/refund': '/api/direct-bank-payouts/admin/requests/:id/refund',
    '/api/direct-bank-payouts/admin/requests': '/api/direct-bank-payouts/admin/requests',
  };
  const pattern = patterns[path] || path;
  const layer = route.stack.find((item) => item.route && item.route.path === pattern && item.route.methods[method]);
  if (!layer) throw new Error('Missing route ' + method.toUpperCase() + ' ' + pattern);
  const res = responseMock();
  const req = {
    method: method.toUpperCase(),
    user: options.user,
    ip: '127.0.0.1',
    headers: options.headers || {},
    body: options.body || {},
    params: pattern.includes(':id') ? { id: 'payout-1' } : {},
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
  for (const key of ENV_KEYS) delete process.env[key];
  CDB.db.ensureConnection.mockResolvedValue(undefined);
  CDB.db.query.mockImplementation(async (sql) => {
    if (String(sql).includes("SELECT COALESCE((SELECT indisunique")) return { rows: [{ ready: true }] };
    return { rows: [] };
  });
  CDB.findUserById.mockResolvedValue({ id: 'user-1', full_name: 'Alice User', email: 'alice@example.test' });
  CDB.createNotification.mockResolvedValue({ id: 'notification-1' });
  CDB.createAuditLog.mockResolvedValue({ id: 'audit-1' });
});

describe('VaultBank-owned manual bank payouts', () => {
  test('blocks non-admin users from creating a payout during the admin-only pilot', async () => {
    enable();
    const response = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      user: { id: 'customer-2', role: 'user' },
      headers: { 'idempotency-key': 'payout-pilot-customer-1' },
      body: { amount: '100.00', beneficiaryName: 'Someone Else', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(response.statusCode).toBe(403);
    expect(CDB.db.query).not.toHaveBeenCalled();
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('manual payout customer access stays closed unless explicitly enabled', async () => {
    enable();
    const response = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      user: { id: 'customer-2', role: 'user', email_verified: true, kyc_status: 'verified' },
      headers: { 'idempotency-key': 'payout-customer-closed-01' },
      body: { amount: '10.00', beneficiaryName: 'Alice User', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe('DIRECT_PAYOUT_CUSTOMER_ACCESS_DISABLED');
    expect(CDB.db.query).not.toHaveBeenCalled();
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('manual payout customer pilot rejects users without completed KYC or email verification', async () => {
    enable();
    process.env.VB_DIRECT_BANK_PAYOUT_CUSTOMER_ACCESS_ENABLED = 'true';
    const response = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      user: { id: 'customer-pending', role: 'user', email_verified: false, kyc_status: 'pending' },
      headers: { 'idempotency-key': 'payout-customer-unverified' },
      body: { amount: '10.00', beneficiaryName: 'Alice User', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe('CUSTOMER_VERIFICATION_REQUIRED');
    expect(CDB.db.query).not.toHaveBeenCalled();
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('is fail-closed without the feature flag and encryption key', async () => {
    const result = route.readiness();
    expect(result.available).toBe(false);
    const response = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      headers: { 'idempotency-key': 'payout-attempt-0001' },
      body: { amount: 100, beneficiaryName: 'Alice User', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body.code).toBe('DIRECT_BANK_PAYOUTS_NOT_CONFIGURED');
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('AES-GCM encrypts the destination and decrypts only with the configured key', () => {
    enable();
    const encrypted = route.encryptAccountNumber('123456789012');
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain('123456789012');
    expect(route.decryptAccountNumber(encrypted)).toBe('123456789012');
    process.env.VB_DIRECT_PAYOUT_ENCRYPTION_KEY = 'bb'.repeat(32);
    expect(() => route.decryptAccountNumber(encrypted)).toThrow();
  });

  test('strictly validates amount, idempotency key, and beneficiary identity before reserving', async () => {
    enable();
    const amountInvalid = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      headers: { 'idempotency-key': 'payout-attempt-0001' },
      body: { amount: '10.001', beneficiaryName: 'Alice User', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(amountInvalid.statusCode).toBe(400);
    const nameMismatch = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      headers: { 'idempotency-key': 'payout-attempt-0002' },
      body: { amount: 100, beneficiaryName: 'Someone Else', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(nameMismatch.statusCode).toBe(400);
    expect(CDB.db.getClient).not.toHaveBeenCalled();
  });

  test('reserves INR funds atomically and returns only the masked destination', async () => {
    enable();
    const row = {
      ...REQUEST,
      destination_account_encrypted: route.encryptAccountNumber('123456789'),
      destination_fingerprint: route.destinationFingerprint('Alice User', '123456789', 'HDFC0001234'),
    };
    CDB.db.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM accounts WHERE user_id')) {
        return { rows: [{ id: 'account-inr-1', user_id: 'user-1', currency: 'INR', status: 'active', available_balance: '500.00' }] };
      }
      if (query.includes('SELECT COALESCE((SELECT indisunique')) return { rows: [{ ready: true }] };
      if (query.includes('SELECT * FROM direct_bank_payout_requests WHERE user_id')) return { rows: [] };
      return { rows: [] };
    });
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.startsWith('INSERT INTO direct_bank_payout_requests')) return { rows: [row] };
      if (query.startsWith('UPDATE accounts SET balance = balance - $2')) return { rows: [{ balance_before: '500.00', balance_after: '400.00' }] };
      return { rows: [] };
    });
    CDB.db.getClient.mockResolvedValue(client);
    const response = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      headers: { 'idempotency-key': 'payout-attempt-0001' },
      body: { amount: '100.00', beneficiaryName: 'Alice User', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body.request.status).toBe('reserved');
    expect(response.body.request.destinationAccountMasked).toBe('****6789');
    expect(response.body.request.destinationAccountNumber).toBeUndefined();
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO transactions'))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  test('insufficient available balance rolls back the reservation and ledger', async () => {
    enable();
    CDB.db.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes('SELECT * FROM accounts WHERE user_id')) {
        return { rows: [{ id: 'account-inr-1', user_id: 'user-1', currency: 'INR', status: 'active', available_balance: '50.00' }] };
      }
      if (query.includes('SELECT COALESCE((SELECT indisunique')) return { rows: [{ ready: true }] };
      if (query.includes('SELECT * FROM direct_bank_payout_requests WHERE user_id')) return { rows: [] };
      return { rows: [] };
    });
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockImplementation(async (sql) => {
      if (String(sql).startsWith('INSERT INTO direct_bank_payout_requests')) return { rows: [REQUEST] };
      if (String(sql).startsWith('UPDATE accounts SET balance = balance - $2')) return { rows: [] };
      return { rows: [] };
    });
    CDB.db.getClient.mockResolvedValue(client);
    const response = await call('/api/direct-bank-payouts/requests', {
      method: 'post',
      headers: { 'idempotency-key': 'payout-attempt-0003' },
      body: { amount: '100.00', beneficiaryName: 'Alice User', bankAccount: '123456789', ifsc: 'HDFC0001234' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body.code).toBe('DIRECT_PAYOUT_INSUFFICIENT_FUNDS');
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO transactions'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false);
  });

  test('admin confirmation marks ledger completed only with an exact amount and UTR', async () => {
    enable();
    const client = { query: jest.fn(), release: jest.fn() };
    CDB.db.getClient.mockResolvedValue(client);
    client.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.startsWith('SELECT * FROM direct_bank_payout_requests WHERE id = $1 FOR UPDATE')) return { rows: [REQUEST] };
      if (query.startsWith("UPDATE direct_bank_payout_requests SET status = 'succeeded'")) return { rows: [{ ...REQUEST, status: 'succeeded', bank_utr: '123456789012' }] };
      if (query.startsWith("UPDATE transactions SET status = 'completed'")) return { rows: [{ id: 'tx-1' }] };
      return { rows: [] };
    });
    const response = await call('/api/direct-bank-payouts/admin/requests/payout-1/confirm', {
      method: 'post',
      user: { id: 'admin-1', role: 'admin' },
      body: { settlementAmount: '100.00', bankUtr: '123456789012', evidenceNote: 'Matched outgoing debit in bank statement' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.request.status).toBe('succeeded');
    expect(client.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  test('duplicate outgoing UTR cannot complete a second payout', async () => {
    enable();
    const client = { query: jest.fn(), release: jest.fn() };
    CDB.db.getClient.mockResolvedValue(client);
    client.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.startsWith('SELECT * FROM direct_bank_payout_requests WHERE id = $1 FOR UPDATE')) return { rows: [REQUEST] };
      if (query.startsWith("UPDATE direct_bank_payout_requests SET status = 'succeeded'")) {
        const error = new Error('duplicate key');
        error.code = '23505';
        throw error;
      }
      return { rows: [] };
    });
    const response = await call('/api/direct-bank-payouts/admin/requests/payout-1/confirm', {
      method: 'post',
      user: { id: 'admin-1', role: 'admin' },
      body: { settlementAmount: '100.00', bankUtr: '123456789012', evidenceNote: 'Matched outgoing debit in bank statement' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe('DIRECT_PAYOUT_UTR_ALREADY_USED');
    expect(client.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  test('a reserved payout is refunded exactly once only after no-transfer evidence', async () => {
    enable();
    const client = { query: jest.fn(), release: jest.fn() };
    CDB.db.getClient.mockResolvedValue(client);
    client.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.startsWith('SELECT * FROM direct_bank_payout_requests WHERE id = $1 FOR UPDATE')) return { rows: [REQUEST] };
      if (query.startsWith("SELECT id FROM transactions WHERE external_reference = $1 AND type = 'withdrawal' FOR UPDATE")) return { rows: [{ id: 'withdrawal-1' }] };
      if (query.startsWith("UPDATE direct_bank_payout_requests SET status = 'failed_refunded'")) return { rows: [{ id: 'payout-1' }] };
      if (query.startsWith('SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1')) return { rows: [] };
      if (query.startsWith('UPDATE accounts SET balance = balance + $2')) return { rows: [{ balance_before: '400.00', balance_after: '500.00' }] };
      if (query.startsWith("UPDATE transactions SET status = 'failed_refunded'")) return { rows: [{ id: 'withdrawal-1' }] };
      return { rows: [] };
    });
    const response = await call('/api/direct-bank-payouts/admin/requests/payout-1/refund', {
      method: 'post',
      user: { id: 'admin-1', role: 'admin' },
      body: { evidenceNote: 'Official statement confirms no outgoing transfer was sent' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.refunded).toBe(true);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE accounts SET balance = balance + $2')).length).toBe(1);
    expect(client.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
});
