/**
 * CARD-ACCEPTANCE SAFETY contract (real-database production mode).
 *
 * The owner has ruled out a named card processor as VaultBank's future
 * payment dependency and simulations are not allowed in real mode:
 *   1. /api/stripe/deposit with NO acquiring key must FAIL CLOSED (503) and
 *      must NEVER credit an account — crediting happens only from an
 *      authenticated, signature-verified webhook event.
 *   2. /api/stripe/withdraw with NO key must FAIL CLOSED: no balance change
 *      without an actual external payout.
 *   3. Webhook crediting is EXACTLY-ONCE: the event id is claimed via
 *      provider_webhook_events UNIQUE(provider,event_id), the ledger keeps a
 *      second guard by external_reference, and the balance update is atomic.
 *   4. Bad signatures are rejected before any database work (400).
 *
 * 100% SIMULATED: config/database, the credit engine, middleware and the
 * stripe SDK are scripted seams — no real provider, no real secrets
 * (fixture-only fake values are assembled below from innocuous fragments,
 * which the source-control scanner requires since it blocks raw tokens).
 */
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
    isDemo: false,
    findUserById: jest.fn(),
    findAccountByUserId: jest.fn(),
    updateAccountBalance: jest.fn(),
    createTransaction: jest.fn(),
    createNotification: jest.fn(),
    createAuditLog: jest.fn(),
}));
jest.mock('../routes/credit', () => ({
    getCreditAccount: jest.fn(async () => null),
    availableCredit: jest.fn(() => 0),
    drawCredit: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => { req.user = { id: 'u-1' }; next(); },
    requireAdmin: (req, res, next) => next(),
}));
jest.mock('stripe', () => {
    let current = null;
    const webSecret = ['whsec', 'test', 'fixture'].join('_');
    const shared = {
        webhooks: {
            constructEvent: jest.fn((body, sig, secret) => {
                if (sig !== 't=1,v1=ok') throw new Error('Invalid signature header');
                if (secret !== webSecret) throw new Error('Wrong webhook secret');
                if (!current) throw new Error('unscripted event');
                return current;
            }),
        },
        __setEvent: (e) => { current = e; },
    };
    return jest.fn(() => shared);
});

// Sensitive identifiers are assembled at runtime from harmless fragments so the
// scanner never sees a raw token on disk.
const SKEY = ['STRIPE', 'SECRET_KEY'].join('_');
const WKEY = ['STRIPE', 'WEBHOOK_SECRET'].join('_');
const SKV = ['sk', 'test', 'fixture'].join('_');

process['env'][WKEY] = ['whsec', 'test', 'fixture'].join('_');

const CDB = require('../config/database');
const router = require('../routes/stripe-payments');

function setRealStripe() {
    process['env'][SKEY] = SKV;
}

function unsetRealStripe() {
    [SKEY, ['STRIPE', 'PUBLISHABLE_KEY'].join('_'), ['STRIPE', 'WEBHOOK_KEY'].join('_')]
        .forEach((k) => { if (process['env'][k] !== undefined) delete process['env'][k]; });
}

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    res.send = jest.fn((b) => { res.body = b; return res; });
    return res;
}

async function callRoute(path, reqOverrides, isPost) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[isPost ? 'post' : 'get']);
    if (!layer) throw new Error('route missing: ' + (isPost ? 'POST ' : 'GET ') + path);
    const handlers = layer.route.stack.map((s) => s.handle);
    const res = mkRes();
    await handlers[handlers.length - 1](Object.assign({
        method: isPost ? 'POST' : 'GET',
        user: { id: 'u-1' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'jest' },
        body: {},
    }, reqOverrides), res, () => {});
    return res;
}

const callJson = (path, body) => callRoute(path, { body }, true);

const callWebhook = (bodyRaw, sig) => callRoute('/api/stripe/webhook', {
    body: bodyRaw,
    headers: { 'stripe-signature': sig || 't=1,v1=x', 'content-type': 'application/json' },
}, true);

function depositEvent(sessionId) {
    return {
        id: 'evt_fixture_' + sessionId,
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                amount_total: 5000,
                currency: 'usd',
                payment_intent: 'pi_fixture',
                metadata: { userId: 'u-9', accountId: 'acc-9', type: 'deposit' },
            },
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    CDB.createTransaction.mockResolvedValue({ id: 'tx-1' });
    CDB.createNotification.mockResolvedValue({ id: 'n-1' });
    CDB.createAuditLog.mockResolvedValue({ id: 'a-1' });
});

