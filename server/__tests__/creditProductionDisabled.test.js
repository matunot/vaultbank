jest.mock('../config/database', () => ({
  db: {
    query: jest.fn(),
    ensureConnection: jest.fn(),
    getClient: jest.fn(),
  },
  isDemo: false,
  findAccountByUserId: jest.fn(),
  createNotification: jest.fn(),
  createTransaction: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => next(),
}));

const { db } = require('../config/database');
const creditRouter = require('../routes/credit');

function makeResponse() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

async function invoke(path, method = 'post') {
  const layer = creditRouter.stack.find((item) =>
    item.route && item.route.path === path && item.route.methods[method]
  );
  if (!layer) throw new Error('Credit route missing: ' + method.toUpperCase() + ' ' + path);
  const res = makeResponse();
  const req = {
    method: method.toUpperCase(),
    user: { id: 'customer-1' },
    body: { amount: 50, autopay: true },
    params: {},
    query: {},
  };
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await handler(req, res, () => {});
  return res;
}

describe('unfunded credit is fail-closed in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test.each([
    ['/api/credit/status', 'get'],
    ['/api/credit/apply', 'post'],
    ['/api/credit/repay', 'post'],
    ['/api/credit/autopay', 'post'],
  ])('%s is disabled before any database change', async (path, method) => {
    process.env.NODE_ENV = 'production';
    const res = await invoke(path, method);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'CREDIT_UNAVAILABLE' });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.getClient).not.toHaveBeenCalled();
  });

  test('credit automation schedules no interest/autopay work in production', () => {
    process.env.NODE_ENV = 'production';
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const intervalSpy = jest.spyOn(global, 'setInterval');
    creditRouter.startCreditAutomation();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});
