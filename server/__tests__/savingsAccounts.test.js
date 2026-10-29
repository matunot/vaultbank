'use strict';

jest.mock('../config/database', () => ({
  db: {
    query: jest.fn(),
    ensureConnection: jest.fn(),
    getClient: jest.fn(),
  },
  isDemo: false,
  demoStore: { accounts: [], users: [] },
  createAccount: jest.fn(),
  createAuditLog: jest.fn(),
  createNotification: jest.fn(),
  findAccountByUserId: jest.fn(),
  findAccountByUserIdAndCurrency: jest.fn(),
  findAccountByNumber: jest.fn(),
  searchUsers: jest.fn(),
  updateAccountBalance: jest.fn(),
  createTransaction: jest.fn(),
  getTransactions: jest.fn(),
  createTransfer: jest.fn(),
  getTransfers: jest.fn(),
  createNotification: jest.fn(),
  createAuditLog: jest.fn(),
}));

jest.mock('../services/transferService', () => ({
  executeAtomicTransfer: jest.fn(),
  notifyTransferCompletion: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (_req, _res, next) => next(),
}));

const database = require('../config/database');
const transferService = require('../services/transferService');
const savingsRouter = require('../routes/savings');
const accountsRouter = require('../routes/accounts');

function makeResponse() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

function getLayer(router, path, method) {
  const layer = router.stack.find((entry) =>
    entry.route && entry.route.path === path && entry.route.methods[method]
  );
  if (!layer) throw new Error('Route not found: ' + method.toUpperCase() + ' ' + path);
  return layer;
}

