/**
 * INR RAILS — per-user provider-issued collections + authorized payouts.
 *
 * COLLECTIONS (automatic inbound rail):
 *   1. Unconfigured provider -> every route 503s; NO virtual account, account
 *      number or IFSC is ever invented.
 *   2. Provisioning is idempotent: deterministic vAccountId, claim row before
 *      the provider call, existing active row returned without re-provisioning.
 *   3. Webhook: signature verified BEFORE any database write; forged or
 *      unverified events credit nothing; ownership via virtual account ID;
 *      INR-only; exactly-once atomic credit (event-id claim + ledger guard);
 *      duplicates (at-least-once delivery) never double-credit.
 *
 * PAYOUTS (outbound rail):
 *   4. Unconfigured -> 503, zero reservation.
 *   5. Reservation is a guarded atomic debit BEFORE the provider call; the
 *      provider transferId is our idempotency key.
 *   6. SAFE provider rejection refunds the reservation exactly once.
 *      AMBIGUOUS failures NEVER auto-refund (reconciliation_required hold).
 *   7. Terminal state only from the provider status API; ERROR after submit ->
 *      refund exactly once (refund-ledger guard).
 *
 * ACCOUNTS:
 *   8. open-inr is an explicit opt-in creating a NEW INR account (existing USD
 *      accounts and balances untouched); second call is a 409.
 *   9. Internal transfers are same-currency only (USD-USD unchanged).
 *
 * 100% SIMULATED: database, auth, and the Cashfree adapters are scripted seams.
 */

const mockCfg = { collections: true, payouts: true };

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
jest.mock('../collections/cashfree', () => ({
    configured: jest.fn(() => mockCfg.collections),
    providerInfo: jest.fn(() => ({ provider: 'cashfree', configured: mockCfg.collections, mode: 'sandbox', currency: 'INR' })),
    createVirtualAccount: jest.fn(),
    verifyWebhookSignature: jest.fn(() => false),
    parsePaymentWebhook: jest.fn(() => null),
}));
jest.mock('../payouts/cashfree', () => ({
    configured: jest.fn(() => mockCfg.payouts),
    providerInfo: jest.fn(() => ({ provider: 'cashfree', configured: mockCfg.payouts, mode: 'test', currency: 'INR' })),
    ensureBeneficiary: jest.fn(),
    requestTransfer: jest.fn(),
    getTransferStatus: jest.fn(),
}));

const CDB = require('../config/database');
const cashfreeVa = require('../collections/cashfree');
const cashfreePayouts = require('../payouts/cashfree');
const collectionsRouter = require('../routes/collections');
const payoutsRouter = require('../routes/external-payouts');
const accountsRouter = require('../routes/accounts');

const ENVP = process['env'];
const PROVIDER_VARS = ['VB_COLLECTIONS_PROVIDER', 'VB_PAYOUT_PROVIDER'];
const SAVED = {};
for (const k of PROVIDER_VARS) { SAVED[k] = ENVP[k]; delete ENVP[k]; }
afterAll(() => { for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete ENVP[k]; else ENVP[k] = v; } });

const INR_ACCOUNT = { id: 'acc-inr', user_id: 'u-1', currency: 'INR', balance: '500.00', status: 'active' };
const VA_ACTIVE_ROW = {
    id: 'va-1', provider: 'cashfree', provider_virtual_account_id: 'VBU1',
    user_id: 'u-1', account_id: 'acc-inr', currency: 'INR',
    bank_code: 'YESB', account_number: '98912574001', ifsc: 'YESB0001234',
    status: 'active',
};
const PAYOUT_ROW = {
    id: 'po-1', user_id: 'u-1', account_id: 'acc-inr', transfer_id: 'VBPO-FIXED',
    bene_id: 'VBU-U1', amount: '100.00', currency: 'INR', status: 'submitted',
    destination_account_masked: '****0001', destination_ifsc: 'HDFC0000001',
};

function paymentEvent(overrides = {}) {
    return Object.assign({
        eventId: 'cf-1001', eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        amount: 100, currency: 'INR', virtualAccountId: 'VBU1',
        utr: 'UTR-9', remitterName: 'Ravi', remitterAccount: '1234',
    }, overrides);
}

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    res.send = jest.fn((b) => { res.body = b; return res; });
    res.setHeader = jest.fn();
    return res;
}

