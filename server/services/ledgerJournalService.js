/**
 * VaultBank-owned double-entry journal.
 *
 * This is the accounting layer for VaultBank's own rails; it is not a bank
 * connector and does not itself initiate external settlement. Every posted
 * journal uses exact decimal strings, one database transaction, source-level
 * idempotency, and a deferred PostgreSQL balance/currency constraint.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');

const MIGRATION_FILE = '013_vaultbank_double_entry_ledger.sql';
let schemaReady = false;
let schemaPromise = null;

const SYSTEM_ACCOUNTS = Object.freeze({
    OPENING_BALANCE_OFFSET: { type: 'opening_balance_offset', label: 'Unreconciled ledger cutover offset' },
    INBOUND_SETTLEMENT_ASSET: { type: 'settlement_asset', label: 'Inbound settlement clearing' },
    OUTBOUND_PAYOUTS_PAYABLE: { type: 'payout_payable', label: 'Payouts awaiting external settlement' },
    BANK_SETTLEMENT_ASSET: { type: 'settlement_asset', label: 'External bank settlement clearing' },
});

function toMinorUnits(value) {
    const s = String(value == null ? '' : value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(s)) {
        const error = new Error('Ledger amounts must be positive decimal strings with at most two fractional digits.');
        error.code = 'VB_LEDGER_AMOUNT_INVALID';
        throw error;
    }
    const [whole, fraction = ''] = s.split('.');
    const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
    if (units <= 0n) {
        const error = new Error('Ledger entry amounts must be greater than zero.');
        error.code = 'VB_LEDGER_AMOUNT_INVALID';
        throw error;
    }
    return units;
}

async function ensureVaultLedgerSchema() {
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        await db.ensureConnection();
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            // Serialize runtime migration with other application instances.
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtext('vaultbank-runtime-migration'), hashtext($1))",
                [MIGRATION_FILE]
            );
            await client.query(`
                CREATE TABLE IF NOT EXISTS _migrations (
                    id SERIAL PRIMARY KEY,
                    filename TEXT NOT NULL UNIQUE,
                    executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            `);
            const { rows } = await client.query(
                'SELECT filename FROM _migrations WHERE filename = $1 LIMIT 1',
                [MIGRATION_FILE]
            );
            if (rows.length === 0) {
                const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);
                const sql = fs.readFileSync(migrationPath, 'utf8');
                await client.query(sql);
                await client.query(
                    'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
                    [MIGRATION_FILE]
                );
            }
            const ready = await client.query(`
                SELECT
                    to_regclass('public.vb_ledger_accounts') IS NOT NULL AS accounts,
                    to_regclass('public.vb_ledger_journals') IS NOT NULL AS journals,
                    to_regclass('public.vb_ledger_entries') IS NOT NULL AS entries,
                    to_regclass('public.vb_ledger_bootstrap') IS NOT NULL AS bootstrap,
                    EXISTS (SELECT 1 FROM vb_ledger_bootstrap WHERE singleton_id = 1 AND cutover_at IS NOT NULL) AS cutover_done
            `);
            const status = ready.rows[0];
            if (!status || !status.accounts || !status.journals || !status.entries || !status.bootstrap || !status.cutover_done) {
                const error = new Error('VaultBank ledger schema did not pass its post-migration readiness check.');
                error.code = 'VB_LEDGER_SCHEMA_NOT_READY';
                throw error;
            }
            await client.query('COMMIT');
            schemaReady = true;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw error;
        } finally {
            client.release();
        }
    })();

    try {
        await schemaPromise;
    } catch (error) {
        schemaPromise = null;
        throw error;
    }
}

async function getSystemLedgerAccount(client, systemCode, currency) {
    const code = String(systemCode || '').trim().toUpperCase();
    const cur = String(currency || '').trim().toUpperCase();
    const definition = SYSTEM_ACCOUNTS[code];
    if (!definition) {
        const error = new Error('Unknown VaultBank system ledger account.');
        error.code = 'VB_LEDGER_SYSTEM_ACCOUNT_UNKNOWN';
        throw error;
    }
    if (!['INR', 'USD'].includes(cur)) {
        const error = new Error('Unsupported VaultBank ledger currency.');
        error.code = 'VB_LEDGER_CURRENCY_UNSUPPORTED';
        throw error;
    }

    await client.query(
        `INSERT INTO vb_ledger_accounts (account_id, system_code, currency, account_type, label)
         VALUES (NULL, $1, $2, $3, $4)
         ON CONFLICT (system_code, currency) WHERE system_code IS NOT NULL DO NOTHING`,
        [code, cur, definition.type, definition.label]
    );
    const { rows } = await client.query(
        'SELECT id, currency, account_type FROM vb_ledger_accounts WHERE system_code = $1 AND currency = $2 LIMIT 1',
        [code, cur]
    );
    if (!rows[0] || rows[0].account_type !== definition.type) {
        const error = new Error('VaultBank system ledger account is not configured consistently.');
        error.code = 'VB_LEDGER_ACCOUNT_NOT_READY';
        throw error;
    }
    return rows[0];
}

/**
 * Ensure a customer ledger account exists before mutating its balance.
 * For accounts created after the one-time cutover, the current balance is
 * captured as a one-time opening journal while the account row is locked.
 * Call this inside the same transaction that will change the account balance.
 */
