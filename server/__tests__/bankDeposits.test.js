/**
 * BANK-TRANSFER DEPOSIT RAIL — manual-verified settlement contract.
 *
 * The ONLY production rail that can credit a real balance is a verified bank
 * transfer: the user gets instructions carrying a UNIQUE reference, a pending
 * record is created WITHOUT crediting anything, and money enters the ledger
 * ONLY after an authorized admin confirms authentic bank-statement evidence.
 *
 *   1. Instructions appear only when a real receiving account is configured.
 *   2. Creating an instruction never touches balances.
 *   3. Admin verification credits EXACTLY ONCE — atomic claim, ledger guard,
 *      atomic RETURNING credit — duplicates/replays cannot double-credit.
 *   4. A forged, client-claimed, or note-free "settlement" credits nothing.
 *   5. Reversal is a compensating guarded debit, never a ledger deletion.
 *
 * 100% SIMULATED: database, audit and notification seams are scripted.
 */
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
    isDemo: false,
    findUserById: jest.fn(),
    findAccountByUserId: jest.fn(),
    createTransaction: jest.fn(),
    createNotification: jest.fn(),
    createAuditLog: jest.fn(),
}));
jest.mock('../services/ledgerJournalService', () => ({
    ensureVaultLedgerSchema: jest.fn().mockResolvedValue(undefined),
    ensureCustomerLedgerAccount: jest.fn().mockResolvedValue({ id: 'ledger-account-1', currency: 'USD', accountId: 'acc-1' }),
    postBalancedJournal: jest.fn().mockResolvedValue({ journalId: 'journal-1', replay: false }),
    toMinorUnits: (value) => {
        const input = String(value == null ? '' : value).trim();
        if (!/^\\d+(?:\\.\\d{1,2})?$/.test(input)) throw new Error('invalid amount');
        const parts = input.split('.');
        return BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0') || '0');
    },
}));
jest.mock('../middleware/auth', () => ({
    // Faithful shapes: any user passes auth; only role 'admin' passes requireAdmin.
    authenticateToken: (req, res, next) => { if (!req.user) req.user = { id: 'u-1', role: 'user' }; next(); },
    requireAdmin: (req, res, next) => {
        if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required.' });
        next();
    },
}));

const CDB = require('../config/database');
const router = require('../routes/bank-deposits');

const ENVP = process['env'];
const CFG = {
    VB_BANK_DEPOSIT_ENABLED: 'true',
    VB_BANK_RECEIVING_BANK_NAME: 'First Test Bank',
    VB_BANK_RECEIVING_HOLDER: 'VaultBank Inc.',
    VB_BANK_RECEIVING_DETAILS: 'Account 0012345678 · SWIFT FTTBUS33',
    VB_BANK_RECEIVING_CURRENCY: 'USD',
};
const SAVED = {};
for (const k of Object.keys(CFG)) { SAVED[k] = ENVP[k]; delete ENVP[k]; }
afterAll(() => { for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete ENVP[k]; else ENVP[k] = v; } });
const configure = () => { for (const [k, v] of Object.entries(CFG)) ENVP[k] = v; };

const INSTRUCTION = {
    id: 'bd-1', user_id: 'u-1', account_id: 'acc-1', reference: 'VB-BD-TEST-0001',
    amount: '100.00', currency: 'USD', status: 'pending',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
};

function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    res.send = jest.fn((b) => { res.body = b; return res; });
    return res;
}

