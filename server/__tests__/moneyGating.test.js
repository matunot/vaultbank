/**
 * REAL-FIAT GATING — production contract for the classic money routes.
 *
 * With NO authorized external rail behind them, these routes must FAIL CLOSED
 * in real-DB production mode (a database balance update is never proof of
 * external settlement):
 *   - /api/account/deposit  -> 503 DEPOSITS_USE_VERIFIED_RAIL (money enters
 *     only via bank-transfer instructions + admin-verified statements)
 *   - /api/account/withdraw -> 503 OUTBOUND_TRANSFERS_NOT_CONFIGURED (never
 *     debit and report success without a rail accepting the payout)
 *   - /api/credit/apply    -> 503 CREDIT_UNAVAILABLE (no authorized lender)
 *   - drawCredit            -> refuses to lend in real mode
 *   - /api/credit/repay    -> still services EXISTING owed balances
 *   - demo mode            -> the classic instant rails keep working
 *
 * 100% SIMULATED: database and middleware are scripted seams.
 */
// Mutable demo flag the mock factory reads via a getter (jest allows factory
// references to variables prefixed with "mock").
const mockState = { isDemo: false };
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
    get isDemo() { return mockState.isDemo; },
    findUserById: jest.fn(),
    findAccountByUserId: jest.fn(async () => ({ id: 'acc-1', user_id: 'u-1', balance: 100, currency: 'USD', held_balance: 0 })),
    createTransaction: jest.fn(async () => ({ id: 'tx-1' })),
    createNotification: jest.fn(async () => ({ id: 'n-1' })),
    createAuditLog: jest.fn(async () => ({ id: 'a-1' })),
    updateAccountBalance: jest.fn(async () => ({})),
    findAccountByNumber: jest.fn(),
    createTransfer: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => { if (!req.user) req.user = { id: 'u-1' }; next(); },
    requireAdmin: (req, res, next) => next(),
}));

const CDB = require('../config/database');
const accountsRouter = require('../routes/accounts');
const credit = require('../routes/credit');

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    return res;
}

async function call(router, path, body, method = 'post') {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer) throw new Error('route missing: ' + method.toUpperCase() + ' ' + path);
    const res = mkRes();
    const req = { method: method.toUpperCase(), body, user: { id: 'u-1' }, ip: '127.0.0.1', headers: {} };
    const handlers = layer.route.stack.map((s) => s.handle);
    // Middlewares run synchronously; a middleware that rejects (no next())
    // stops the chain. The final handler (the route) is AWAITED.
    let chain = true;
    for (let m = 0; m < handlers.length - 1 && chain; m++) {
        chain = false;
        await handlers[m](req, res, () => { chain = true; });
    }
    if (chain) {
        await handlers[handlers.length - 1](req, res, () => {});
    }
    return res;
}

beforeEach(() => {
    jest.clearAllMocks();
    CDB.findAccountByUserId.mockResolvedValue({ id: 'acc-1', user_id: 'u-1', balance: '100.00', currency: 'USD' });
    CDB.createTransaction.mockResolvedValue({ id: 'tx-1' });
    CDB.createNotification.mockResolvedValue({ id: 'n-1' });
    CDB.db.query.mockResolvedValue({ rows: [] });
});

describe('classic account rails fail closed in real-DB mode', () => {
    test('deposit: self-credit without a verified rail is refused (503, zero SQL)', async () => {
        const res = await call(accountsRouter, '/api/account/deposit', { amount: 5 });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('DEPOSITS_USE_VERIFIED_RAIL');
        expect(CDB.db.query).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('withdraw: no phantom payout success (503, zero SQL)', async () => {
        const res = await call(accountsRouter, '/api/account/withdraw', { amount: 5 });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('OUTBOUND_TRANSFERS_NOT_CONFIGURED');
        expect(CDB.db.query).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});

describe('credit is unavailable as a NEW lending product; servicing still works', () => {
    test('apply: no authorized lender -> 503, no underwriting, no credit row', async () => {
        const res = await call(credit, '/api/credit/apply', {});
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('CREDIT_UNAVAILABLE');
        const sqls = CDB.db.query.mock.calls.map((c) => String(c[0]));
        expect(sqls.some((s) => s.includes('INSERT INTO credit_accounts'))).toBe(false);
    });

    test('drawCredit refuses to lend in real mode', async () => {
        const out = await credit.drawCredit('u-1', 50, 'card purchase');
        expect(out.drawn).toBe(0);
        expect(out.reason).toBe('credit-unavailable');
        expect(CDB.db.query).not.toHaveBeenCalled();
    });

    test('repay: existing owed balance is still serviceable (guarded debit)', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM credit_accounts')) {
                return { rows: [{ id: 'cr-1', user_id: 'u-1', credit_limit: '2000.00', balance_owed: '150.00', apr: '19.99', status: 'active' }] };
            }
            if (sql.includes('balance = balance - $2')) {
                return { rows: [{ balance: '90.00' }] };
            }
            if (sql.includes('UPDATE credit_accounts SET balance_owed')) {
                return { rows: [{ balance_owed: '50.00' }] };
            }
            return { rows: [] };
        });
        const res = await call(credit, '/api/credit/repay', { amount: 100 });
        expect(res.code).toBeNull(); // implicit 200 — the route replies with res.json
        expect(res.body.success).toBe(true);
        expect(res.body.paid).toBe(100);
        expect(res.body.balanceOwed).toBe(50);
    });
});

describe('demo platform keeps the classic instant rails (regression)', () => {
    test('demo deposit still credits instantly', async () => {
        mockState.isDemo = true;
        try {
            jest.resetModules();
            const demoRouter = require('../routes/accounts');
            const res = await call(demoRouter, '/api/account/deposit', { amount: 5 });
            expect(res.code).toBeNull();
            expect(res.body.success).toBe(true);
            expect(res.body.balance.current).toBe(105);
        } finally {
            mockState.isDemo = false;
            jest.resetModules();
        }
    });

    test('demo withdraw still works', async () => {
        mockState.isDemo = true;
        try {
            jest.resetModules();
            const demoRouter = require('../routes/accounts');
            const res = await call(demoRouter, '/api/account/withdraw', { amount: 5 });
            expect(res.code).toBeNull();
            expect(res.body.success).toBe(true);
            expect(res.body.balance.current).toBe(95);
        } finally {
            mockState.isDemo = false;
            jest.resetModules();
        }
    });
});