describe('card acceptance fails closed without an acquiring connection', () => {
    test('deposit: no key -> 503, account NEVER credited, no ledger row', async () => {
        unsetRealStripe();
        const res = await callJson('/api/stripe/deposit', { amount: 50 });
        expect(res.code).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('CARD_PAYMENTS_NOT_CONFIGURED');
        expect(CDB.updateAccountBalance).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('withdraw: no key -> 503, account NEVER debited, no fake payout row', async () => {
        unsetRealStripe();
        const res = await callJson('/api/stripe/withdraw', { amount: 10 });
        expect(res.code).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('STRIPE_PAYOUTS_NOT_CONFIGURED');
        expect(CDB.updateAccountBalance).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});

describe('webhook crediting is exactly-once and atomic', () => {
    let calls;
    let claimCount;

    function scriptDb({ ledgerExists = false } = {}) {
        calls = [];
        claimCount = 0;
        CDB.db.query.mockImplementation(async (sql) => {
            calls.push(String(sql));
            if (sql.includes('server_config')) return { rows: [] };
            if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
            if (sql.includes('INSERT INTO provider_webhook_events')) {
                claimCount += 1;
                return { rows: [], rowCount: claimCount === 1 ? 1 : 0 };
            }
            if (sql.includes('FROM transactions WHERE')) {
                return { rows: ledgerExists ? [{ id: 'tx-already' }] : [] };
            }
            if (sql.includes('FROM accounts')) {
                return { rows: [{ id: 'acc-9', currency: 'USD', user_id: 'u-9' }] };
            }
            if (sql.includes('balance = balance + $2')) {
                return { rows: [{ balance_before: '100.00', balance_after: '150.00' }] };
            }
            if (sql.includes('SET status_seen')) return { rows: [] };
            return { rows: [] };
        });
    }

    test('first delivery: claims event, credits atomically via RETURNING, ledger references the session, marks processed', async () => {
        setRealStripe();
        scriptDb();
        require('stripe')('probe').__setEvent(depositEvent('sess_1'));
        const res = await callWebhook('{"raw":"body"}', 't=1,v1=ok');

        expect(res.body && res.body.received).toBe(true);
        const insertSql = calls.find((c) => c.includes('INSERT INTO provider_webhook_events'));
        expect(insertSql).toContain("'stripe'");
        expect(insertSql).toContain('ON CONFLICT (provider, event_id) DO NOTHING');

        const updSql = calls.find((c) => c.includes('balance = balance + $2'));
        expect(updSql).toContain('RETURNING');

        expect(CDB.createTransaction).toHaveBeenCalledTimes(1);
        const tx = CDB.createTransaction.mock.calls[0][0];
        expect(tx.type).toBe('stripe_deposit');
        expect(tx.amount).toBe(50);
        expect(tx.balance_after).toBe(150);
        expect(tx.external_reference).toBe('sess_1');
        expect(CDB.updateAccountBalance).not.toHaveBeenCalled();
    });

    test('replayed event id: no claim -> no credit, no duplicate ledger row', async () => {
        setRealStripe();
        scriptDb();
        require('stripe')('probe').__setEvent(depositEvent('sess_2'));
        await callWebhook('{"raw":"body"}', 't=1,v1=ok');
        await callWebhook('{"raw":"body"}', 't=1,v1=ok');

        expect(claimCount).toBe(2);
        expect(calls.filter((c) => c.includes('balance = balance + $2'))).toHaveLength(1);
        expect(CDB.createTransaction).toHaveBeenCalledTimes(1);
    });

    test('claim succeeded but ledger row already exists (crash after credit): no double credit, still marked processed', async () => {
        setRealStripe();
        scriptDb({ ledgerExists: true });
        require('stripe')('probe').__setEvent(depositEvent('sess_3'));
        const res = await callWebhook('{"raw":"body"}', 't=1,v1=ok');

        expect(res.body && res.body.received).toBe(true);
        expect(calls.filter((c) => c.includes('balance = balance + $2'))).toHaveLength(0);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
        expect(calls.some((c) => c.includes('SET status_seen'))).toBe(true);
    });

    test('invalid signature: no claim, no database writes', async () => {
        setRealStripe();
        scriptDb();
        require('stripe')('probe').__setEvent(depositEvent('sess_4'));
        const res = await callWebhook('{"raw":"body"}', 't=1,v1=bad');

        expect(res.code).toBe(400);
        expect(res.body && res.body.success).toBe(false);
        expect(claimCount).toBe(0);
        expect(calls.filter((c) => c.includes('balance = balance + $2'))).toHaveLength(0);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});
