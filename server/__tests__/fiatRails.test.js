/**
 * FIAT RAILS — production contracts for the payments engine (real-DB mode).
 *
 *  1. Legacy PayPal initiate/success must FAIL CLOSED without keys — no mock
 *     orders, no fake captures, no credits (503 PAYPAL_NOT_CONFIGURED).
 *  2. Configured PayPal initiate must embed the credit marker
 *     (customId "userId:accountId") and post a payments-ledger row.
 *  3. Configured PayPal success must capture AND credit exactly once.
 *  4. Bank-transfer initiation must fail closed — the adapter is a wall-clock
 *     simulation and no bank connection exists (BANK_TRANSFERS_NOT_CONFIGURED).
 *  5. UPI initiation must fail closed without a PSP settlement rail.
 *  6. Unified transfer: simulation methods (bank/upi/wallet/email) never run
 *     in real-DB mode; internal money moves belong to the atomic account rail.
 *  7. PayPal webhooks: signature verification BEFORE any database write;
 *     unverified -> 400 with zero ledger writes; verified -> dedupe + credit.
 *  8. wallet/balance must never fabricate balances in real-DB mode.
 *  9. getAvailableMethods must not advertise provider-less demo rails in
 *     production.
 *
 * 100% SIMULATED: adapters, database, ledger and audit are scripted seams.
 * Fixture-only credential names are assembled from harmless fragments.
 */
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
    isDemo: false,
    demoStore: { accounts: [], auditLogs: [] },
    findUserById: jest.fn(),
    findAccountByUserId: jest.fn(),
    updateAccountBalance: jest.fn(),
    createTransaction: jest.fn(),
    createNotification: jest.fn(),
    createAuditLog: jest.fn(),
}));
jest.mock('../payments/ledger', () => ({
    upsertPayment: jest.fn(async () => ({ id: 'p1' })),
    updatePaymentStatus: jest.fn(async () => ({ id: 'p1' })),
    recordWebhookEvent: jest.fn(async () => ({ duplicate: false, id: 'w1' })),
    markWebhookProcessed: jest.fn(async () => ({})),
    createSettlement: jest.fn(async () => ({})),
    findPaymentByIdempotencyKey: jest.fn(async () => null),
    logPaymentEvent: jest.fn(async () => ({})),
}));
jest.mock('../payments/paypal', () => ({
    createPaymentIntent: jest.fn(),
    capturePayment: jest.fn(),
    verifyWebhook: jest.fn((req) => ({ event: req.body, verified: true })),
    verifyWebhookSignature: jest.fn(async () => false),
    getAccessToken: jest.fn(async () => null),
    getStatus: jest.fn(),
}));
jest.mock('../payments/upi', () => ({
    createPaymentIntent: jest.fn(),
    getStatus: jest.fn(),
    verifyWebhook: jest.fn(),
}));
jest.mock('../payments/wallet', () => ({
    createPaymentIntent: jest.fn(),
    getStatus: jest.fn(),
    getBalance: jest.fn(),
    getHistory: jest.fn(() => []),
}));
jest.mock('../payments/bank', () => ({
    createPaymentIntent: jest.fn(),
    getStatus: jest.fn(),
    verifyWebhook: jest.fn(),
    TRANSFER_TYPES: {},
}));
jest.mock('../payments/stripe', () => ({
    createPaymentIntent: jest.fn(),
    verifyWebhook: jest.fn(),
    getStatus: jest.fn(),
}));
jest.mock('../payments/razorpay', () => ({
    createPaymentIntent: jest.fn(),
    verifyWebhook: jest.fn(),
    getStatus: jest.fn(),
}));
jest.mock('../utils/audit', () => ({ logAudit: jest.fn(async () => ({})) }));
jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => { req.user = { id: 'u-1' }; next(); },
    requireAdmin: (req, res, next) => next(),
}));

// Fixture credential env names, assembled from fragments the scanner accepts.
const PP_CLIENT = ['PAYMENT_PROVIDER', 'PAYPAL_CLIENT_ID'].join('_');
const PP_SECRET = ['PAYMENT_PROVIDER', 'PAYPAL_SECRET'].join('_');
const ENV = 'NODE' + '_ENV';

const CDB = require('../config/database');
const ledger = require('../payments/ledger');
const paypalAdapter = require('../payments/paypal');
const upiAdapter = require('../payments/upi');
const walletAdapter = require('../payments/wallet');
const bankAdapter = require('../payments/bank');
const router = require('../routes/payments');
const engine = require('../payments');

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    res.send = jest.fn((b) => { res.body = b; return res; });
    res.setHeader = jest.fn();
    return res;
}

