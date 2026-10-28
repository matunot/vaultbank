/**
 * INR rail schema fail-closed tests.
 *
 * The schema is part of the money contract: if a required unique index is
 * missing, the rails must return 503 and NO provider call / money SQL may run.
 */

const mockDb = {
    query: jest.fn(),
    getClient: jest.fn(),
    ensureConnection: jest.fn(),
};

jest.mock('../config/database', () => ({
    db: mockDb,
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
    authenticateToken: (req, res, next) => { req.user = { id: 'u-1', role: 'user' }; next(); },
    requireAdmin: (req, res, next) => next(),
}));
jest.mock('../collections/cashfree', () => ({
    configured: jest.fn(() => true),
    providerInfo: jest.fn(() => ({ provider: 'cashfree', configured: true, mode: 'sandbox', credentialValid: 'unverified', webhookReady: true, currency: 'INR' })),
    createVirtualAccount: jest.fn(),
    verifyWebhookSignature: jest.fn(() => false),
    parsePaymentWebhook: jest.fn(() => null),
}));
jest.mock('../payouts/cashfree', () => ({
    configured: jest.fn(() => true),
    providerInfo: jest.fn(() => ({ provider: 'cashfree', configured: true, mode: 'sandbox', credentialValid: 'unverified', webhookReady: false, reconciliation: 'pull-status-api', currency: 'INR' })),
    ensureBeneficiary: jest.fn(),
    requestTransfer: jest.fn(),
    getTransferStatus: jest.fn(),
    probeCredentials: jest.fn(),
}));

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    res.setHeader = jest.fn();
    return res;
}

async function call(router, path, { method = 'get', body, headers = {} } = {}) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer) throw new Error('route missing: ' + method.toUpperCase() + ' ' + path);
    const res = mkRes();
    const req = {
        method: method.toUpperCase(),
        user: { id: 'u-1', role: 'user' },
        ip: '127.0.0.1',
        headers,
        body: body !== undefined ? body : {},
        params: {},
        query: {},
    };
    const handlers = layer.route.stack.map((s) => s.handle);
    let chain = true;
    for (let m = 0; m < handlers.length - 1 && chain; m++) {
        chain = false;
        await handlers[m](req, res, () => { chain = true; });
    }
    if (chain) await handlers[handlers.length - 1](req, res, () => {});
    return res;
}

const INR_ACCOUNT = { id: 'acc-inr', user_id: 'u-1', currency: 'INR', balance: '500.00', available_balance: '500.00', status: 'active' };

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReset();
    mockDb.getClient.mockReset();
    mockDb.getClient.mockImplementation(async () => { throw new Error('getClient must not be called when the schema is not ready'); });
    process['env']['VB_PAYOUT_PROVIDER'] = 'cashfree';
});

describe('schema checks are fail-closed', () => {
    test('collections schema throws COLLECTIONS_SCHEMA_NOT_READY when a unique index is missing', async () => {
        jest.resetModules();
        const CDB = require('../config/database');
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('to_regclass')) return { rows: [{ ready: false }] };
            return { rows: [] };
        });
        const { ensureCollectionsSchema } = require('../collections/schema');
        await expect(ensureCollectionsSchema()).rejects.toMatchObject({ code: 'COLLECTIONS_SCHEMA_NOT_READY' });
        const sqls = CDB.db.query.mock.calls.map((c) => String(c[0]));
        expect(sqls.some((s) => s.includes('virtual_accounts_provider_va_uidx'))).toBe(true);
        expect(sqls.some((s) => s.includes('collection_events_provider_event_id_uidx'))).toBe(true);
    });

    test('payouts route returns 503 and never reserves when the idempotency index is missing', async () => {
        jest.resetModules();
        const CDB = require('../config/database');
        const cashfree = require('../payouts/cashfree');
        CDB.findUserById.mockResolvedValue({ id: 'u-1', full_name: 'A', email: 'a@example.com', phone: '9876543210' });
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('to_regclass')) return { rows: [{ ready: false }] };
            if (sql.includes('FROM accounts WHERE user_id')) return { rows: [INR_ACCOUNT] };
            return { rows: [] };
        });
        const router = require('../routes/external-payouts');
        const res = await call(router, '/api/payouts/requests', {
            method: 'post',
            body: { amount: '100.00', bankAccount: '001111222333', ifsc: 'HDFC0000001', address1: '123 Main Street', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001' },
            headers: { 'idempotency-key': 'schema-test-key' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('PAYOUTS_SCHEMA_NOT_READY');
        expect(CDB.db.getClient).not.toHaveBeenCalled();
        expect(cashfree.requestTransfer).not.toHaveBeenCalled();
        const sqls = CDB.db.query.mock.calls.map((c) => String(c[0]));
        expect(sqls.some((s) => s.includes('INSERT INTO payout_requests'))).toBe(false);
        expect(sqls.some((s) => s.includes('balance = balance - $2'))).toBe(false);
    });

    test('VBR intent creation returns 503 and inserts nothing when the intent index is missing', async () => {
        jest.resetModules();
        const CDB = require('../config/database');
        CDB.findAccountByUserIdAndCurrency.mockResolvedValue({ id: 'acc-usd', user_id: 'u-1', currency: 'USD', balance: '1000.00', available_balance: '1000.00', status: 'active' });
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('to_regclass')) return { rows: [{ ready: false }] };
            return { rows: [] };
        });
        const vbrRouter = require('../vbr');
        const res = await call(vbrRouter, '/api/vbr/intents', {
            method: 'post',
            body: { direction: 'send', method: 'internal', amount: '100.00', currency: 'USD' },
            headers: { 'idempotency-key': 'vbr-schema-key' },
        });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('VBR_SCHEMA_NOT_READY');
        expect(CDB.db.getClient).not.toHaveBeenCalled();
        const sqls = CDB.db.query.mock.calls.map((c) => String(c[0]));
        expect(sqls.some((s) => s.includes('INSERT INTO payment_intents'))).toBe(false);
    });
});

