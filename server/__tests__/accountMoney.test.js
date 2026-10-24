/**
 * ACCOUNT-MONEY ATOMICITY contract (internal ledger rail).
 *
 * The classic account routes must never fabricate external settlement in
 * real-DB production mode (a database balance update is never proof of an
 * external rail). Contract per route:
 *   deposit   -> 503 DEPOSITS_USE_VERIFIED_RAIL — money enters ONLY via the
 *                admin-verified bank-transfer rail (bank-deposits.js)
 *   withdraw  -> 503 OUTBOUND_TRANSFERS_NOT_CONFIGURED — never debit and
 *                report success without a rail accepting the payout
 *   transfer  -> internal rail stays live: pooled transaction, guarded debit
 *                + credit, COMMIT, and a ROLLBACK (no COMMIT, no ledger
 *                record) when either half fails
 *
 * 100% SIMULATED: config/database is a scripted seam; no real database is
 * contacted from these tests.
 */
jest.mock('../config/database', () => ({
    db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
    isDemo: false,
    findUserById: jest.fn(),
    findAccountByUserId: jest.fn(),
    findAccountByUserIdAndCurrency: jest.fn(),
    findAccountByNumber: jest.fn(),
    searchUsers: jest.fn(),
    createAccount: jest.fn(),
    updateAccountBalance: jest.fn(),
    createTransaction: jest.fn(),
    getTransactions: jest.fn(),
    createTransfer: jest.fn(),
    getTransfers: jest.fn(),
    createNotification: jest.fn(),
    createAuditLog: jest.fn(),
    findUserByEmail: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => { req.user = { id: 'u-111', full_name: 'Sender' }; next(); },
    generateToken: () => 't',
}));

const CDB = require('../config/database');
const router = require('../routes/accounts');

function mkReq(body) { return { method: 'POST', body, user: { id: 'u-111', full_name: 'Sender' }, ip: '127.0.0.1', headers: { 'user-agent': 'jest' } }; }
function mkRes() {
    const res = { code: null, body: null };
    res.status = jest.fn((c) => { res.code = c; return res; });
    res.json = jest.fn((b) => { res.body = b; return res; });
    return res;
}
async function call(path, body) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    if (!layer) throw new Error('route missing: POST ' + path);
    const res = mkRes();
    layer.route.stack[0].handle(mkReq(body), res, () => {});
    await layer.route.stack[layer.route.stack.length - 1].handle(mkReq(body), res);
    return res;
}

const SENDER = { id: 'acc-1', user_id: 'u-111', balance: '100.00', currency: 'USD', account_number: 'VB-1111', account_name: 'Sender Account' };
const RECIPIENT = { id: 'acc-2', user_id: 'u-222', balance: '50.00', currency: 'USD', account_number: 'VB-2222', account_name: 'Recipient Account' };