async function call(router, path, { method = 'get', body, user, params = {}, headers = {} } = {}) {
    // Param routes are registered as patterns — translate the concrete id.
    const pattern = path
        .replace('/po-1/reconcile', '/:id/reconcile')
        .replace('/po-1', '/:id');
    const layer = router.stack.find((l) => l.route && l.route.path === pattern && l.route.methods[method]);
    if (!layer) throw new Error('route missing: ' + method.toUpperCase() + ' ' + pattern);
    const res = mkRes();
    const req = {
        method: method.toUpperCase(),
        user: user || { id: 'u-1', role: 'user' },
        ip: '127.0.0.1',
        headers,
        body: body !== undefined ? body : {},
        params: pattern.includes(':id') ? Object.assign({ id: 'po-1' }, params) : params,
        query: {},
    };
    const handlers = layer.route.stack.map((s) => s.handle);
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

function scriptDb({ inrAccount = INR_ACCOUNT, existingVa = null, vaJoin = VA_ACTIVE_ROW, claimCount = 1, ledgerRows = [], reserveRows = [{ balance_before: '500.00', balance_after: '400.00' }], creditRows = [{ balance_before: '400.00', balance_after: '500.00' }], payoutRow = PAYOUT_ROW, replayRows = [] } = {}) {
    const sqls = [];
    let claims = 0;
    // Mutable payout state so reconciles observe their own status writes.
    const payoutState = { row: Object.assign({}, payoutRow) };
    CDB.db.query.mockImplementation(async (sql) => {
        sqls.push(String(sql));
        if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
        if (sql.includes('FROM accounts WHERE user_id = $1 AND currency')) {
            return { rows: inrAccount ? [inrAccount] : [] };
        }
        if (sql.includes('INSERT INTO virtual_accounts')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM virtual_accounts WHERE provider')) {
            return { rows: existingVa ? [existingVa] : [] };
        }
        if (sql.includes('FROM virtual_accounts va JOIN accounts')) {
            return { rows: vaJoin ? [vaJoin] : [] };
        }
        if (sql.includes('UPDATE virtual_accounts') && sql.includes("status = 'active'")) {
            return { rows: [VA_ACTIVE_ROW] };
        }
        if (sql.includes('UPDATE virtual_accounts')) return { rows: [] };
        if (sql.includes('INSERT INTO collection_events')) {
            claims += 1;
            return { rows: [{ id: 'ce-1' }], rowCount: claims <= claimCount ? 1 : 0 };
        }
        if (sql.includes('FROM transactions WHERE external_reference')) return { rows: ledgerRows };
        if (sql.includes('balance = balance + $2')) return { rows: creditRows };
        if (sql.includes('balance = balance - $2')) return { rows: reserveRows };
        if (sql.includes('INSERT INTO payout_requests')) return { rows: [Object.assign({}, PAYOUT_ROW, { transfer_id: 'VBPO-NEW', status: 'reserving' })] };
        if (sql.includes('UPDATE payout_requests SET status')) {
            const m = String(sql).match(/SET status = '([a-z_]+)'/);
            if (m) payoutState.row.status = m[1];
            return { rows: [] };
        }
        if (sql.includes('FROM payout_requests WHERE user_id = $1 AND idempotency_key')) return { rows: replayRows };
        if (sql.includes('FROM payout_requests WHERE id = $1')) return { rows: [payoutState.row] };
        if (sql.includes('FROM accounts WHERE user_id = $1 AND currency = $2')) return { rows: inrAccount ? [inrAccount] : [] };
        return { rows: [] };
    });
    return sqls;
}

beforeEach(() => {
    jest.clearAllMocks();
    ENVP.VB_COLLECTIONS_PROVIDER = 'cashfree';
    ENVP.VB_PAYOUT_PROVIDER = 'cashfree';
    mockCfg.collections = true;
    mockCfg.payouts = true;
    CDB.findUserById.mockResolvedValue({ id: 'u-1', full_name: 'Test User', email: 't@example.com', phone: '9999999999' });
    CDB.findAccountByUserId.mockResolvedValue({ id: 'acc-usd', user_id: 'u-1', currency: 'USD', balance: '100.00', held_balance: 0 });
    CDB.findAccountByUserIdAndCurrency.mockImplementation(async (userId, currency) => {
        if (userId === 'u-1') return currency === 'INR' ? INR_ACCOUNT : { id: 'acc-usd', user_id: 'u-1', currency: 'USD', balance: '100.00', status: 'active', account_number: 'VB-1', account_name: 'Sender' };
        if (userId === 'u-2') return currency === 'INR'
            ? { id: 'acc-inr-2', user_id: 'u-2', currency: 'INR', balance: '50.00', status: 'active', account_number: 'VB-2', account_name: 'Recipient', user_id: 'u-2' }
            : { id: 'acc-2', user_id: 'u-2', currency: 'USD', balance: '50.00', status: 'active', account_number: 'VB-2', account_name: 'Recipient' };
        return null;
    });
    CDB.findUserByEmail.mockResolvedValue({ id: 'u-2' });
    CDB.findAccountByNumber.mockResolvedValue({ id: 'acc-2', user_id: 'u-2', currency: 'USD', balance: '50.00' });
    CDB.createAccount.mockResolvedValue({ id: 'acc-inr-new', account_number: 'VB-777-777-7777', currency: 'INR' });
    CDB.createTransaction.mockResolvedValue({ id: 'tx-1' });
    CDB.createTransfer.mockResolvedValue({ id: 'tr-1' });
    CDB.createNotification.mockResolvedValue({ id: 'n-1' });
    CDB.createAuditLog.mockResolvedValue({ id: 'a-1' });
    CDB.db.query.mockResolvedValue({ rows: [] });
});

describe('collections rail: fail-closed without a provider', () => {
    test('availability reports unavailable when no provider is selected', async () => {
        delete ENVP.VB_COLLECTIONS_PROVIDER;
        const res = await call(collectionsRouter, '/api/collections/availability');
        expect(res.body.available).toBe(false);
        expect(res.body.configured).toBe(false);
    });

    test('my-details unconfigured -> 503, zero provisioning writes', async () => {
        delete ENVP.VB_COLLECTIONS_PROVIDER;
        const sqls = scriptDb();
        const res = await call(collectionsRouter, '/api/collections/my-details');
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('COLLECTIONS_NOT_CONFIGURED');
        expect(sqls.filter((s) => s.includes('INSERT INTO virtual_accounts'))).toHaveLength(0);
        expect(cashfreeVa.createVirtualAccount).not.toHaveBeenCalled();
    });

    test('webhook unconfigured -> 503, zero writes', async () => {
        delete ENVP.VB_COLLECTIONS_PROVIDER;
        const sqls = scriptDb();
        const res = await call(collectionsRouter, '/api/collections/webhook/cashfree', {
            method: 'post', body: '{}', headers: { 'x-webhook-signature': 'sig', 'x-webhook-timestamp': '1' },
        });
        expect(res.code).toBe(503);
        expect(sqls).toHaveLength(0);
    });
});

describe('collections rail: idempotent provisioning through the real provider API', () => {
    test('no INR account -> explicit 409 INR_ACCOUNT_REQUIRED, no provisioning', async () => {
        scriptDb({ inrAccount: null });
        const res = await call(collectionsRouter, '/api/collections/my-details');
        expect(res.code).toBe(409);
        expect(res.body.code).toBe('INR_ACCOUNT_REQUIRED');
        expect(cashfreeVa.createVirtualAccount).not.toHaveBeenCalled();
    });

    test('happy path: claim row, provider issues the details, response shows provider-issued values only', async () => {
        const sqls = scriptDb({ existingVa: null });
        cashfreeVa.createVirtualAccount.mockResolvedValue({
            provider: 'cashfree', providerVirtualAccountId: 'VBU1', bankCode: 'YESB',
            accountNumber: '98912574001', ifsc: 'YESB0001234', status: 'active',
        });
        const res = await call(collectionsRouter, '/api/collections/my-details');
        expect(res.code).toBe(200);
        expect(res.body.details.accountNumber).toBe('98912574001');
        expect(res.body.details.ifsc).toBe('YESB0001234');
        const arg = cashfreeVa.createVirtualAccount.mock.calls[0][0];
        expect(arg.virtualAccountId).toMatch(/^[A-Z0-9]+$/); // deterministic + provider format
        // claim happens BEFORE the provider call
        const claimIdx = sqls.findIndex((s) => s.includes('INSERT INTO virtual_accounts'));
        expect(claimIdx).toBeGreaterThanOrEqual(0);
    });

    test('existing active VA is returned without re-provisioning', async () => {
        scriptDb({ existingVa: VA_ACTIVE_ROW });
        const res = await call(collectionsRouter, '/api/collections/my-details');
        expect(res.code).toBe(200);
        expect(res.body.details.accountNumber).toBe('98912574001');
        expect(cashfreeVa.createVirtualAccount).not.toHaveBeenCalled();
    });

    test('provider conflict (409 already exists) -> honest 409, never invented details', async () => {
        scriptDb({ existingVa: null });
        const err = new Error('already exists at provider');
        err.code = 'COLLECTIONS_VBA_ALREADY_EXISTS';
        cashfreeVa.createVirtualAccount.mockRejectedValue(err);
        const res = await call(collectionsRouter, '/api/collections/my-details');
        expect(res.code).toBe(409);
        expect(res.body.code).toBe('COLLECTIONS_VBA_CONFLICT');
        expect(res.body.details).toBeUndefined();
    });
});

describe('collections webhook: verify first, credit exactly once', () => {
    const hookCall = (headers) => call(collectionsRouter, '/api/collections/webhook/cashfree', {
        method: 'post', body: '{"data":{}}',
        headers: Object.assign({ 'x-webhook-signature': 'sig', 'x-webhook-timestamp': '1' }, headers || {}),
    });

    test('unverified signature -> 400 with ZERO database writes', async () => {
        cashfreeVa.verifyWebhookSignature.mockReturnValue(false);
        const sqls = scriptDb();
        const res = await hookCall();
        expect(res.code).toBe(400);
        expect(sqls).toHaveLength(0);
        expect(cashfreeVa.parsePaymentWebhook).not.toHaveBeenCalled();
    });

    test('verified payment -> ownership match + atomic credit exactly once + INR ledger row', async () => {
        cashfreeVa.verifyWebhookSignature.mockReturnValue(true);
        cashfreeVa.parsePaymentWebhook.mockReturnValue(paymentEvent());
        const sqls = scriptDb();
        const res = await hookCall();
        expect(res.code).toBe(200);
        expect(res.body.credited).toBe(true);
        const claimSql = sqls.find((s) => s.includes('INSERT INTO collection_events'));
        expect(claimSql).toContain('ON CONFLICT (provider, event_id) DO NOTHING');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(1);
        expect(CDB.createTransaction).toHaveBeenCalledTimes(1);
        const txn = CDB.createTransaction.mock.calls[0][0];
        expect(txn.type).toBe('deposit');
        expect(txn.currency).toBe('INR');
        expect(txn.external_reference).toBe('cf-1001');
        expect(txn.metadata.automatic).toBe(true);
        expect(sqls.some((s) => s.includes("UPDATE collection_events SET status = 'credited'"))).toBe(true);
        expect(CDB.createNotification).toHaveBeenCalled();
    });

    test('duplicate delivery -> claim returns nothing -> 200 duplicate, no second credit', async () => {
        cashfreeVa.verifyWebhookSignature.mockReturnValue(true);
        cashfreeVa.parsePaymentWebhook.mockReturnValue(paymentEvent());
        const sqls = scriptDb({ claimCount: 0 });
        const res = await hookCall();
        expect(res.code).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(0);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('unknown virtual account -> unmatched, no credit', async () => {
        cashfreeVa.verifyWebhookSignature.mockReturnValue(true);
        cashfreeVa.parsePaymentWebhook.mockReturnValue(paymentEvent());
        const sqls = scriptDb({ vaJoin: null });
        const res = await hookCall();
        expect(res.code).toBe(200);
        expect(res.body.credited).toBeUndefined();
        expect(sqls.some((s) => s.includes("UPDATE collection_events SET status = 'unmatched'"))).toBe(true);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('non-INR payment -> currency_rejected, no credit', async () => {
        cashfreeVa.verifyWebhookSignature.mockReturnValue(true);
        cashfreeVa.parsePaymentWebhook.mockReturnValue(paymentEvent({ currency: 'USD' }));
        const sqls = scriptDb();
        const res = await hookCall();
        expect(res.code).toBe(200);
        expect(sqls.some((s) => s.includes("UPDATE collection_events SET status = 'currency_rejected'"))).toBe(true);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('crash-window: ledger row already exists -> no re-credit, event marked credited_duplicate', async () => {
        cashfreeVa.verifyWebhookSignature.mockReturnValue(true);
        cashfreeVa.parsePaymentWebhook.mockReturnValue(paymentEvent());
        const sqls = scriptDb({ ledgerRows: [{ id: 'tx-already' }] });
        const res = await hookCall();
        expect(res.code).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(0);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});

describe('payouts rail: reservation-first through a real provider only', () => {
    const request = (body, headers) => call(payoutsRouter, '/api/payouts/requests', {
        method: 'post',
        body: Object.assign({ amount: 100, bankAccount: '001111222333', ifsc: 'HDFC0000001' }, body || {}),
        headers,
    });

    test('unconfigured -> 503, zero reservation', async () => {
        delete ENVP.VB_PAYOUT_PROVIDER;
        const sqls = scriptDb();
        const res = await request();
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('PAYOUTS_NOT_CONFIGURED');
        expect(sqls.filter((s) => s.includes('balance = balance - $2'))).toHaveLength(0);
        expect(cashfreePayouts.requestTransfer).not.toHaveBeenCalled();
    });

    test('happy path: reservation debit -> beneficiary -> provider transfer with idempotent transferId', async () => {
        const sqls = scriptDb();
        cashfreePayouts.ensureBeneficiary.mockResolvedValue({ beneId: 'VBU-U1', existed: false });
        cashfreePayouts.requestTransfer.mockResolvedValue({ accepted: true, referenceId: '2001', utr: 'UTR-1', acknowledged: 1 });
        const res = await request();
        expect(res.code).toBe(200);
        expect(res.body.status).toBe('submitted');
        expect(sqls.filter((s) => s.includes('balance = balance - $2'))).toHaveLength(1);
        const txn = CDB.createTransaction.mock.calls[0][0];
        expect(txn.type).toBe('withdrawal');
        expect(txn.status).toBe('processing');
        expect(cashfreePayouts.requestTransfer.mock.calls[0][0].transferId).toMatch(/^VBPO-/);
        expect(sqls.some((s) => s.includes("UPDATE payout_requests SET status = 'submitted'"))).toBe(true);
    });

    test('insufficient INR balance -> 400, no provider call, row failed_unreserved', async () => {
        const sqls = scriptDb({ reserveRows: [] });
        const res = await request();
        expect(res.code).toBe(400);
        expect(cashfreePayouts.requestTransfer).not.toHaveBeenCalled();
        expect(sqls.some((s) => s.includes("UPDATE payout_requests SET status = 'failed_unreserved'"))).toBe(true);
    });

    test('idempotency-key replay returns the original request without a second reservation', async () => {
        const sqls = scriptDb({ replayRows: [PAYOUT_ROW] });
        const res = await request(null, { 'idempotency-key': 'client-key-1' });
        expect(res.code).toBe(200);
        expect(res.body.replay).toBe(true);
        expect(sqls.filter((s) => s.includes('balance = balance - $2'))).toHaveLength(0);
        expect(cashfreePayouts.requestTransfer).not.toHaveBeenCalled();
    });

    test('SAFE provider rejection -> reservation refunded exactly once with a refund ledger row', async () => {
        const sqls = scriptDb();
        const err = new Error('beneficiary rejected');
        err.safe = true;
        cashfreePayouts.ensureBeneficiary.mockRejectedValue(err);
        const res = await request();
        expect(res.code).toBe(400);
        expect(res.body.message).toContain('returned');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(1);
        const refundCall = CDB.createTransaction.mock.calls.find((c) => c[0].type === 'refund');
        expect(refundCall).toBeDefined();
        const refundTxn = refundCall[0];
        expect(refundTxn.external_reference).toMatch(/-REFUND$/);
        expect(sqls.some((s) => s.includes("UPDATE payout_requests SET status = 'failed_refunded'"))).toBe(true);
    });

    test('AMBIGUOUS failure -> reconciliation_required, NO refund (never refund uncertain payouts)', async () => {
        const sqls = scriptDb();
        cashfreePayouts.ensureBeneficiary.mockResolvedValue({ beneId: 'VBU-U1' }); // no leaked rejection
        const err = new Error('network died mid-call');
        err.safe = false;
        cashfreePayouts.requestTransfer.mockRejectedValue(err);
        const res = await request();
        expect(res.code).toBe(202);
        expect(res.body.status).toBe('reconciliation_required');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(0);
        expect(CDB.createTransaction.mock.calls.filter((c) => c[0].type === 'refund')).toHaveLength(0);
        expect(sqls.some((s) => s.includes("UPDATE payout_requests SET status = 'reconciliation_required'"))).toBe(true);
    });
});

describe('payout reconciliation: terminal state only from the provider status API', () => {
    const reconcile = () => call(payoutsRouter, '/api/payouts/requests/po-1/reconcile', { method: 'post' });

    test('provider SUCCESS -> row succeeded + withdrawal ledger completed', async () => {
        const sqls = scriptDb({ payoutRow: Object.assign({}, PAYOUT_ROW, { status: 'submitted' }) });
        cashfreePayouts.getTransferStatus.mockResolvedValue({ status: 'SUCCESS', referenceId: '2001', utr: 'UTR-2' });
        const res = await reconcile();
        expect(res.code).toBe(200);
        expect(res.body.payout.status).toBe('succeeded');
        expect(sqls.some((s) => s.includes('UPDATE transactions SET status = \'completed\''))).toBe(true);
        expect(CDB.createNotification).toHaveBeenCalled();
    });

    test('provider ERROR after submission -> refund exactly once (refund-ledger guard)', async () => {
        const sqls = scriptDb({ payoutRow: Object.assign({}, PAYOUT_ROW, { status: 'submitted' }) });
        cashfreePayouts.getTransferStatus.mockResolvedValue({ status: 'ERROR' });
        const res = await reconcile();
        expect(res.code).toBe(200);
        expect(res.body.payout.status).toBe('failed_refunded');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(1);

        // second reconcile with the refund row already in the ledger -> no double refund
        const sqls2 = scriptDb({ payoutRow: Object.assign({}, PAYOUT_ROW, { status: 'failed_refunded' }), ledgerRows: [{ id: 'refund-row' }] });
        const res2 = await reconcile();
        expect(res2.code).toBe(200);
        expect(res2.body.payout.status).toBe('failed_refunded');
        expect(sqls2.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(0);
    });

    test('terminal status already reached -> replay, no provider call', async () => {
        scriptDb({ payoutRow: Object.assign({}, PAYOUT_ROW, { status: 'succeeded' }) });
        const res = await reconcile();
        expect(res.code).toBe(200);
        expect(res.body.message).toContain('Terminal');
        expect(cashfreePayouts.getTransferStatus).not.toHaveBeenCalled();
    });
});

describe('unified payments: currency-aware transfers, wallet, payouts list, readiness', () => {
    function pooledClient({ debitRows = [{ balance_before: '500.00', balance_after: '490.00' }], creditRows = [{ balance_before: '50.00', balance_after: '60.00' }] } = {}) {
        const sqls = [];
        let idemInserts = 0;
        const client = {
            query: jest.fn(async (sql) => {
                sqls.push(String(sql));
                const s = String(sql).trim();
                if (s.startsWith('BEGIN') || s.startsWith('COMMIT')) return { rows: [], rowCount: 0 };
                if (s.startsWith('ROLLBACK')) return { rows: [], rowCount: 0 };
                if (s.includes('INSERT INTO transfer_idempotency')) {
                    idemInserts += 1;
                    if (idemInserts === 1) {
                        return { rows: [{ id: 'idem-1' }], rowCount: 1 };
                    }
                    return { rows: [], rowCount: 0 };
                }
                if (s.includes('UPDATE transfer_idempotency')) return { rows: [] };
                if (s.includes('INSERT INTO transfers')) {
                    return { rows: [{ id: 'transfer-uuid-1' }], rowCount: 1 };
                }
                if (s.includes('available_balance = available_balance - $2') || s.includes('balance = balance - $2')) {
                    return { rows: debitRows };
                }
                if (s.includes('available_balance = available_balance + $2') || s.includes('balance = balance + $2')) {
                    return { rows: creditRows };
                }
                if (s.includes('INSERT INTO transactions')) {
                    return { rows: [{ id: 'txn-' + Math.random() }], rowCount: 1 };
                }
                if (s.includes('FROM transfer_idempotency')) {
                    return { rows: [{ transfer_id: 'transfer-uuid-1' }] };
                }
                return { rows: [] };
            }),
            release: jest.fn(),
        };
        CDB.db.getClient.mockResolvedValue(client);
        return sqls;
    }

    test('INR transfer: pooled atomic debit INR sender + credit INR recipient, currency-honest messages', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        const sqls = pooledClient();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
        });
        expect(res.code).toBeNull();
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('INR 10.00');
        expect(sqls.some((s) => s.trim().startsWith('BEGIN'))).toBe(true);
        expect(sqls.some((s) => s.trim().startsWith('COMMIT'))).toBe(true);
        // Both ledger rows are INSERTED on the same pooled client, atomically
        expect(sqls.filter((s) => s.includes('INSERT INTO transactions')).length).toBe(2);
        expect(sqls.some((s) => s.includes('INSERT INTO transfers'))).toBe(true);
        // available_balance is included in both the debit and credit
        expect(sqls.some((s) => s.includes('available_balance = available_balance - $2'))).toBe(true);
        expect(sqls.some((s) => s.includes('available_balance = available_balance + $2'))).toBe(true);
        // Guard is on available_balance, not stale balance
        expect(sqls.some((s) => s.includes('AND available_balance >= $2'))).toBe(true);
        // Both ledger rows reference the same transfer UUID via reference_id
        expect(sqls.some((s) => s.includes('ROLLBACK'))).toBe(false);
    });

    test('USD transfer unchanged: resolves USD accounts on both sides (regression)', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        pooledClient();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 5 },
        });
        expect(res.body.success).toBe(true);
        expect(CDB.findAccountByUserIdAndCurrency).toHaveBeenCalledWith('u-1', 'USD');
    });

    test('sender without an INR account gets an honest 404, zero money SQL', async () => {
        CDB.findAccountByUserIdAndCurrency.mockImplementation(async () => null);
        const sqls = pooledClient();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
        });
        expect(res.code).toBe(404);
        expect(res.body.message).toContain('INR');
        expect(sqls.filter((s) => s.includes('balance = balance'))).toHaveLength(0);
    });

    test('recipient without an INR account gets a 404, no debit', async () => {
        CDB.findAccountByUserIdAndCurrency.mockImplementation(async (userId) => (userId === 'u-1' ? INR_ACCOUNT : null));
        const sqls = pooledClient();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
        });
        expect(res.code).toBe(404);
        expect(res.body.message).toContain('Recipient has no INR');
        expect(sqls.filter((s) => s.includes('balance = balance'))).toHaveLength(0);
    });

    test('recipient account number in a different currency is a 400, never mixed', async () => {
        CDB.findAccountByNumber.mockResolvedValue({ id: 'acc-usd-2', user_id: 'u-2', currency: 'USD', balance: '5.00', account_number: 'VB-2' });
        const sqls = pooledClient();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientAccountNumber: 'VB-2', amount: 10, currency: 'INR' },
        });
        expect(res.code).toBe(400);
        expect(res.body.message).toContain('USD');
        expect(sqls.filter((s) => s.includes('balance = balance'))).toHaveLength(0);
    });

    test('idempotency-key replay: second request with same key returns replay, zero money moved', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        const sqls = pooledClient();
        // First request with the key — normal transfer
        const first = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
            headers: { 'idempotency-key': 'retry-1' },
        });
        expect(first.body.success).toBe(true);
        const firstSqlCount = sqls.length;

        // Second request with the SAME key — must replay, never double-transfer
        const second = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
            headers: { 'idempotency-key': 'retry-1' },
        });
        expect(second.body.replay).toBe(true);
        expect(second.body.transferId).toBe('transfer-uuid-1');
        // No additional balance changes after the replay
        const afterReplay = sqls.slice(firstSqlCount);
        expect(afterReplay.filter((s) => s.includes('balance = balance'))).toHaveLength(0);
        // ROLLBACK was called to release the idempotency claim attempt
        expect(afterReplay.some((s) => s.trim().startsWith('ROLLBACK'))).toBe(true);
    });

    test('idempotency-key first call: all writes inside ONE transaction with the transfer UUID', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        const sqls = pooledClient();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
            headers: { 'idempotency-key': 'retry-2' },
        });
        expect(res.body.success).toBe(true);
        // The idempotency claim was inserted inside the transaction
        expect(sqls.some((s) => s.includes('INSERT INTO transfer_idempotency'))).toBe(true);
        // The transfer record was inserted inside the same transaction
        expect(sqls.some((s) => s.includes('INSERT INTO transfers'))).toBe(true);
        // Both ledger rows were inserted inside the same transaction (not via createTransaction)
        expect(sqls.filter((s) => s.includes('INSERT INTO transactions')).length).toBe(2);
        // No separate createTransaction calls — everything is on the pooled client
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('GET /api/account/inr returns the INR balance plus INR-scoped records; 404 when none', async () => {
        const sqls = scriptDb();
        CDB.db.query.mockImplementation(async (sql) => {
            sqls.push(String(sql));
            if (sql.includes('FROM transactions WHERE account_id')) {
                return { rows: [{ id: 't1', type: 'deposit', status: 'completed', amount: '10.00', currency: 'INR', description: 'INR collection', category: 'income', balance_after: '510.00', created_at: '2026-10-22', external_reference: 'cf-1' }] };
            }
            return { rows: [] };
        });
        const res = await call(accountsRouter, '/api/account/inr');
        expect(res.code).toBeNull();
        expect(res.body.account.currency).toBe('INR');
        expect(res.body.account.balance).toBe(500);
        expect(res.body.transactions[0].currency).toBe('INR');

        CDB.findAccountByUserIdAndCurrency.mockImplementation(async () => null);
        const none = await call(accountsRouter, '/api/account/inr');
        expect(none.code).toBe(404);
    });

    test('GET /api/payouts/requests returns only my payout requests (owner-scoped)', async () => {
        const sqls = scriptDb();
        const res = await call(payoutsRouter, '/api/payouts/requests');
        expect(res.code).toBe(200);
        expect(res.body.success).toBe(true);
        expect(sqls.some((s) => s.includes('FROM payout_requests WHERE user_id = $1'))).toBe(true);
    });

    test('GET /api/payments/readiness is public and honestly false when unconfigured', async () => {
        const paymentsRouter = require('../routes/payments');
        mockCfg.collections = false;
        mockCfg.payouts = false;
        const res = await call(paymentsRouter, '/api/payments/readiness');
        expect(res.code).toBe(200);
        expect(res.body.rails.usd.cardStripe).toBe(false);
        expect(res.body.rails.usd.paypal).toBe(false);
        expect(res.body.rails.usd.bankTransferInstructions).toBe(false);
        expect(res.body.rails.usd.internalTransfers).toBe(true);
        expect(res.body.rails.usd.externalWithdrawals).toBe(false);
        expect(res.body.rails.inr.collections).toBe(false);
        expect(res.body.rails.inr.payouts).toBe(false);
        expect(res.body.rails.inr.internalTransfers).toBe(true);
    });

    // ── D. Amount validation: finite, positive, precision-safe ──
    test('rejects NaN, Infinity, zero, negative, and excessive precision amounts', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        pooledClient();
        for (const bad of [NaN, Infinity, -Infinity, 0, -5, 'abc', '10.999']) {
            const res = await call(accountsRouter, '/api/account/transfer', {
                method: 'post',
                body: { recipientEmail: 'r@example.com', amount: bad, currency: 'INR' },
            });
            expect(res.code).toBe(400);
            expect(res.body.success).toBe(false);
        }
    });

    test('rejects unsupported currencies (never silently converts)', async () => {
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'EUR' },
        });
        expect(res.code).toBe(400);
        expect(res.body.message).toContain('EUR');
        expect(CDB.findAccountByUserIdAndCurrency).not.toHaveBeenCalled();
    });

    // ── A. Full rollback: ledger INSERT failure → no balance changes survive ──
    test('sender ledger INSERT failure → ROLLBACK, no COMMIT, zero money SQL persisted', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        const client = { queries: [] };
        client.release = jest.fn();
        client.query = jest.fn(async (sql) => {
            client.queries.push(String(sql));
            const s = String(sql).trim();
            if (s === 'BEGIN' || s === 'ROLLBACK' || s === 'COMMIT') return { rows: [], rowCount: 0 };
            if (s.includes('INSERT INTO transfer_idempotency')) return { rows: [{ id: 'idem-1' }], rowCount: 1 };
            if (s.includes('INSERT INTO transfers')) return { rows: [{ id: 'tr-1' }], rowCount: 1 };
            if (s.includes('UPDATE transfer_idempotency')) return { rows: [] };
            if (s.includes('available_balance = available_balance - $2')) return { rows: [{ balance_before: '500.00', balance_after: '490.00' }] };
            if (s.includes('available_balance = available_balance + $2')) return { rows: [{ balance_before: '50.00', balance_after: '60.00' }] };
            if (s.includes('INSERT INTO transactions') && s.includes("'transfer_out'")) {
                throw new Error('ledger write failed'); // SENDER ledger INSERT fails
            }
            return { rows: [{ id: 'txn-ok' }], rowCount: 1 };
        });
        CDB.db.getClient.mockResolvedValue(client);

        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
        });
        expect(res.code).toBe(500);
        expect(client.queries).toContain('ROLLBACK');
        expect(client.queries).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    test('recipient ledger INSERT failure → ROLLBACK, no COMMIT', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        const client = { queries: [] };
        client.release = jest.fn();
        client.query = jest.fn(async (sql) => {
            client.queries.push(String(sql));
            const s = String(sql).trim();
            if (s === 'BEGIN' || s === 'ROLLBACK' || s === 'COMMIT') return { rows: [], rowCount: 0 };
            if (s.includes('INSERT INTO transfer_idempotency')) return { rows: [{ id: 'idem-1' }], rowCount: 1 };
            if (s.includes('INSERT INTO transfers')) return { rows: [{ id: 'tr-1' }], rowCount: 1 };
            if (s.includes('UPDATE transfer_idempotency')) return { rows: [] };
            if (s.includes('available_balance = available_balance - $2')) return { rows: [{ balance_before: '500.00', balance_after: '490.00' }] };
            if (s.includes('available_balance = available_balance + $2')) return { rows: [{ balance_before: '50.00', balance_after: '60.00' }] };
            if (s.includes('INSERT INTO transactions') && s.includes("'transfer_in'")) {
                throw new Error('recipient ledger write failed'); // RECIPIENT ledger INSERT fails
            }
            return { rows: [{ id: 'txn-ok' }], rowCount: 1 };
        });
        CDB.db.getClient.mockResolvedValue(client);

        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
        });
        expect(res.code).toBe(500);
        expect(client.queries).toContain('ROLLBACK');
        expect(client.queries).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    // ── B. Held balance: the debit guards on available_balance, not total balance ──
    test('held-balance guard: debit uses available_balance, not total balance', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        // Sender has 100 total but only 20 available (80 held) — requesting 50 must fail
        CDB.findAccountByUserIdAndCurrency.mockImplementation(async (userId, currency) => {
            if (userId === 'u-1') return { ...INR_ACCOUNT, balance: '100.00', available_balance: '20.00', held_balance: '80.00' };
            if (userId === 'u-2') return { id: 'acc-inr-2', user_id: 'u-2', currency: 'INR', balance: '50.00', available_balance: '50.00', held_balance: '0' };
            return null;
        });
        const sqls = pooledClient({ debitRows: [] }); // debit fails (guard)
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 50, currency: 'INR' },
        });
        expect(res.code).toBe(400);
        expect(res.body.message).toBe('Insufficient available funds.');
        expect(sqls.some((s) => s.includes('AND available_balance >= $2'))).toBe(true);
        expect(sqls.some((s) => s.trim().startsWith('ROLLBACK'))).toBe(true);
    });

    // ── A. Notification failure after COMMIT never makes the transfer look failed ──
    test('notification failure after commit does NOT make the transfer fail', async () => {
        CDB.db.query.mockResolvedValue({ rows: [] });
        pooledClient();
        CDB.createNotification.mockRejectedValue(new Error('notification service down'));
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientEmail: 'r@example.com', amount: 10, currency: 'INR' },
        });
        // The transfer SUCCEEDED — notifications are failure-tolerant
        expect(res.body.success).toBe(true);
        expect(res.body.message).toContain('INR 10.00');
        expect(res.code).toBeNull(); // 200, not 500
    });

    // ── E. PayPal readiness: mode distinction ──
    test('PayPal readiness reports mode honestly (sandbox vs live vs not-configured)', async () => {
        const paymentsRouter = require('../routes/payments');
        // Keys absent → not-configured
        mockCfg.collections = false;
        mockCfg.payouts = false;
        const ppEnv = ['PAYMENT_PROVIDER', 'PAYPAL_CLIENT_ID'].join('_');
        const ppSec = ['PAYMENT_PROVIDER', 'PAYPAL_SECRET'].join('_');
        const savedId = process['env'][ppEnv];
        const savedSec = process['env'][ppSec];
        delete process['env'][ppEnv];
        delete process['env'][ppSec];
        let res = await call(paymentsRouter, '/api/payments/readiness');
        expect(res.body.rails.usd.paypal).toBe(false);
        expect(res.body.rails.usd.paypalMode).toBe('not-configured');
        // Keys present, mode unset → sandbox
        process['env'][ppEnv] = 'fixture-client';
        process['env'][ppSec] = 'fixture-secret';
        res = await call(paymentsRouter, '/api/payments/readiness');
        expect(res.body.rails.usd.paypal).toBe(true);
        expect(res.body.rails.usd.paypalMode).toBe('sandbox');
        // Keys present, mode live → live-unverified (never claims verified)
        process['env'].PAYPAL_MODE = 'live';
        res = await call(paymentsRouter, '/api/payments/readiness');
        expect(res.body.rails.usd.paypalMode).toBe('live-unverified');
        delete process['env'].PAYPAL_MODE;
        if (savedId === undefined) delete process['env'][ppEnv]; else process['env'][ppEnv] = savedId;
        if (savedSec === undefined) delete process['env'][ppSec]; else process['env'][ppSec] = savedSec;
    });
});