async function call(router, path, method, overrides = {}) {
  const layer = getLayer(router, path, method);
  const req = {
    method: method.toUpperCase(),
    user: { id: 'user-1', full_name: 'Savings User', role: 'user' },
    ip: '127.0.0.1',
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
  const res = makeResponse();
  for (const item of layer.route.stack) {
    let continued = false;
    await item.handle(req, res, () => { continued = true; });
    if (!continued) break;
  }
  return { req, res };
}

const primary = {
  id: 'account-primary',
  user_id: 'user-1',
  account_number: 'VB-1000-2000-3000-1',
  account_type: 'checking',
  account_name: 'Primary Account',
  currency: 'USD',
  balance: '250.00',
  available_balance: '250.00',
  held_balance: '0.00',
  status: 'active',
};
const vault = {
  id: 'account-vault',
  user_id: 'user-1',
  account_number: 'VB-2000-3000-4000-2',
  account_type: 'savings',
  account_name: 'Savings Account',
  currency: 'USD',
  balance: '50.00',
  available_balance: '50.00',
  held_balance: '0.00',
  status: 'active',
};

beforeEach(() => {
  jest.clearAllMocks();
  database.db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  database.createAccount.mockResolvedValue(vault);
  database.createAuditLog.mockResolvedValue({ id: 'audit-1' });
  database.createNotification.mockResolvedValue({ id: 'notification-1' });
  transferService.executeAtomicTransfer.mockResolvedValue({
    transferId: 'transfer-1',
    senderBalance: 250,
    newSenderBalance: 150,
    recipientBalance: 150,
  });
  transferService.notifyTransferCompletion.mockResolvedValue(undefined);
});

describe('production savings accounts backed by PostgreSQL', () => {
  test('lists savings accounts owned by the current user', async () => {
    database.db.query.mockResolvedValueOnce({ rows: [vault], rowCount: 1 });
    const { res } = await call(savingsRouter, '/api/savings/accounts', 'get');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      interestBearing: false,
      accounts: [{
        id: 'account-vault',
        currency: 'USD',
        accountType: 'savings',
        balance: 50,
        availableBalance: 50,
      }],
    });
    expect(database.db.query).toHaveBeenCalledWith(
      expect.stringContaining("account_type = 'savings'"),
      ['user-1'],
    );
  });

  test('opens a zero-balance savings account only in a supported currency', async () => {
    database.createAccount.mockResolvedValueOnce({
      ...vault,
      currency: 'INR',
      balance: '0.00',
      available_balance: '0.00',
    });
    const { res } = await call(savingsRouter, '/api/savings/accounts', 'post', {
      body: { currency: 'INR' },
    });

    expect(res.statusCode).toBe(201);
    expect(database.createAccount).toHaveBeenCalledWith('user-1', 'savings', 'INR');
    expect(res.body.account).toMatchObject({
      id: 'account-vault',
      currency: 'INR',
      balance: 0,
      availableBalance: 0,
    });
    expect(res.body.message).toContain('No funds or interest were added');
  });

  test('rejects unsupported currencies without creating an account', async () => {
    const { res } = await call(savingsRouter, '/api/savings/accounts', 'post', {
      body: { currency: 'EUR' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('SAVINGS_CURRENCY_UNSUPPORTED');
    expect(database.createAccount).not.toHaveBeenCalled();
  });

  test('requires an idempotency key before savings moves', async () => {
    const { res } = await call(savingsRouter, '/api/savings/move', 'post', {
      body: { fromAccountId: 'account-primary', toAccountId: 'account-vault', amount: 25 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(database.db.query).not.toHaveBeenCalled();
    expect(transferService.executeAtomicTransfer).not.toHaveBeenCalled();
  });

  test('rejects moves unless both requested accounts belong to the caller', async () => {
    database.db.query.mockResolvedValueOnce({ rows: [primary], rowCount: 1 });
    const { res } = await call(savingsRouter, '/api/savings/move', 'post', {
      headers: { 'idempotency-key': 'savings-attempt-0001' },
      body: { fromAccountId: 'account-primary', toAccountId: 'account-vault', amount: 25 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('SAVINGS_ACCOUNT_NOT_FOUND');
    expect(transferService.executeAtomicTransfer).not.toHaveBeenCalled();
  });

  test('moves same-currency funds through the shared atomic, idempotent ledger service', async () => {
    database.db.query.mockResolvedValueOnce({ rows: [primary, vault], rowCount: 2 });
    transferService.executeAtomicTransfer.mockResolvedValueOnce({
      transferId: 'transfer-savings-1',
      senderBalance: 250,
      newSenderBalance: 225,
      recipientBalance: 75,
    });

    const { res } = await call(savingsRouter, '/api/savings/move', 'post', {
      headers: { 'idempotency-key': 'savings-attempt-0002' },
      body: { fromAccountId: 'account-primary', toAccountId: 'account-vault', amount: '25.00' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      transferId: 'transfer-savings-1',
      amount: 25,
      currency: 'USD',
    });
    expect(transferService.executeAtomicTransfer).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      senderAccount: primary,
      recipientAccount: vault,
      amount: '25.00',
      currency: 'USD',
      idempotencyKey: 'savings-attempt-0002',
    }));
    expect(transferService.notifyTransferCompletion).toHaveBeenCalledTimes(1);
  });

  test('refuses mixed-currency savings moves without invoking the ledger service', async () => {
    database.db.query.mockResolvedValueOnce({
      rows: [
        primary,
        { ...vault, currency: 'INR' },
      ],
      rowCount: 2,
    });

    const { res } = await call(savingsRouter, '/api/savings/move', 'post', {
      headers: { 'idempotency-key': 'savings-attempt-0003' },
      body: { fromAccountId: 'account-primary', toAccountId: 'account-vault', amount: 25 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('SAVINGS_CURRENCY_MISMATCH');
    expect(transferService.executeAtomicTransfer).not.toHaveBeenCalled();
  });
});

describe('live account list never falls back to demo accounts', () => {
  test('queries PostgreSQL for a normal production user without an isDemo field', async () => {
    database.db.query.mockResolvedValueOnce({ rows: [primary], rowCount: 1 });

    const { res } = await call(accountsRouter, '/api/accounts', 'get', {
      user: { id: 'user-1', role: 'user' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      accounts: [{
        id: 'account-primary',
        accountNumber: 'VB-1000-2000-3000-1',
        accountType: 'checking',
        currency: 'USD',
        balance: 250,
      }],
    });
    expect(database.db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM accounts WHERE user_id = $1'),
      ['user-1'],
    );
  });
});