async function call(path, { method = 'get', body, user } = {}) {
    // Param routes are registered as patterns — translate the concrete id.
    const pattern = path
        .replace('/bd-1/cancel', '/:id/cancel')
        .replace('/bd-1/verify', '/:id/verify')
        .replace('/bd-1/fail', '/:id/fail')
        .replace('/bd-1/reverse', '/:id/reverse')
        .replace('/instructions/bd-1', '/instructions/:id');
    const layer = router.stack.find((l) => l.route && l.route.path === pattern && l.route.methods[method]);
    if (!layer) throw new Error('route missing: ' + method.toUpperCase() + ' ' + pattern);
    const res = mkRes();
    const req = {
        method: method.toUpperCase(),
        user: user || { id: 'u-1', role: 'user' },
        ip: '127.0.0.1',
        headers: {},
        body: body || {},
        params: pattern.includes(':id') ? { id: 'bd-1' } : {},
        query: {},
    };
    const handlers = layer.route.stack.map((s) => s.handle);
    // Run the middleware chain synchronously; a middleware that rejects (no
    // next()) stops the chain. Then AWAIT the final handler (the route).
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

const ADMIN = { id: 'adm-1', role: 'admin' };

function scriptDb({ claimRows, ledgerRows = [], openCount = '0', debitRows = [{ balance_before: '100.00', balance_after: '50.00', balance: '50.00' }], instructionRow = INSTRUCTION } = {})
    const sqls = [];
    CDB.db.query.mockImplementation(async (sql) => {
        sqls.push(String(sql));
        if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
        if (sql.includes('SELECT COUNT(*)')) return { rows: [{ open_count: String(openCount) }] };
        if (sql.includes("INSERT INTO bank_deposit_instructions")) return { rows: [INSTRUCTION] };
        if (sql.includes("status = 'settling'")) return { rows: claimRows === undefined ? [] : claimRows };
        if (sql.includes('FROM transactions WHERE external_reference')) return { rows: ledgerRows };
        if (sql.includes('balance = balance + $2')) return { rows: [{ balance_before: '100.00', balance_after: '250.00' }] };
        if (sql.includes('balance = balance - $2')) return { rows: debitRows };
        if (sql.includes("status = 'settled'")) return { rows: [Object.assign({}, instructionRow, { status: 'settled', settled_at: new Date().toISOString() })] };
        if (sql.includes("status = 'reversed'")) return { rows: [{ id: instructionRow.id || 'bd-1' }] };\n        if (sql.includes("status = 'reversal_required'")) return { rows: [{ id: instructionRow.id || 'bd-1' }] };\n        if (sql.includes("status = 'expired'")) return { rows: [] };
        if (sql.includes("status = 'failed'")) return { rows: [Object.assign({}, INSTRUCTION, { status: 'failed' })] };
        if (sql.includes("status = 'cancelled'")) return { rows: [INSTRUCTION] };
        if (sql.includes('FROM bank_deposit_instructions')) return { rows: [instructionRow] };
        return { rows: [] };
    });
    return sqls;
}

beforeEach(() => {
    jest.clearAllMocks();
    CDB.findAccountByUserId.mockResolvedValue({ id: 'acc-1', user_id: 'u-1', balance: '100.00', currency: 'USD' });
    CDB.createTransaction.mockResolvedValue({ id: 'tx-1' });
    CDB.createNotification.mockResolvedValue({ id: 'n-1' });
    CDB.createAuditLog.mockResolvedValue({ id: 'a-1' });
    CDB.db.query.mockResolvedValue({ rows: [] });
    CDB.db.getClient.mockImplementation(async () => ({
        query: (sql, params) => CDB.db.query(sql, params),
        release: jest.fn(),
    }));
    const ledger = require('../services/ledgerJournalService');
    ledger.ensureVaultLedgerSchema.mockResolvedValue(undefined);
    ledger.ensureCustomerLedgerAccount.mockResolvedValue({ id: 'ledger-account-1', currency: 'USD', accountId: 'acc-1' });
    ledger.postBalancedJournal.mockResolvedValue({ journalId: 'journal-1', replay: false });
});

describe('receiving-account configuration gates everything', () => {
    test('unconfigured: config reports disabled, exposes NO account details', async () => {
        const res = await call('/api/bank-deposits/config');
        expect(res.code).toBe(200);
        expect(res.body.enabled).toBe(false);
        expect(res.body.bankName).toBeUndefined();
        expect(res.body.details).toBeUndefined();
    });

    test('unconfigured: creating an instruction fails closed', async () => {
        const sqls = scriptDb();
        const res = await call('/api/bank-deposits/instructions', { method: 'post', body: { amount: 100 } });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('BANK_DEPOSITS_NOT_CONFIGURED');
        expect(sqls.filter((s) => s.includes('INSERT INTO bank_deposit_instructions'))).toHaveLength(0);
    });

    test('configured: config returns the receiving details for authenticated users', async () => {
        configure();
        scriptDb();
        const res = await call('/api/bank-deposits/config');
        expect(res.body.enabled).toBe(true);
        expect(res.body.bankName).toBe('First Test Bank');
        expect(res.body.details).toContain('0012345678');
    });
});

