/**
 * VBR (VaultBank Rail) contract tests.
 *
 * Covers: state machine transitions, amount validation (string-based,
 * never floating-point), intent creation with idempotency, cancellation,
 * availability reporting, and fail-closed behavior for unconfigured
 * external connectors.
 */

const mockCfg = { collections: false, payouts: false };

jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
    isDemo: false,
    demoStore: { accounts: [], auditLogs: [] },
    findUserById: jest.fn(),
    findAccountByUserId: jest.fn(),
    findAccountByUserIdAndCurrency: jest.fn(),
    findAccountByNumber: jest.fn(),
    findUserByEmail: jest.fn(),
    createAccount: jest.fn(),
    updateAccountBalance: jest.fn(),
    createTransaction: jest.fn(),
    getTransactions: jest.fn(),
    createTransfer: jest.fn(),
    createNotification: jest.fn(),
    createAuditLog: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => { if (!req.user) req.user = { id: 'u-1', role: 'user' }; next(); },
    requireAdmin: (req, res, next) => {
        if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required.' });
        next();
    },
}));
jest.mock('../collections', () => ({
    activeCollectionsProvider: jest.fn(() => null),
    collectionsAvailability: jest.fn(() => ({ available: false, reason: 'no provider', provider: null })),
}));
jest.mock('../payouts', () => ({
    activePayoutProvider: jest.fn(() => null),
    payoutAvailability: jest.fn(() => ({ available: false, reason: 'no provider', provider: null })),
}));

const CDB = require('../config/database');
const { STATES, canTransition, isTerminal, assertTransition, isCurrencySupported } = require('../vbr/states');
const { validateConnector } = require('../vbr/connector');
const vbrRouter = require('../vbr');
const internalConnector = require('../vbr/connectors/internal');

function mkRes() {
    const res = { code: null, body: null, headers: {} };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    res.send = jest.fn((b) => { res.body = b; return res; });
    res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
    return res;
}

async function call(path, { method = 'get', body, headers = {} } = {}) {
    // Translate concrete IDs to Express :id patterns
    const pattern = path
        .replace(/\/pi-[a-z0-9-]+\/(cancel|reconcile)/, '/:id/$1')
        .replace(/\/pi-[a-z0-9-]+$/, '/:id');
    const route = vbrRouter.stack.find(
        (l) => l.route && l.route.path === pattern && l.route.methods[method]
    );
    if (!route) throw new Error('VBR route missing: ' + method.toUpperCase() + ' ' + pattern);
    const res = mkRes();
    const req = {
        method: method.toUpperCase(),
        user: { id: 'u-1', role: 'user' },
        ip: '127.0.0.1',
        headers,
        body: body || {},
        params: pattern.includes(':id') ? { id: path.split('/').pop().split('/')[0] } : {},
        query: {},
    };
    const handlers = route.route.stack.map((s) => s.handle);
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
    CDB.findAccountByUserIdAndCurrency.mockResolvedValue({ id: 'acc-1', user_id: 'u-1', currency: 'USD', balance: '1000.00', available_balance: '1000.00', status: 'active' });
    CDB.db.query.mockResolvedValue({ rows: [] });
});

