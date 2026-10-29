jest.mock('../config/db', () => ({
  ensureConnection: jest.fn(),
  query: jest.fn(),
  getClient: jest.fn(),
  models: {},
  User: { findById: jest.fn() },
  Account: { findOne: jest.fn() },
  Transfer: { find: jest.fn() },
  Transaction: { create: jest.fn() },
}));

jest.mock('../config/database', () => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findAccountByUserIdAndCurrency: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => ({
  transferLimiter: (req, res, next) => next(),
}));
jest.mock('../logger', () => ({ warn: jest.fn(), error: jest.fn() }));
jest.mock('../metrics', () => ({
  totalTransfers: { inc: jest.fn() },
  totalTransferVolume: { inc: jest.fn() },
  setActiveUsers: jest.fn(),
  setTotalBalance: jest.fn(),
  anomalyTransfers: { inc: jest.fn() },
}));
jest.mock('../anomaly', () => ({
  checkAnomaly: jest.fn(() => ({ isAnomaly: false, reason: null })),
}));
jest.mock('../transfers/token', () => ({
  generateTransferToken: jest.fn(),
  verifyTransferToken: jest.fn(),
}));
jest.mock('../middleware/auditLogger', () => jest.fn());
jest.mock('../utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/transferService', () => ({
  executeAtomicTransfer: jest.fn(),
  notifyTransferCompletion: jest.fn().mockResolvedValue(undefined),
}));

const database = require('../config/database');
const { executeAtomicTransfer, notifyTransferCompletion } = require('../services/transferService');
const router = require('../routes/transfers');

function mockResponse() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((name, value) => { res.headers[name] = value; return res; });
  return res;
}

async function callPost(options = {}) {
  const layer = router.stack.find((item) =>
    item.route && item.route.path === '/api/transfers' && item.route.methods.post
  );
  if (!layer) throw new Error('POST /api/transfers route missing');
  const res = mockResponse();
  const req = {
    method: 'POST',
    user: options.user || { id: 'sender-1', full_name: 'Sender One', role: 'user' },
    headers: options.headers || { 'idempotency-key': 'transfer-test-0001' },
    body: options.body || { amount: '12.30', recipient: 'recipient-1', currency: 'INR', method: 'internal' },
    ip: '127.0.0.1',
  };
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  database.findUserById.mockImplementation(async (id) => ({
    id,
    full_name: id === 'sender-1' ? 'Sender One' : 'Recipient One',
  }));
  database.findAccountByUserIdAndCurrency.mockImplementation(async (id, currency) => ({
    id: id === 'sender-1' ? 'account-sender' : 'account-recipient',
    user_id: id,
    account_number: id === 'sender-1' ? 'VB-SENDER' : 'VB-RECIPIENT',
    currency,
  }));
  executeAtomicTransfer.mockResolvedValue({
    transferId: 'transfer-1',
    senderBalance: '100.00',
    newSenderBalance: '87.70',
    recipientBalance: '12.30',
  });
});

describe('VaultBank native POST /api/transfers', () => {
  test('requires a stable idempotency key before reading user/account data', async () => {
    const { res } = await callPost({ headers: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(database.findUserById).not.toHaveBeenCalled();
    expect(executeAtomicTransfer).not.toHaveBeenCalled();
  });

  test('rejects non-native methods rather than labeling an internal transfer as an external payment', async () => {
    const { res } = await callPost({ body: { amount: '12.30', recipient: 'recipient-1', method: 'wire', currency: 'USD' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('NATIVE_INTERNAL_ONLY');
    expect(executeAtomicTransfer).not.toHaveBeenCalled();
  });

  test('rejects malformed decimal amounts before touching the ledger', async () => {
    const { res } = await callPost({ body: { amount: '1.001', recipient: 'recipient-1', currency: 'INR' } });
    expect(res.statusCode).toBe(400);
    expect(executeAtomicTransfer).not.toHaveBeenCalled();
  });

  test('executes INR transfers via the shared atomic ledger service', async () => {
    const { res } = await callPost();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(executeAtomicTransfer).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'sender-1',
      amount: '12.30',
      currency: 'INR',
      idempotencyKey: 'transfer-test-0001',
      senderAccount: expect.objectContaining({ id: 'account-sender' }),
      recipientAccount: expect.objectContaining({ id: 'account-recipient' }),
    }));
    expect(notifyTransferCompletion).toHaveBeenCalledTimes(1);
  });

  test('returns an ambiguous outcome without claiming success or sending notifications', async () => {
    executeAtomicTransfer.mockResolvedValue({
      ambiguous: true,
      code: 'TRANSFER_OUTCOME_UNKNOWN',
    });
    const { res } = await callPost();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('TRANSFER_OUTCOME_UNKNOWN');
    expect(notifyTransferCompletion).not.toHaveBeenCalled();
  });

  test('returns idempotent replays without posting another transfer notification', async () => {
    executeAtomicTransfer.mockResolvedValue({ transferId: 'transfer-1', replay: true });
    const { res } = await callPost();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Idempotent-Replay']).toBe('true');
    expect(res.body.replay).toBe(true);
    expect(notifyTransferCompletion).not.toHaveBeenCalled();
  });
});