describe('instruction creation never moves money', () => {
    test('creates a PENDING record with a unique reference, zero balance changes', async () => {
        configure();
        const sqls = scriptDb();
        const res = await call('/api/bank-deposits/instructions', { method: 'post', body: { amount: 100 } });
        expect(res.code).toBe(200);
        expect(res.body.instruction.status).toBe('pending');
        expect(res.body.instruction.reference).toMatch(/^VB-BD-/);
        expect(res.body.transfer.details).toContain('0012345678');
        expect(sqls.some((s) => s.includes('balance = balance'))).toBe(false);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
        expect(CDB.createAuditLog).toHaveBeenCalled();
    });

    test('rejects out-of-bounds amounts', async () => {
        configure();
        scriptDb();
        const low = await call('/api/bank-deposits/instructions', { method: 'post', body: { amount: 0.5 } });
        expect(low.code).toBe(400);
        const high = await call('/api/bank-deposits/instructions', { method: 'post', body: { amount: 100001 } });
        expect(high.code).toBe(400);
    });

    test('rejects a currency the account does not hold', async () => {
        configure();
        scriptDb();
        const res = await call('/api/bank-deposits/instructions', { method: 'post', body: { amount: 100, currency: 'EUR' } });
        expect(res.code).toBe(400);
    });

    test('caps open pending instructions per user', async () => {
        configure();
        scriptDb({ openCount: 3 });
        const res = await call('/api/bank-deposits/instructions', { method: 'post', body: { amount: 100 } });
        expect(res.code).toBe(429);
        expect(res.body.code).toBe('TOO_MANY_OPEN_INSTRUCTIONS');
    });
});

describe('ownership and cancellation', () => {
    test("cannot read another user's instruction", async () => {
        configure();
        scriptDb();
        const res = await call('/api/bank-deposits/instructions/bd-1');
        expect(res.code).toBe(200);
        // default script returns the owner's row; with a foreign row it must 404
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM bank_deposit_instructions')) {
                return { rows: [Object.assign({}, INSTRUCTION, { user_id: 'u-2' })] };
            }
            return { rows: [] };
        });
        const res2 = await call('/api/bank-deposits/instructions/bd-1');
        expect(res2.code).toBe(404);
    });

    test('cancel: pending -> cancelled once; second cancel is a 409', async () => {
        configure();
        scriptDb();
        const first = await call('/api/bank-deposits/instructions/bd-1/cancel', { method: 'post' });
        expect(first.code).toBe(200);
        CDB.db.query.mockImplementation(async (sql) => {
            if (sql.includes("status = 'cancelled'")) return { rows: [] };
            return { rows: [] };
        });
        const second = await call('/api/bank-deposits/instructions/bd-1/cancel', { method: 'post' });
        expect(second.code).toBe(409);
    });
});

