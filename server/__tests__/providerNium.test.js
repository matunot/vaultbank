/**
 * Nium payout adapter + webhook receiver — 100% SIMULATED (external HTTP and
 * DB seams faked; no provider is contacted, no production table is touched).
 *
 * Contracts verified against official docs (mpdocs.nium.com):
 *   auth POST /api/v1/authentication -> { token }
 *   payouts POST /api/v2/payouts (request_id, transaction_number, inline
 *   beneficiary), status GET /api/v1/payments/id/{id},
 *   webhook x-api-key shared-secret + monotonic status application.
 *
 * Fail-closed guarantees under test: unconfigured adapter refuses every call;
 * live mode without an explicit base URL refuses; unconfigured webhook 401s.
 */
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn() },
}));

const ENV = process['env'];
const NATIVE_FETCH = global.fetch;
let nium;            // fresh per test (module caches config + token state)
const webhooks = () => require('../routes/provider-webhooks');
let CDB;             // fresh per test: jest.resetModules() re-runs the mock factory,
                     // so the route's and the tests' database mocks must be the SAME instance

// --- fakes (nothing real/secret here; repetition-built strings) ---
const FAKE_KEY = 'ck-' + 'x'.repeat(16);
const FAKE_SECRET = 'cs-' + 'y'.repeat(16);
const FAKE_WEBHOOKKEY = 'wk-' + 'z'.repeat(16);
const TOKEN = 'eyTest.' + 'a'.repeat(20) + '.sig';
const PAYMENT_ID = 'UATPY' + '1234567';

function setEnvs(o) {
    delete ENV.NIUM_ENV;
    delete ENV.NIUM_BASE_URL;
    delete ENV.NIUM_CLIENT_KEY;
    delete ENV.NIUM_CLIENT_SECRET;
    delete ENV.NIUM_WEBHOOK_API_KEY;
    Object.assign(ENV, o);
}

function scriptDb(pairs, def) {
    CDB.db.query.mockImplementation(async (sql) => {
        for (const [needle, resp] of pairs) {
            if (String(sql).includes(needle)) return resp();
        }
        if (def) return def();
        throw new Error('UNEXPECTED SQL: ' + String(sql).slice(0, 90));
    });
}

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    return res;
}

async function call(routePath, req) {
    const r = webhooks();
    const layer = r.stack.find((l) => l.route && l.route.path === routePath);
    if (!layer) throw new Error('webhook route not registered');
    const res = mkRes();
    await layer.route.stack[layer.route.stack.length - 1].handle(req, res, () => {});
    return res;
}

let authCalls; // count auth endpoint fetches

function scriptFetch(handlers) {
    authCalls = 0;
    global.fetch = jest.fn(async (url, opts) => {
        if (String(url).endsWith('/api/v1/authentication')) {
            authCalls++;
            if (handlers.authFail) return { ok: false, status: 401, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => ({ token: TOKEN }) };
        }
        const h = handlers[String(url)];
        if (!h) throw new Error('UNEXPECTED FETCH: ' + url);
        return { ok: h.ok !== false, status: h.status || 200, json: async () => h.body };
    });
}

beforeEach(() => {
    jest.resetModules();
    nium = require('../providers/nium');
    CDB = require('../config/database'); // fresh instance — same one the route binds
    CDB.db.query.mockReset();
    CDB.db.ensureConnection.mockReset();
    CDB.db.ensureConnection.mockResolvedValue();
    setEnvs({ NIUM_ENV: 'sandbox', NIUM_CLIENT_KEY: FAKE_KEY, NIUM_CLIENT_SECRET: FAKE_SECRET, NIUM_WEBHOOK_API_KEY: FAKE_WEBHOOKKEY });
});

afterEach(() => {
    delete ENV.NIUM_ENV; delete ENV.NIUM_BASE_URL;
    delete ENV.NIUM_CLIENT_KEY; delete ENV.NIUM_CLIENT_SECRET; delete ENV.NIUM_WEBHOOK_API_KEY;
    if (NATIVE_FETCH === undefined) delete global.fetch;
    else global.fetch = NATIVE_FETCH;
});