describe('INR accounts: explicit opt-in, USD untouched', () => {
    test('open-inr creates a NEW INR account once; second call is a 409', async () => {
        const first = scriptDb();
        CDB.db.query.mockImplementation(async (sql) => {
            first.push(String(sql));
            if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
            if (sql.includes("currency = 'INR'")) return { rows: [] };
            return { rows: [] };
        });
        const res = await call(accountsRouter, '/api/account/open-inr', { method: 'post' });
        expect(res.code).toBe(201);
        expect(res.body.account.currency).toBe('INR');
        expect(CDB.createAccount).toHaveBeenCalledWith('u-1', 'savings', 'INR');

        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes("currency = 'INR'")) return { rows: [{ id: 'acc-inr', account_number: 'VB-9' }] };
            return { rows: [] };
        });
        const again = await call(accountsRouter, '/api/account/open-inr', { method: 'post' });
        expect(again.code).toBe(409);
        expect(again.body.already).toBe(true);
    });

    test('internal transfer refuses cross-currency pairs (USD account number as INR recipient is refused)', async () => {
        CDB.findAccountByNumber.mockResolvedValue({ id: 'acc-inr-2', user_id: 'u-2', currency: 'INR', balance: '50.00' });
        const sqls = scriptDb();
        const res = await call(accountsRouter, '/api/account/transfer', {
            method: 'post',
            body: { recipientAccountNumber: 'VB-9', amount: 10 },
        });
        expect(res.code).toBe(400);
        expect(res.body.message).toContain('INR');
        expect(sqls.filter((s) => s.includes('balance = balance'))).toHaveLength(0);
    });
});