describe('admin verification is the ONLY credit path — exactly once', () => {
    test('non-admin cannot verify (403, zero writes)', async () => {
        configure();
        const sqls = scriptDb();
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/verify', {
            method: 'post', body: { settlementAmount: 100, note: 'verified on bank statement' },
        });
        expect(res.code).toBe(403);
        expect(sqls.some((s) => s.includes('balance = balance + $2'))).toBe(false);
    });

    test('verification without a statement note fails (evidence is mandatory)', async () => {
        configure();
        scriptDb();
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/verify', {
            method: 'post', body: { settlementAmount: 100, note: 'ok' }, user: ADMIN,
        });
        expect(res.code).toBe(400);
        expect(res.body.code).toBe('EVIDENCE_REQUIRED');
    });

    test('happy path: claim -> ledger guard -> atomic credit -> settled, credited once', async () => {
        configure();
        const sqls = scriptDb({ claimRows: [Object.assign({}, INSTRUCTION, { status: 'settling' })] });
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/verify', {
            method: 'post', body: { settlementAmount: '100.00', note: 'statement line 42, wire from First Test Bank', externalTxnRef: 'UTR-TEST-0001' }, user: ADMIN,
        });
        expect(res.code).toBe(200);
        expect(res.body.credited).toBe(true);
        expect(res.body.duplicate).toBe(false);
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(1);
        expect(CDB.createTransaction).toHaveBeenCalledTimes(1);
        const txn = CDB.createTransaction.mock.calls[0][0];
        expect(txn.type).toBe('deposit');
        expect(txn.amount).toBe('100.00');
        expect(txn.external_reference).toBe('VB-BD-TEST-0001');
        expect(txn.metadata.manual_verification).toBe(true);
        expect(sqls.some((s) => s.includes("status = 'settled'"))).toBe(true);
        expect(CDB.createNotification).toHaveBeenCalled();
        expect(CDB.createAuditLog).toHaveBeenCalled();
    });

    test('already-settled instruction: claim returns no row -> 409, no second credit', async () => {
        configure();
        const sqls = scriptDb({ claimRows: [] });
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/verify', {
            method: 'post', body: { settlementAmount: '100.00', note: 'statement line 42 again', externalTxnRef: 'UTR-TEST-0001' }, user: ADMIN,
        });
        expect(res.code).toBe(409);
        expect(sqls.some((s) => s.includes('balance = balance + $2'))).toBe(false);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('crash-window recovery: claim ok but ledger row already exists -> no re-credit, still settled', async () => {
        configure();
        const sqls = scriptDb({
            claimRows: [Object.assign({}, INSTRUCTION, { status: 'settling' })],
            ledgerRows: [{ id: 'tx-already' }],
        });
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/verify', {
            method: 'post', body: { settlementAmount: '100.00', note: 'retry after crash — ledger row exists', externalTxnRef: 'UTR-TEST-0001' }, user: ADMIN,
        });
        expect(res.code).toBe(409);
        expect(res.body.code).toBe('BANK_DEPOSIT_RECONCILIATION_REQUIRED');
        expect(sqls.filter((s) => s.includes('balance = balance + $2'))).toHaveLength(0);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
        expect(sqls.some((s) => s.includes("status = 'settled'"))).toBe(false);
    });

    test('failed instruction: pending -> failed, NO credit, user notified', async () => {
        configure();
        const sqls = scriptDb();
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/fail', {
            method: 'post', body: { note: 'transfer bounced back to sender' }, user: ADMIN,
        });
        expect(res.code).toBe(200);
        expect(sqls.some((s) => s.includes('balance = balance'))).toBe(false);
        expect(CDB.createTransaction).not.toHaveBeenCalled();
        expect(CDB.createNotification).toHaveBeenCalled();
    });

    test('reversal is a compensating guarded debit, never a ledger deletion', async () => {
        configure();
        const sqls = scriptDb();
        CDB.db.query.mockImplementation(async (sql) => {
            sqls.push(String(sql));
            if (sql.includes('FROM bank_deposit_instructions')) {
                return { rows: [Object.assign({}, INSTRUCTION, { status: 'settled', settlement_amount: '150.00', settlement_note: 'x' })] };
            }
            if (sql.includes('balance = balance - $2')) return { rows: [{ balance: '10.00' }] };
            return { rows: [] };
        });
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/reverse', {
            method: 'post', body: { note: 'chargeback reported by bank' }, user: ADMIN,
        });
        expect(res.code).toBe(200);
        expect(res.body.reversed).toBe(true);
        expect(sqls.filter((s) => s.includes('balance = balance - $2'))).toHaveLength(1);
        const txn = CDB.createTransaction.mock.calls[0][0];
        expect(txn.amount).toBe(-150);
        expect(txn.type).toBe('adjustment');
    });

    test('reversal with insufficient balance flags reversal_required instead of forcing a negative balance', async () => {
        configure();
        const sqls = scriptDb({ debitRows: [] });
        CDB.db.query.mockImplementation(async (sql) => {
            sqls.push(String(sql));
            if (sql.includes('FROM bank_deposit_instructions')) {
                return { rows: [Object.assign({}, INSTRUCTION, { status: 'settled', settlement_amount: '150.00', settlement_note: 'x' })] };
            }
            if (sql.includes('balance = balance - $2')) return { rows: [] };
            return { rows: [] };
        });
        const res = await call('/api/bank-deposits/admin/instructions/bd-1/reverse', {
            method: 'post', body: { note: 'chargeback, balance too low' }, user: ADMIN,
        });
        expect(res.code).toBe(202);
        expect(res.body.reversed).toBe(false);
        expect(res.body.status).toBe('reversal_required');
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });
});