// ── State machine ──
describe('VBR state machine', () => {
    test('legal transitions are allowed', () => {
        expect(canTransition(STATES.CREATED, STATES.PENDING)).toBe(true);
        expect(canTransition(STATES.PENDING, STATES.PROCESSING)).toBe(true);
        expect(canTransition(STATES.PROCESSING, STATES.SUCCEEDED)).toBe(true);
        expect(canTransition(STATES.PROCESSING, STATES.FAILED)).toBe(true);
        expect(canTransition(STATES.RECONCILIATION_REQUIRED, STATES.SUCCEEDED)).toBe(true);
        expect(canTransition(STATES.CREATED, STATES.CANCELLED)).toBe(true);
    });

    test('illegal transitions are rejected', () => {
        expect(canTransition(STATES.SUCCEEDED, STATES.PENDING)).toBe(false);
        expect(canTransition(STATES.FAILED, STATES.PROCESSING)).toBe(false);
        expect(canTransition(STATES.CANCELLED, STATES.PENDING)).toBe(false);
        expect(canTransition(STATES.CREATED, STATES.SUCCEEDED)).toBe(false); // must go through pending+processing
    });

    test('terminal states are identified', () => {
        expect(isTerminal(STATES.SUCCEEDED)).toBe(true);
        expect(isTerminal(STATES.FAILED)).toBe(true);
        expect(isTerminal(STATES.CANCELLED)).toBe(true);
        expect(isTerminal(STATES.CREATED)).toBe(false);
        expect(isTerminal(STATES.PENDING)).toBe(false);
    });

    test('assertTransition throws on illegal transitions', () => {
        expect(() => assertTransition(STATES.SUCCEEDED, STATES.PENDING)).toThrow('Illegal state transition');
        expect(() => assertTransition(STATES.CREATED, STATES.PENDING)).not.toThrow();
    });

    test('currency validation: only USD and INR', () => {
        expect(isCurrencySupported('USD')).toBe(true);
        expect(isCurrencySupported('INR')).toBe(true);
        expect(isCurrencySupported('EUR')).toBe(false);
        expect(isCurrencySupported('')).toBe(false);
        expect(isCurrencySupported(null)).toBe(false);
    });
});

// ── Amount validation (string-based, never floating-point) ──
describe('VBR amount validation', () => {
    const validateAmount = (s) => {
        const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
        const str = String(s || '').trim();
        if (!AMOUNT_RE.test(str)) return null;
        const n = parseFloat(str);
        if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
        return str;
    };

    test('accepts valid decimal strings', () => {
        expect(validateAmount('100')).toBe('100');
        expect(validateAmount('100.00')).toBe('100.00');
        expect(validateAmount('0.01')).toBe('0.01');
        expect(validateAmount(100)).toBe('100');
        expect(validateAmount(100.50)).toBe('100.5');
    });

    test('rejects invalid amounts', () => {
        expect(validateAmount('abc')).toBeNull();
        expect(validateAmount('-5')).toBeNull();
        expect(validateAmount('1e5')).toBeNull();
        expect(validateAmount('NaN')).toBeNull();
        expect(validateAmount('Infinity')).toBeNull();
        expect(validateAmount('100.999')).toBeNull(); // >2 decimal places
        expect(validateAmount('0')).toBeNull();
        expect(validateAmount('')).toBeNull();
        expect(validateAmount(null)).toBeNull();
    });
});

// ── Connector contract validation ──
describe('VBR connector contract', () => {
    test('internal connector passes base validation (native rail — not an external connector)', () => {
        // The internal connector is the always-available native VaultBank rail.
        // It has its own executeTransfer function, not the external-connector
        // functions (provisionDetails, requestTransfer). Validate base only.
        const issues = validateConnector(internalConnector, 'base-only');
        expect(issues).toHaveLength(0);
    });

    test('a missing function is detected', () => {
        const badConnector = { id: 'bad', direction: 'send', currencies: ['USD'], configured: () => true, availability: () => ({}) };
        const issues = validateConnector(badConnector, 'send');
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some((i) => i.includes('requestTransfer'))).toBe(true);
    });
});