describe('atomic account money (real-database mode)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        CDB.findAccountByUserId.mockResolvedValue(SENDER);
        CDB.findAccountByUserIdAndCurrency.mockImplementation(async (userId) => (userId === 'u-222' ? RECIPIENT : SENDER));
        CDB.findAccountByNumber.mockResolvedValue(RECIPIENT);
        CDB.findUserByEmail.mockResolvedValue({ id: 'u-222' });
        CDB.createTransfer.mockResolvedValue({ id: 'tr-1' });
        CDB.createTransaction.mockResolvedValue({ id: 'tx-1' });
    });

    test('deposit fails closed in real-DB mode: no self-credit without a verified rail', async () => {
        const res = await call('/api/account/deposit', { amount: 5, description: 'cash' });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('DEPOSITS_USE_VERIFIED_RAIL');
        expect(CDB.db.query).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('withdraw fails closed in real-DB mode: no debit, no phantom payout success', async () => {
        const res = await call('/api/account/withdraw', { amount: 80 });
        expect(res.code).toBe(503);
        expect(res.body.code).toBe('OUTBOUND_TRANSFERS_NOT_CONFIGURED');
        expect(CDB.db.query).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('transfer runs in a pooled transaction and commits when both halves return rows', async () => {
        const client = { queries: [], release: jest.fn() };
        client.query = jest.fn(async (sql) => {
            client.queries.push(sql);
            const s = String(sql).trim();
            if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [], rowCount: 0 };
            if (s.includes('INSERT INTO transfer_idempotency')) return { rows: [{ id: 'idem-1' }], rowCount: 1 };
            if (s.includes('UPDATE transfer_idempotency')) return { rows: [] };
            if (s.includes('INSERT INTO transfers')) return { rows: [{ id: 'tr-1' }], rowCount: 1 };
            if (s.includes('available_balance = available_balance - $2')) return { rows: [{ balance_before: '100.00', balance_after: '95.00' }] };
            if (s.includes('available_balance = available_balance + $2')) return { rows: [{ balance_before: '50.00', balance_after: '55.00' }] };
            if (s.includes('INSERT INTO transactions')) return { rows: [{ id: 'txn-' + client.queries.length }], rowCount: 1 };
            return { rows: [] };
        });
        CDB.db.getClient.mockResolvedValue(client);
        CDB.db.query.mockResolvedValue({ rows: [] });

        const res = await call('/api/account/transfer', { amount: 5, recipientAccountNumber: 'VB-2222' });
        expect(res.body.success).toBe(true);
        expect(res.body.transfer.newBalance).toBe(95);

        expect(client.queries[0]).toBe('BEGIN');
        expect(client.queries).toContain('COMMIT');
        expect(client.queries).not.toContain('ROLLBACK');
        expect(client.release).toHaveBeenCalled();

        // Atomicity: both ledger rows are INSIDE the same client transaction.
        const txnInserts = client.queries.filter((q) => q.includes('INSERT INTO transactions'));
        expect(txnInserts.length).toBe(2);
        expect(txnInserts.some((q) => q.includes('transfer_out'))).toBe(true);
        expect(txnInserts.some((q) => q.includes('transfer_in'))).toBe(true);
        // The transfer record is inside the same transaction.
        expect(client.queries.some((q) => q.includes('INSERT INTO transfers'))).toBe(true);
        // No separate helpers were used — everything on the pooled client.
        expect(CDB.createTransaction).not.toHaveBeenCalled();
        expect(CDB.createTransfer).not.toHaveBeenCalled();
    });

    test('transfer debits atomically: no debit row -> ROLLBACK, no COMMIT, no ledger, 400', async () => {
        const client = { queries: [], release: jest.fn() };
        client.query = jest.fn(async (sql) => {
            client.queries.push(sql);
            const s = String(sql).trim();
            if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [], rowCount: 0 };
            if (s.includes('INSERT INTO transfer_idempotency')) return { rows: [{ id: 'idem-1' }], rowCount: 1 };
            if (s.includes('INSERT INTO transfers')) return { rows: [{ id: 'tr-1' }], rowCount: 1 };
            if (s.includes('SELECT status, currency FROM accounts')) return { rows: [{ status: 'active', currency: 'USD' }] };
            if (s.includes('available_balance = available_balance - $2')) return { rows: [] }; // debit finds no row (available_balance guard failed)
            return { rows: [] };
        });
        CDB.db.getClient.mockResolvedValue(client);
        CDB.db.query.mockResolvedValue({ rows: [] });

        const res = await call('/api/account/transfer', { amount: 80, recipientAccountNumber: 'VB-2222' });
        expect(res.code).toBe(400);
        expect(res.body.message).toBe('Insufficient available funds.');
        expect(client.queries).toContain('ROLLBACK');
        expect(client.queries).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalled();
        // No ledger rows were written (they are inside the transaction that rolled back)
        expect(client.queries.filter((q) => q.includes('INSERT INTO transactions')).length).toBe(0);
        expect(CDB.createTransfer).not.toHaveBeenCalled();
        expect(CDB.createTransaction).not.toHaveBeenCalled();
    });

    test('transfer rolls back when the CREDIT half cannot find the recipient row', async () => {
        const client = { queries: [], release: jest.fn() };
        client.query = jest.fn(async (sql) => {
            client.queries.push(sql);
            const s = String(sql).trim();
            if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [], rowCount: 0 };
            if (s.includes('INSERT INTO transfer_idempotency')) return { rows: [{ id: 'idem-1' }], rowCount: 1 };
            if (s.includes('INSERT INTO transfers')) return { rows: [{ id: 'tr-1' }], rowCount: 1 };
            if (s.includes('available_balance = available_balance - $2')) return { rows: [{ balance_before: '100.00', balance_after: '95.00' }] };
            if (s.includes('SELECT status, currency FROM accounts')) return { rows: [{ status: 'active', currency: 'USD' }] };
            return { rows: [] }; // credit half failed (recipient deleted mid-flight)
        });
        CDB.db.getClient.mockResolvedValue(client);
        CDB.db.query.mockResolvedValue({ rows: [] });

        const res = await call('/api/account/transfer', { amount: 5, recipientAccountNumber: 'VB-2222' });
        expect(res.code).toBe(404);
        expect(client.queries).toContain('ROLLBACK');
        expect(client.queries).not.toContain('COMMIT');
        expect(client.queries.filter((q) => q.includes('INSERT INTO transactions')).length).toBe(0);
        expect(CDB.createTransfer).not.toHaveBeenCalled();
    });

    test('client error mid-transaction still releases the pooled connection', async () => {
        const client = {
            queries: [],
            release: jest.fn(),
            query: jest.fn(async (sql) => {
                client.queries.push(sql);
                if (String(sql).trim() === 'BEGIN') throw new Error('connection dropped');
                return { rows: [] };
            }),
        };
        CDB.db.getClient.mockResolvedValue(client);
        CDB.db.query.mockResolvedValue({ rows: [] });

        const res = await call('/api/account/transfer', { amount: 5, recipientAccountNumber: 'VB-2222' });
        expect(res.code).toBe(500);
        expect(client.release).toHaveBeenCalled();
        expect(CDB.createTransfer).not.toHaveBeenCalled();
    });
});