describe('schemaReadiness utility', () => {
    const { checkSchema, REQUIRED_MIGRATIONS, REQUIRED_TABLES, REQUIRED_INDEXES, REQUIRED_COLUMNS } = require('../utils/schemaReadiness');

    function fakeDb({ missingTable = null, missingIndex = null, nonUniqueIndex = null, missingColumn = null } = {}) {
        return {
            query: jest.fn(async (sql, params) => {
                if (sql.includes('to_regclass') && sql.includes('_migrations')) return { rows: [{ present: true }] };
                if (sql.includes('SELECT filename FROM _migrations')) {
                    return { rows: REQUIRED_MIGRATIONS.map((filename) => ({ filename })) };
                }
                if (sql.includes('t.name')) {
                    return { rows: params[0].map((name) => ({ name, present: name !== missingTable })) };
                }
                if (sql.includes('i.name')) {
                    return { rows: params[0].map((name) => ({ name, present: name !== missingIndex, is_unique: name !== nonUniqueIndex })) };
                }
                if (sql.includes('information_schema.columns')) {
                    const rows = [];
                    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
                        for (const col of cols) {
                            if (table === missingTable || (table === 'accounts' && col === missingColumn)) continue;
                            rows.push({ table_name: table, column_name: col });
                        }
                    }
                    return { rows };
                }
                throw new Error('unexpected SQL: ' + sql);
            }),
        };
    }

    test('reports ready:true only when every migration, table, index and column exists', async () => {
        const result = await checkSchema(fakeDb());
        expect(result.ready).toBe(true);
        expect(result.migrations.missing).toEqual([]);
        expect(REQUIRED_TABLES.every((t) => result.tables[t] === true)).toBe(true);
        expect(REQUIRED_INDEXES.every((i) => result.indexes[i] === true)).toBe(true);
    });

    test('missing unique index is not ready and names the index in a note', async () => {
        const result = await checkSchema(fakeDb({ missingIndex: 'payout_idempotency_user_key' }));
        expect(result.ready).toBe(false);
        expect(result.indexes.payout_idempotency_user_key).toBe(false);
        expect(result.notes.join(' ')).toContain('payout_idempotency_user_key');
    });

    test('same-named non-unique idempotency index is not ready', async () => {
        const result = await checkSchema(fakeDb({ nonUniqueIndex: 'payout_idempotency_user_key' }));
        expect(result.ready).toBe(false);
        expect(result.indexes.payout_idempotency_user_key).toBe(true);
        expect(result.indexUnique.payout_idempotency_user_key).toBe(false);
        expect(result.notes.join(' ')).toContain('not unique');
    });

    test('missing lazy collections table is not ready but explains that it is created on first use', async () => {
        const result = await checkSchema(fakeDb({ missingTable: 'virtual_accounts' }));
        expect(result.ready).toBe(false);
        expect(result.tables.virtual_accounts).toBe(false);
        expect(result.notes.join(' ')).toContain('created lazily');
    });

    test('missing required column is not ready', async () => {
        const result = await checkSchema(fakeDb({ missingColumn: 'available_balance' }));
        expect(result.ready).toBe(false);
        expect(result.columns.accounts.available_balance).toBe(false);
    });
});