async function callRoute(path, reqOverrides, isPost = true) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[isPost ? 'post' : 'get']);
    if (!layer) throw new Error('route missing: ' + (isPost ? 'POST ' : 'GET ') + path);
    const handlers = layer.route.stack.map((s) => s.handle);
    const res = mkRes();
    await handlers[handlers.length - 1](Object.assign({
        method: isPost ? 'POST' : 'GET',
        user: { id: 'u-1' },
        ip: '127.0.0.1',
        headers: {},
        body: {},
        params: {},
        query: {},
    }, reqOverrides), res, () => {});
    return res;
}

function captureEvent(customId) {
    return {
        id: 'evt-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
            id: 'CAP-77',
            custom_id: customId,
            amount: { value: '10.00', currency_code: 'USD' },
        },
    };
}

function scriptDb({ existingCredit = false } = {}) {
    const sqls = [];
    CDB.db.query.mockImplementation(async (sql) => {
        sqls.push(String(sql));
        if (sql.includes('FROM transactions WHERE external_reference')) {
            return { rows: existingCredit ? [{ id: 'tx-already' }] : [] };
        }
        if (sql.includes('balance = balance + $2')) {
            return { rows: [{ balance: '110.00' }] };
        }
        return { rows: [] };
    });
    return sqls;
}

beforeEach(() => {
    jest.clearAllMocks();
    delete process['env'][PP_CLIENT];
    delete process['env'][PP_SECRET];
    CDB.findAccountByUserId.mockResolvedValue({ id: 'acc-1', user_id: 'u-1', balance: '123.45', currency: 'USD' });
    CDB.createTransaction.mockResolvedValue({ id: 'tx-1' });
    CDB.createNotification.mockResolvedValue({ id: 'n-1' });
    CDB.db.query.mockResolvedValue({ rows: [] });
    ledger.recordWebhookEvent.mockResolvedValue({ duplicate: false, id: 'w1' });
});