async function ensureCustomerLedgerAccount(client, accountId) {
    const { rows: accountRows } = await client.query(
        'SELECT id, currency, balance FROM accounts WHERE id = $1 FOR UPDATE',
        [accountId]
    );
    const account = accountRows[0];
    if (!account) {
        const error = new Error('VaultBank ledger cannot map a missing account.');
        error.code = 'VB_LEDGER_ACCOUNT_NOT_FOUND';
        throw error;
    }
    const currency = String(account.currency || '').trim().toUpperCase();
    if (!['INR', 'USD'].includes(currency)) {
        const error = new Error('VaultBank ledger does not support this account currency.');
        error.code = 'VB_LEDGER_CURRENCY_UNSUPPORTED';
        throw error;
    }

    const inserted = await client.query(
        `INSERT INTO vb_ledger_accounts (account_id, system_code, currency, account_type, label)
         VALUES ($1, NULL, $2, 'customer_liability', 'Customer account balance')
         ON CONFLICT (account_id) WHERE account_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [account.id, currency]
    );
    const ledgerResult = inserted.rows.length
        ? { rows: inserted.rows }
        : await client.query(
            'SELECT id FROM vb_ledger_accounts WHERE account_id = $1 LIMIT 1',
            [account.id]
        );
    const customerLedgerAccount = ledgerResult.rows[0];
    if (!customerLedgerAccount) {
        const error = new Error('VaultBank customer ledger account could not be initialized.');
        error.code = 'VB_LEDGER_ACCOUNT_NOT_READY';
        throw error;
    }

    // Account-row locking serializes first-use initialization with concurrent
    // deposits, withdrawals and internal transfers.
    if (inserted.rows.length && toMinorUnits(String(account.balance || '0.00')) > 0n) {
        const openingAmount = String(account.balance);
        const systemAccount = await getSystemLedgerAccount(client, 'OPENING_BALANCE_OFFSET', currency);
        const journal = await client.query(
            `INSERT INTO vb_ledger_journals
                (event_type, source_type, source_id, currency, description, metadata)
             VALUES ('opening_balance', 'account', $1, $2,
                     'Initial VaultBank ledger balance — independent reconciliation required',
                     '{"cutover":"v1","openingBalanceReconciled":false}'::jsonb)
             ON CONFLICT (event_type, source_type, source_id) DO NOTHING
             RETURNING id`,
            [String(account.id), currency]
        );
        if (journal.rows.length) {
            await client.query(
                'INSERT INTO vb_ledger_entries (journal_id, ledger_account_id, side, amount) VALUES ($1, $2, $3, $4)',
                [journal.rows[0].id, systemAccount.id, 'debit', openingAmount]
            );
            await client.query(
                'INSERT INTO vb_ledger_entries (journal_id, ledger_account_id, side, amount) VALUES ($1, $2, $3, $4)',
                [journal.rows[0].id, customerLedgerAccount.id, 'credit', openingAmount]
            );
        }
    }

    return { id: customerLedgerAccount.id, currency, accountId: account.id };
}

async function resolveEntryAccount(client, entry, currency) {
    if (entry.accountId) {
        const { rows } = await client.query(
            'SELECT id, currency, account_type FROM vb_ledger_accounts WHERE account_id = $1 LIMIT 1',
            [entry.accountId]
        );
        const account = rows[0];
        if (!account || account.account_type !== 'customer_liability') {
            const error = new Error('Customer ledger account must be initialized before posting a money movement.');
            error.code = 'VB_LEDGER_ACCOUNT_NOT_INITIALIZED';
            throw error;
        }
        if (String(account.currency).toUpperCase() !== currency) {
            const error = new Error('Ledger journal cannot mix currencies.');
            error.code = 'VB_LEDGER_CURRENCY_MISMATCH';
            throw error;
        }
        return { id: account.id, canonical: 'account:' + entry.accountId };
    }
    const account = await getSystemLedgerAccount(client, entry.systemCode, currency);
    return { id: account.id, canonical: 'system:' + String(entry.systemCode).toUpperCase() };
}

async function postBalancedJournal(client, input) {
    if (!schemaReady) {
        const error = new Error('VaultBank ledger schema must be initialized before posting.');
        error.code = 'VB_LEDGER_SCHEMA_NOT_READY';
        throw error;
    }
    const eventType = String(input.eventType || '').trim();
    const sourceType = String(input.sourceType || '').trim();
    const sourceId = String(input.sourceId || '').trim();
    const currency = String(input.currency || '').trim().toUpperCase();
    const entries = Array.isArray(input.entries) ? input.entries : [];
    if (!eventType || !sourceType || !sourceId || sourceId.length > 200 || !['INR', 'USD'].includes(currency)) {
        const error = new Error('VaultBank journal source and currency are invalid.');
        error.code = 'VB_LEDGER_JOURNAL_INVALID';
        throw error;
    }
    if (entries.length < 2) {
        const error = new Error('A posted VaultBank journal needs at least two entries.');
        error.code = 'VB_LEDGER_JOURNAL_INVALID';
        throw error;
    }

    const resolved = [];
    let debitTotal = 0n;
    let creditTotal = 0n;
    for (const entry of entries) {
        const side = String(entry.side || '').toLowerCase();
        if (!['debit', 'credit'].includes(side)) {
            const error = new Error('VaultBank journal side must be debit or credit.');
            error.code = 'VB_LEDGER_JOURNAL_INVALID';
            throw error;
        }
        const amount = String(entry.amount == null ? '' : entry.amount).trim();
        const minorUnits = toMinorUnits(amount);
        if (side === 'debit') debitTotal += minorUnits;
        else creditTotal += minorUnits;
        const account = await resolveEntryAccount(client, entry, currency);
        resolved.push({ ledgerAccountId: account.id, canonical: account.canonical, side, amount, minorUnits: minorUnits.toString() });
    }
    if (debitTotal !== creditTotal || new Set(resolved.map(e => e.ledgerAccountId)).size < 2) {
        const error = new Error('VaultBank journal must balance across at least two distinct ledger accounts.');
        error.code = 'VB_LEDGER_JOURNAL_UNBALANCED';
        throw error;
    }

    const key = [eventType, sourceType, sourceId];
    const existing = await client.query(
        'SELECT id, currency FROM vb_ledger_journals WHERE event_type = $1 AND source_type = $2 AND source_id = $3 LIMIT 1 FOR UPDATE',
        key
    );
    if (existing.rows.length) {
        const journal = existing.rows[0];
        const { rows } = await client.query(
            `SELECT e.side, e.amount::text AS amount, la.account_id, la.system_code
               FROM vb_ledger_entries e
               JOIN vb_ledger_accounts la ON la.id = e.ledger_account_id
              WHERE e.journal_id = $1
              ORDER BY e.side, COALESCE(la.account_id::text, la.system_code), e.amount::text`,
            [journal.id]
        );
        const expected = resolved.map(e => ({
            side: e.side,
            amount: e.amount,
            account_id: e.canonical.startsWith('account:') ? e.canonical.slice(8) : null,
            system_code: e.canonical.startsWith('system:') ? e.canonical.slice(7) : null,
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const actual = rows.map(e => ({
            side: e.side,
            amount: String(e.amount),
            account_id: e.account_id == null ? null : String(e.account_id),
            system_code: e.system_code == null ? null : String(e.system_code),
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        if (String(journal.currency).toUpperCase() !== currency || JSON.stringify(actual) !== JSON.stringify(expected)) {
            const error = new Error('VaultBank journal source was already posted with different material entries.');
            error.code = 'VB_LEDGER_IDEMPOTENCY_CONFLICT';
            throw error;
        }
        return { journalId: journal.id, replay: true };
    }

    const inserted = await client.query(
        `INSERT INTO vb_ledger_journals
            (event_type, source_type, source_id, currency, description, actor_user_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (event_type, source_type, source_id) DO NOTHING
         RETURNING id`,
        [eventType, sourceType, sourceId, currency, String(input.description || eventType), input.actorUserId || null, JSON.stringify(input.metadata || {})]
    );
    if (!inserted.rows.length) {
        // A concurrent transaction won the idempotency claim. The unique
        // constraint serializes this write; read the winner, then replay-check.
        const { rows } = await client.query(
            'SELECT id FROM vb_ledger_journals WHERE event_type = $1 AND source_type = $2 AND source_id = $3 LIMIT 1',
            key
        );
        if (!rows[0]) {
            const error = new Error('VaultBank journal idempotency outcome is unknown.');
            error.code = 'VB_LEDGER_OUTCOME_UNKNOWN';
            throw error;
        }
        const { rows: priorLines } = await client.query(
            `SELECT e.side, e.amount::text AS amount, la.account_id, la.system_code
               FROM vb_ledger_entries e JOIN vb_ledger_accounts la ON la.id = e.ledger_account_id
              WHERE e.journal_id = $1`,
            [rows[0].id]
        );
        if (priorLines.length !== resolved.length) {
            const error = new Error('VaultBank journal source already exists with different material entries.');
            error.code = 'VB_LEDGER_IDEMPOTENCY_CONFLICT';
            throw error;
        }
        return { journalId: rows[0].id, replay: true };
    }

    const journalId = inserted.rows[0].id;
    for (const entry of resolved) {
        await client.query(
            'INSERT INTO vb_ledger_entries (journal_id, ledger_account_id, side, amount) VALUES ($1, $2, $3, $4)',
            [journalId, entry.ledgerAccountId, entry.side, entry.amount]
        );
    }
    return { journalId, replay: false };
}

module.exports = { ensureVaultLedgerSchema, ensureCustomerLedgerAccount, postBalancedJournal, toMinorUnits };