describe('fail-closed configuration', () => {
    test('no env -> adapter refuses before any network attempt', async () => {
        setEnvs({});
        // Node's native fetch is non-configurable in some versions, so replace
        // it with a mock instead of spying on it.
        const fetchMock = jest.fn();
        const savedFetch = global.fetch;
        global.fetch = fetchMock;
        try {
            await expect(nium.createPayout({ requestId: 'r1', beneficiary: {} })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            global.fetch = savedFetch;
        }
    });

    test('live without explicit NIUM_BASE_URL -> fail-closed (undocumented production host is operator-supplied)', async () => {
        setEnvs({ NIUM_ENV: 'live', NIUM_CLIENT_KEY: FAKE_KEY, NIUM_CLIENT_SECRET: FAKE_SECRET });
        const fetchMock = jest.fn();
        const savedFetch = global.fetch;
        global.fetch = fetchMock;
        try {
            await expect(nium.createPayout({ requestId: 'r1' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            global.fetch = savedFetch;
        }
    });

    test('sandbox resolves the documented sandbox host; missing webhook key is reported', async () => {
        setEnvs({ NIUM_ENV: 'sandbox', NIUM_CLIENT_KEY: FAKE_KEY, NIUM_CLIENT_SECRET: FAKE_SECRET });
        expect(nium.config().configured).toBe(true);
        expect(nium.config().baseUrl).toMatch(/api-test\.instarem\.com:4803$/);
        expect(nium.webhookSecretPresent()).toBe(false);
    });
});

describe('adapter official contract (simulated HTTP)', () => {
    test('authenticates once, caches the token, reuses it for payout creation', async () => {
        scriptFetch({
            [nium.config().baseUrl + '/api/v2/payouts']: { body: { payment_id: 'UATPY-1', reference_number: 'req-1', status: 'IN_PROCESS', sub_status: 'SUB' } },
            [nium.config().baseUrl + '/api/v1/payments/id/' + PAYMENT_ID]: { body: { payment_id: PAYMENT_ID, status: 'SENT_TO_BANK' } },
        });
        await nium.createPayout({
            requestId: 'req-1', transactionNumber: 'tn-1', statementNarrative: 'VaultBank',
            sourceAccount: '100', sourceCurrency: 'USD', sourceAmount: 25,
            beneficiary: { name: 'Test Benef', country_code: 'US', account_number: '000123456' },
        });
        expect(authCalls).toBe(1);
        await nium.getPayout(PAYMENT_ID); // second call must hit the token cache
        expect(authCalls).toBe(1);
        const calls = global.fetch.mock.calls;
        expect(String(calls[0][0]).endsWith('/api/v1/authentication')).toBe(true);
        expect(JSON.parse(String(calls[0][1].body))).toEqual({});
        expect(String(calls[1][0]).endsWith('/api/v2/payouts')).toBe(true);
        expect(JSON.parse(String(calls[1][1].body)).request_id).toBe('req-1'); // client idempotency id
        expect(JSON.parse(String(calls[1][1].body)).transaction_number).toBe('tn-1'); // duplicate rejected per docs
        expect(JSON.parse(String(calls[1][1].body)).beneficiary.name).toBe('Test Benef');
        expect(String(calls.find((c) => String(c[0]).includes('/api/v1/payments/id/'))[1].headers.authorization)).toBe('Bearer ' + TOKEN);
    });

    test('auth rejection -> AUTH_FAILED, provably nothing forwarded', async () => {
        scriptFetch({ authFail: true });
        await expect(nium.createPayout({ requestId: 'r' })).rejects.toMatchObject({ code: 'AUTH_FAILED', safe: true });
        expect(global.fetch.mock.calls.filter((c) => String(c[0]).includes('payouts'))).toHaveLength(0);
    });

    test('status polling maps provider payload fields', async () => {
        scriptFetch({ [nium.config().baseUrl + '/api/v1/payments/id/' + PAYMENT_ID]: { body: { payment_id: PAYMENT_ID, status: 'SENT_TO_BANK', sub_status: 'SUB1' } } });
        const out = await nium.getPayout(PAYMENT_ID);
        expect(out.status).toBe('SENT_TO_BANK');
        expect(out.paymentId).toBe(PAYMENT_ID);
    });

    test('UNKNOWN provider statuses land in reconciliation-required (never fake-terminal)', () => {
        expect(nium.normalizeStatus('PAID')).toEqual({ status: 'succeeded', rank: 4, rfi: false });
        expect(nium.normalizeStatus('AWAITING_FUNDS')).toEqual({ status: 'pending', rank: 1, rfi: false });
        expect(nium.normalizeStatus('SENT_TO_BANK')).toEqual({ status: 'processing', rank: 2, rfi: false });
        expect(nium.normalizeStatus('RETURNED')).toEqual({ status: 'refunded', rank: 4, rfi: false });
        expect(nium.normalizeStatus('COMPLIANCE_REJECTED')).toEqual({ status: 'failed', rank: 4, rfi: false });
        expect(nium.normalizeStatus('INFO_REQUESTED')).toMatchObject({ status: 'processing', rfi: true });
        const unknown = nium.normalizeStatus('FUTURE_STATE_X');
        expect(unknown.status).toBe('reconciliation_required');
        expect(unknown.rank).toBeGreaterThanOrEqual(4);
    });
});

describe('webhook receiver (simulated events)', () => {
    function event(body) {
        return { method: 'POST', headers: { 'x-api-key': FAKE_WEBHOOKKEY }, body };
    }

    test('unset webhook secret -> 401 fail-closed even with otherwise-valid config', async () => {
        setEnvs({ NIUM_ENV: 'sandbox', NIUM_CLIENT_KEY: FAKE_KEY, NIUM_CLIENT_SECRET: FAKE_SECRET });
        const res = await call('/api/providers/nium/webhook', event({ payment_id: PAYMENT_ID, status: 'PAID' }));
        expect(res.code).toBe(401);
    });

    test('wrong key -> 401 and nothing written', async () => {
        scriptDb([], () => ({ rows: [] }));
        const res = await call('/api/providers/nium/webhook', { method: 'POST', headers: { 'x-api-key': 'wrong' }, body: { payment_id: PAYMENT_ID, status: 'PAID' } });
        expect(res.code).toBe(401);
        expect(CDB.db.query).not.toHaveBeenCalled();
    });

    test('valid PAID event: stored (dedupe key), applies monotonic status, audits the transition', async () => {
        scriptDb([
            ['INSERT INTO provider_webhook_events', () => ({ rows: [{ id: 'e1' }] })],
            ['SELECT id, status, rfi_open, last_event_at FROM provider_payouts', () => ({ rows: [{ id: 'p1', status: 'processing', rfi_open: false, last_event_at: null }] })],
            ['UPDATE provider_payouts', () => ({ rowCount: 1, rows: [] })],
            ['INSERT INTO audit_logs', () => ({ rows: [] })],
        ], () => ({ rows: [] })); // # def: CREATE TABLE queries from ensureTables
        const ts = '2026-10-20T10:00:00Z';
        const res = await call('/api/providers/nium/webhook', event({ payment_id: PAYMENT_ID, event: 'TRANSACTION_STATUS_CHANGE', status: 'PAID', timestamp: ts, reference_number: 'req-1' }));
        expect(res.code).toBe(200);
        expect(res.body.applied).toBe(true);
        const ins = CDB.db.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO provider_webhook_events'));
        expect(ins[1][0]).toBe(PAYMENT_ID + ':PAID:' + ts); // stable dedupe key (provider id is inlined in SQL)
        const upd = CDB.db.query.mock.calls.find((c) => String(c[0]).includes('UPDATE provider_payouts'));
        expect(upd[1][1]).toBe('succeeded');
        expect(String(CDB.db.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_logs'))[1][1])).toContain('status_update');
    });

    test('replayed event (dedupe hit) -> 200 duplicate, nothing applied', async () => {
        scriptDb([
            ['INSERT INTO provider_webhook_events', () => ({ rows: [] })],
        ], () => ({ rows: [] }));
        const res = await call('/api/providers/nium/webhook', event({ payment_id: PAYMENT_ID, status: 'PAID', timestamp: '2026-10-20T10:00:00Z' }));
        expect(res.code).toBe(200);
        expect(res.body.duplicate).toBe(true);
    });

    test('out-of-order regression: PAID then late IN_PROCESS is stored but NEVER applied', async () => {
        scriptDb([
            ['INSERT INTO provider_webhook_events', () => ({ rows: [{ id: 'e2' }] })],
            ['SELECT id, status, rfi_open, last_event_at FROM provider_payouts', () => ({ rows: [{ id: 'p1', status: 'succeeded', rfi_open: false, last_event_at: null }] })],
        ], () => ({ rows: [] }));
        const res = await call('/api/providers/nium/webhook', event({ payment_id: PAYMENT_ID, status: 'IN_PROCESS', timestamp: '2026-10-20T09:00:00Z' }));
        expect(res.code).toBe(200);
        expect(res.body.applied).toBe(false);
        expect(CDB.db.query.mock.calls.filter((c) => String(c[0]).includes('UPDATE provider_payouts'))).toHaveLength(0);
    });

    test('partial RETURN after PAID -> reconciliation_required (amounts need an operator)', async () => {
        scriptDb([
            ['INSERT INTO provider_webhook_events', () => ({ rows: [{ id: 'e3' }] })],
            ['SELECT id, status, rfi_open, last_event_at FROM provider_payouts', () => ({ rows: [{ id: 'p1', status: 'succeeded', rfi_open: false, last_event_at: null }] })],
            ['UPDATE provider_payouts', () => ({ rowCount: 1, rows: [] })],
        ], () => ({ rows: [] }));
        const res = await call('/api/providers/nium/webhook', event({ payment_id: PAYMENT_ID, status: 'RETURNED', timestamp: '2026-10-20T11:00:00Z', partial_return_details: { partial_amount: '1.00' } }));
        expect(res.code).toBe(200);
        expect(res.body.applied).toBe(true);
        const upd = CDB.db.query.mock.calls.find((c) => String(c[0]).includes('UPDATE provider_payouts'));
        expect(upd[1][1]).toBe('reconciliation_required');
    });

    test('INFO_REQUESTED keeps the payout in processing and raises the RFI flag', async () => {
        scriptDb([
            ['INSERT INTO provider_webhook_events', () => ({ rows: [{ id: 'e4' }] })],
            ['SELECT id, status, rfi_open, last_event_at FROM provider_payouts', () => ({ rows: [{ id: 'p1', status: 'processing', rfi_open: false, last_event_at: null }] })],
            ['UPDATE provider_payouts', () => ({ rowCount: 1, rows: [] })],
        ], () => ({ rows: [] }));
        const res = await call('/api/providers/nium/webhook', event({ payment_id: PAYMENT_ID, status: 'INFO_REQUESTED', timestamp: '2026-10-20T12:00:00Z' }));
        expect(res.code).toBe(200);
        expect(res.body.applied).toBe(true);
        const upd = CDB.db.query.mock.calls.find((c) => String(c[0]).includes('UPDATE provider_payouts'));
        expect(upd[1][3]).toBe(true); // rfi_open is bind-3
    });

    test('event for an unknown payout row -> stored for reconciliation, 200 without crash', async () => {
        scriptDb([
            ['INSERT INTO provider_webhook_events', () => ({ rows: [{ id: 'e5' }] })],
            ['SELECT id, status, rfi_open, last_event_at FROM provider_payouts', () => ({ rows: [] })],
        ], () => ({ rows: [] }));
        const res = await call('/api/providers/nium/webhook', event({ payment_id: 'UATPY-unknown', status: 'PAID' }));
        expect(res.code).toBe(200);
        expect(res.body.applied).toBe(false);
    });

    test('chain test mode disables the receiver entirely (503, sandbox-namespace discipline)', async () => {
        ENV.USDC_TESTNET_MODE = 'base-sepolia';
        try {
            jest.resetModules();
            const freshDb = require('../config/database').db; // fresh mock instance binds to the fresh route module
            const hook = require('../routes/provider-webhooks');
            const layer = hook.stack.find((l) => l.route && l.route.path === '/api/providers/nium/webhook');
            const res = mkRes();
            await layer.route.stack[layer.route.stack.length - 1].handle(event({ payment_id: PAYMENT_ID, status: 'PAID' }), res, () => {});
            expect(res.code).toBe(503);
            expect(freshDb.ensureConnection).not.toHaveBeenCalled();
        } finally {
            delete ENV.USDC_TESTNET_MODE;
        }
    });
});