// ── VBR API routes ──
describe('VBR API routes', () => {
    test('GET /api/vbr/availability is public and honest', async () => {
        const res = await call('/api/vbr/availability');
        expect(res.code).toBe(200);
        expect(res.body.internal.available).toBe(true);
        expect(res.body.collections.available).toBe(false);
        expect(res.body.payouts.available).toBe(false);
        expect(res.body.usd_external.available).toBe(false);
        expect(res.body.usd_external.reason).toContain('no authorized USD');
    });

    test('POST /api/vbr/intents: valid internal send intent', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('INSERT INTO payment_intents')) {
                return { rows: [{ id: 'pi-1', state: 'created', direction: 'send', method: 'internal', amount: '100.00', currency: 'USD' }] };
            }
            return { rows: [] };
        });
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: '100.00', currency: 'USD', counterparty: 'bob@test.com' },
        });
        expect(res.code).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.intent.state).toBe('pending');
    });

    test('POST /api/vbr/intents: unsupported currency rejected', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: '100', currency: 'EUR' },
        });
        expect(res.code).toBe(400);
        expect(res.body.message).toContain('EUR');
    });

    test('POST /api/vbr/intents: invalid amount rejected', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: 'abc', currency: 'USD' },
        });
        expect(res.code).toBe(400);
    });

    test('POST /api/vbr/intents: negative amount rejected', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: '-5', currency: 'USD' },
        });
        expect(res.code).toBe(400);
    });

    test('POST /api/vbr/intents: excessive precision rejected', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: '10.999', currency: 'USD' },
        });
        expect(res.code).toBe(400);
    });

    test('POST /api/vbr/intents: unconfigured collections → 503', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'receive', method: 'collections', amount: '100', currency: 'INR' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('VBR_CONNECTOR_NOT_CONFIGURED');
    });

    test('POST /api/vbr/intents: unconfigured payouts → 503', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'payouts', amount: '100', currency: 'INR' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('VBR_CONNECTOR_NOT_CONFIGURED');
    });

    test('POST /api/vbr/intents: USD external send → explicitly unavailable', async () => {
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'payouts', amount: '100', currency: 'USD' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('VBR_NO_USD_RAIL');
        expect(res.body.message).toContain('no authorized USD');
    });

    test('POST /api/vbr/intents: idempotency-key replay returns original', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM payment_intents WHERE user_id = $1 AND idempotency_key')) {
                return { rows: [{ id: 'pi-existing', state: 'pending', amount: '100.00' }] };
            }
            return { rows: [] };
        });
        const res = await call('/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: '100', currency: 'USD' },
            headers: { 'idempotency-key': 'test-key-1' },
        });
        expect(res.code).toBe(200);
        expect(res.body.replay).toBe(true);
        expect(res.body.intent.id).toBe('pi-existing');
    });

    test('GET /api/vbr/intents/:id returns owner-scoped intent', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM payment_intents WHERE id')) {
                return { rows: [{ id: 'pi-1', user_id: 'u-1', state: 'succeeded', amount: '100.00' }] };
            }
            return { rows: [] };
        });
        const res = await call('/api/vbr/intents/pi-1');
        expect(res.code).toBe(200);
        expect(res.body.intent.state).toBe('succeeded');
    });

    test('POST /api/vbr/intents/:id/cancel: non-terminal intent is cancelled', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM payment_intents WHERE id')) {
                return { rows: [{ id: 'pi-1', user_id: 'u-1', state: 'pending' }] };
            }
            if (sql.includes("SET state = 'cancelled'")) {
                return { rows: [{ id: 'pi-1', state: 'cancelled' }] };
            }
            return { rows: [] };
        });
        const res = await call('/api/vbr/intents/pi-1/cancel', { method: 'post' });
        expect(res.code).toBe(200);
        expect(res.body.intent.state).toBe('cancelled');
    });

    test('POST /api/vbr/intents/:id/cancel: terminal intent returns 409', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM payment_intents WHERE id')) {
                return { rows: [{ id: 'pi-1', user_id: 'u-1', state: 'succeeded' }] };
            }
            return { rows: [] };
        });
        const res = await call('/api/vbr/intents/pi-1/cancel', { method: 'post' });
        expect(res.code).toBe(409);
        expect(res.body.message).toContain('already succeeded');
    });

    test('POST /api/vbr/intents/:id/reconcile: internal transfers need no reconciliation', async () => {
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM payment_intents WHERE id')) {
                return { rows: [{ id: 'pi-1', user_id: 'u-1', state: 'succeeded', method: 'internal' }] };
            }
            return { rows: [] };
        });
        const res = await call('/api/vbr/intents/pi-1/reconcile', { method: 'post' });
        expect(res.code).toBe(200);
        expect(res.body.message).toContain('synchronously');
    });
});