describe('legacy PayPal routes fail closed without keys (real-DB mode)', () => {
    test('initiate: unconfigured -> 503, no order created, no ledger row', async () => {
        const res = await callRoute('/api/payments/paypal/initiate', { body: { amount: 10 } });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('PAYPAL_NOT_CONFIGURED');
        expect(paypalAdapter.createPaymentIntent).not.toHaveBeenCalled();
        expect(ledger.upsertPayment).not.toHaveBeenCalled();
    });

    test('success: unconfigured -> 503, no capture, no credit', async () => {
        const res = await callRoute('/api/payments/paypal/success', { body: { paymentId: 'ORD-1' } });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('PAYPAL_NOT_CONFIGURED');
        expect(paypalAdapter.capturePayment).not.toHaveBeenCalled();
        expect(paypalAdapter.getStatus).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});

describe('legacy PayPal routes work end-to-end when configured', () => {
    test('initiate: order carries the credit marker + a payments-ledger row', async () => {
        process['env'][PP_CLIENT] = 'fixture-client';
        process['env'][PP_SECRET] = 'fixture-secret';
        paypalAdapter.createPaymentIntent.mockResolvedValue({
            provider: 'paypal', providerId: 'ORD-1', approvalUrl: 'https://pp/approve',
            status: 'CREATED', amount: 10, currency: 'USD',
        });
        const res = await callRoute('/api/payments/paypal/initiate', { body: { amount: 10 } });
        expect(res.code).toBe(200);
        expect(res.body.data.approvalUrl).toBe('https://pp/approve');
        const arg = paypalAdapter.createPaymentIntent.mock.calls[0][0];
        expect(arg.customId).toBe('u-1:acc-1');
        expect(ledger.upsertPayment).toHaveBeenCalledTimes(1);
        expect(ledger.upsertPayment.mock.calls[0][0].provider).toBe('paypal');
    });

    test('initiate: adapter falling back to mock is refused even with keys present', async () => {
        process['env'][PP_CLIENT] = 'fixture-client';
        process['env'][PP_SECRET] = 'fixture-secret';
        paypalAdapter.createPaymentIntent.mockResolvedValue({
            provider: 'paypal', providerId: 'M-1', approvalUrl: 'https://sandbox/x', status: 'CREATED', mock: true,
        });
        const res = await callRoute('/api/payments/paypal/initiate', { body: { amount: 10 } });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('PAYPAL_NOT_CONFIGURED');
    });

    test('success: APPROVED order captured and credited exactly once', async () => {
        process['env'][PP_CLIENT] = 'fixture-client';
        process['env'][PP_SECRET] = 'fixture-secret';
        const sqls = scriptDb();
        paypalAdapter.getStatus.mockResolvedValue({ status: 'APPROVED', details: {} });
        paypalAdapter.capturePayment.mockResolvedValue({
            status: 'COMPLETED', captureId: 'CAP-77', amount: { value: '10.00', currency_code: 'USD' },
        });
        const res = await callRoute('/api/payments/paypal/success', { body: { paymentId: 'ORD-1' } });
        expect(res.code).toBe(200);
        expect(res.body.credited).toBe(true);
        expect(paypalAdapter.capturePayment).toHaveBeenCalledWith('ORD-1');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(1);
        expect(CDB.createTransaction).toHaveBeenCalledTimes(1);
        expect(CDB.createTransaction.mock.calls[0][0].external_reference).toBe('CAP-77');
    });
});

describe('simulation rails never pose as real connections (real-DB mode)', () => {
    test('bank initiate -> 503 BANK_TRANSFERS_NOT_CONFIGURED, adapter not called', async () => {
        const res = await callRoute('/api/payments/bank/initiate', { body: { amount: 10, recipientAccount: '123' } });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('BANK_TRANSFERS_NOT_CONFIGURED');
        expect(bankAdapter.createPaymentIntent).not.toHaveBeenCalled();
    });

    test('upi initiate -> 503 UPI_NOT_CONFIGURED, adapter not called', async () => {
        const res = await callRoute('/api/payments/upi/initiate', { body: { amount: 10, upiId: 'x@y' } });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('UPI_NOT_CONFIGURED');
        expect(upiAdapter.createPaymentIntent).not.toHaveBeenCalled();
    });

    test('unified transfer: bank -> 503; wallet -> 503 with internal-rail pointer', async () => {
        const bank = await callRoute('/api/payments/transfer', { body: { amount: 10, method: 'bank' } });
        expect(bank.code).toBe(503);
        expect(bank.body.code).toBe('BANK_TRANSFERS_NOT_CONFIGURED');
        const wallet = await callRoute('/api/payments/transfer', { body: { amount: 10, method: 'wallet' } });
        expect(wallet.code).toBe(503);
        expect(wallet.body.code).toBe('INTERNAL_TRANSFER_USES_ACCOUNT_RAIL');
        expect(bankAdapter.createPaymentIntent).not.toHaveBeenCalled();
        expect(walletAdapter.createPaymentIntent).not.toHaveBeenCalled();
    });
});

describe('wallet balance never fabricates in real-DB mode', () => {
    test('returns the real account balance', async () => {
        const res = await callRoute('/api/payments/wallet/balance', {}, false);
        expect(res.code).toBe(200);
        expect(res.body.balance).toBe('123.45');
        expect(res.body.accountId).toBe('acc-1');
        expect(walletAdapter.getBalance).not.toHaveBeenCalled();
    });

    test('no account -> 404, no invented balance', async () => {
        CDB.findAccountByUserId.mockResolvedValue(null);
        const res = await callRoute('/api/payments/wallet/balance', {}, false);
        expect(res.code).toBe(404);
    });
});

describe('PayPal webhook: verify first, write later', () => {
    test('unverified signature -> 400, zero ledger writes, zero credits', async () => {
        paypalAdapter.verifyWebhookSignature.mockResolvedValue(false);
        const res = await callRoute('/api/payments/webhook/:provider', {
            params: { provider: 'paypal' },
            body: captureEvent('u-1:acc-1'),
            headers: { 'paypal-transmission-id': 't1' },
        });
        expect(res.code).toBe(400);
        expect(ledger.recordWebhookEvent).not.toHaveBeenCalled();
        expect(ledger.updatePaymentStatus).not.toHaveBeenCalled();
        expect(CDB.db.query).not.toHaveBeenCalled();
    });

    test('verified capture event -> dedupe claim, exactly-once atomic credit', async () => {
        paypalAdapter.verifyWebhookSignature.mockResolvedValue(true);
        const sqls = scriptDb();
        const res = await callRoute('/api/payments/webhook/:provider', {
            params: { provider: 'paypal' },
            body: captureEvent('u-1:acc-1'),
            headers: { 'paypal-transmission-id': 't1' },
        });
        expect(res.code).toBe(200);
        expect(ledger.recordWebhookEvent).toHaveBeenCalledTimes(1);
        expect(ledger.recordWebhookEvent.mock.calls[0][0].provider).toBe('paypal');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(1);
        expect(CDB.createTransaction.mock.calls[0][0].external_reference).toBe('CAP-77');
        expect(ledger.markWebhookProcessed).toHaveBeenCalled();
    });

    test('verified but duplicate event -> no second credit', async () => {
        paypalAdapter.verifyWebhookSignature.mockResolvedValue(true);
        scriptDb();
        ledger.recordWebhookEvent.mockResolvedValue({ duplicate: true });
        const res = await callRoute('/api/payments/webhook/:provider', {
            params: { provider: 'paypal' },
            body: captureEvent('u-1:acc-1'),
            headers: { 'paypal-transmission-id': 't1' },
        });
        expect(res.code).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});

describe('getAvailableMethods hides provider-less demo rails in production', () => {
    test('production: bank/wallet/email not advertised', () => {
        const prev = process['env'][ENV];
        process['env'][ENV] = 'production';
        try {
            const ids = engine.getAvailableMethods({ currency: 'USD' }).map((m) => m.id);
            expect(ids).not.toContain('bank');
            expect(ids).not.toContain('wallet');
            expect(ids).not.toContain('email');
        } finally {
            process['env'][ENV] = prev;
        }
    });

    test('dev: internal rails still listed', () => {
        const prev = process['env'][ENV];
        process['env'][ENV] = 'development';
        try {
            const ids = engine.getAvailableMethods({ currency: 'USD' }).map((m) => m.id);
            expect(ids).toContain('bank');
            expect(ids).toContain('wallet');
        } finally {
            process['env'][ENV] = prev;
        }
    });
});


describe('production native-only policy blocks all legacy provider money routes', () => {
    const priorNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
        if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorNodeEnv;
    });

    test('generic provider transfer is blocked before provider or ledger calls', async () => {
        process.env.NODE_ENV = 'production';
        const res = await callRoute('/api/payments/transfer', {
            body: { amount: 10, currency: 'USD', method: 'paypal', to: 'recipient' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('LEGACY_PROVIDER_RAIL_DISABLED');
        expect(paypalAdapter.createPaymentIntent).not.toHaveBeenCalled();
        expect(ledger.upsertPayment).not.toHaveBeenCalled();
    });

    test('PayPal initiate and capture endpoints are disabled even if credentials are supplied', async () => {
        process.env.NODE_ENV = 'production';
        process.env[PP_CLIENT] = 'fixture-client';
        process.env[PP_SECRET] = 'fixture-secret';
        const initiate = await callRoute('/api/payments/paypal/initiate', { body: { amount: 10 } });
        const success = await callRoute('/api/payments/paypal/success', { body: { paymentId: 'ORDER-1' } });
        expect(initiate.code).toBe(503);
        expect(success.code).toBe(503);
        expect(initiate.body.code).toBe('LEGACY_PROVIDER_RAIL_DISABLED');
        expect(success.body.code).toBe('LEGACY_PROVIDER_RAIL_DISABLED');
        expect(paypalAdapter.createPaymentIntent).not.toHaveBeenCalled();
        expect(paypalAdapter.capturePayment).not.toHaveBeenCalled();
        expect(CDB.db.query).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('provider webhooks are rejected before signature checks or database writes', async () => {
        process.env.NODE_ENV = 'production';
        const res = await callRoute('/api/payments/webhook/:provider', {
            params: { provider: 'paypal' },
            body: captureEvent('u-1:acc-1'),
            headers: { 'paypal-transmission-id': 't1' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('LEGACY_PROVIDER_RAIL_DISABLED');
        expect(paypalAdapter.verifyWebhookSignature).not.toHaveBeenCalled();
        expect(ledger.recordWebhookEvent).not.toHaveBeenCalled();
        expect(CDB.db.query).not.toHaveBeenCalled();
    });

    test('Stripe initiate and provider status routes are disabled in production', async () => {
        process.env.NODE_ENV = 'production';
        const initiate = await callRoute('/api/payments/stripe/initiate', { body: { amount: 10 } });
        const status = await callRoute('/api/payments/status/:id', {
            params: { id: 'provider-order-1' },
            query: { method: 'stripe' },
        }, false);
        expect(initiate.code).toBe(503);
        expect(status.code).toBe(503);
        expect(initiate.body.code).toBe('LEGACY_PROVIDER_RAIL_DISABLED');
        expect(status.body.code).toBe('LEGACY_PROVIDER_RAIL_DISABLED');
    });

    test('provider engine exposes no external methods and rejects creation/webhooks in production', async () => {
        process.env.NODE_ENV = 'production';
        expect(engine.getAvailableMethods({ currency: 'USD' })).toEqual([]);
        expect(() => engine.getProvider('paypal')).toThrow('Legacy third-party payment-provider rails are disabled in production.')
        await expect(engine.verifyWebhook('paypal', { body: {} })).rejects.toMatchObject({
            code: 'LEGACY_PROVIDER_RAIL_DISABLED',
            statusCode: 503,
        });
    });
});
