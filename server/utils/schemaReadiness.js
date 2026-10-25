/**
 * Read-only INR rail schema readiness.
 *
 * Reports ONLY object presence and migration filenames — never row data,
 * account numbers, credentials or customer records. Safe to run against
 * production: every statement is a SELECT on catalog views.
 */

const REQUIRED_MIGRATIONS = [
    '001_init.sql',
    '002_add_kyc_aml_fields.sql',
    '003_add_audit_logs.sql',
    '004_add_token_and_status_to_transfers.sql',
    '005_add_payments_settlements_idempotency.sql',
    '006_add_reconciliation_and_feature_flags.sql',
    '007_real_banking_schema.sql',
    '008_credit_schema.sql',
    '009_transfer_idempotency.sql',
    '010_payout_idempotency.sql',
    '011_vbr_payment_intents.sql',
    '012_global_transfer_idempotency.sql',
];

const REQUIRED_TABLES = [
    'users',
    'accounts',
    'transactions',
    'transfers',
    'transfer_idempotency',
    'payment_intents',
    'payout_requests',
    'virtual_accounts',
    'collection_events',
];

const REQUIRED_INDEXES = [
    'ux_transfer_idempotency_user_key',
    'payment_intent_idempotency_key',
    'ix_payment_intents_state',
    'payout_idempotency_user_key',
    'virtual_accounts_provider_va_uidx',
    'collection_events_provider_event_id_uidx',
];

// Presence alone is not enough for the idempotency arbiter indexes: a
// same-named non-unique index would make ON CONFLICT fail (or, worse, allow
// duplicate claims). These must be unique in PostgreSQL's catalog.
const UNIQUE_INDEXES = [
    'ux_transfer_idempotency_user_key',
    'payment_intent_idempotency_key',
    'payout_idempotency_user_key',
    'virtual_accounts_provider_va_uidx',
    'collection_events_provider_event_id_uidx',
];

const REQUIRED_COLUMNS = {
    accounts: ['id', 'user_id', 'currency', 'balance', 'available_balance', 'status'],
    transactions: ['id', 'account_id', 'user_id', 'type', 'status', 'amount', 'currency', 'balance_before', 'balance_after', 'external_reference'],
    transfer_idempotency: ['user_id', 'idempotency_key', 'currency'],
    payment_intents: ['id', 'user_id', 'account_id', 'idempotency_key', 'direction', 'method', 'amount', 'currency', 'state', 'transfer_id'],
    payout_requests: ['id', 'user_id', 'account_id', 'transfer_id', 'idempotency_key', 'bene_id', 'amount', 'currency', 'status'],
    virtual_accounts: ['provider', 'provider_virtual_account_id', 'user_id', 'account_id', 'status'],
    collection_events: ['provider', 'event_id', 'status', 'amount', 'currency', 'virtual_account_id', 'utr'],
};

async function checkSchema(db) {
    const result = {
        checkedAt: new Date().toISOString(),
        migrations: { tablePresent: false, required: REQUIRED_MIGRATIONS, applied: [], missing: REQUIRED_MIGRATIONS.slice(), ready: false },
        tables: {},
        indexes: {},
        indexUnique: {},
        columns: {},
        ready: false,
        notes: [],
    };

    const { rows: migrationTable } = await db.query(`
        SELECT to_regclass('public._migrations') IS NOT NULL AS present
    `);
    result.migrations.tablePresent = !!(migrationTable[0] && migrationTable[0].present);
    if (result.migrations.tablePresent) {
        const { rows } = await db.query('SELECT filename FROM _migrations ORDER BY filename');
        result.migrations.applied = rows.map((r) => r.filename);
        const applied = new Set(result.migrations.applied);
        result.migrations.missing = REQUIRED_MIGRATIONS.filter((m) => !applied.has(m));
        result.migrations.ready = result.migrations.missing.length === 0;
    } else {
        result.notes.push('_migrations table is missing — migration history cannot be verified.');
    }

    const { rows: tableRows } = await db.query(`
        SELECT t.name, to_regclass('public.' || t.name) IS NOT NULL AS present
        FROM unnest($1::text[]) AS t(name)
    `, [REQUIRED_TABLES]);
    for (const r of tableRows) result.tables[r.name] = !!r.present;

    const { rows: indexRows } = await db.query(`
        SELECT i.name,
               c.oid IS NOT NULL AS present,
               COALESCE(ix.indisunique, false) AS is_unique
        FROM unnest($1::text[]) AS i(name)
        LEFT JOIN pg_class c
               ON c.relname = i.name AND c.relnamespace = 'public'::regnamespace
        LEFT JOIN pg_index ix ON ix.indexrelid = c.oid
    `, [REQUIRED_INDEXES]);
    for (const r of indexRows) {
        result.indexes[r.name] = !!r.present;
        result.indexUnique[r.name] = !!r.is_unique;
    }

    const { rows: columnRows } = await db.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [Object.keys(REQUIRED_COLUMNS)]);
    const present = new Map();
    for (const r of columnRows) {
        if (!present.has(r.table_name)) present.set(r.table_name, new Set());
        present.get(r.table_name).add(r.column_name);
    }
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
        result.columns[table] = {};
        for (const col of cols) {
            result.columns[table][col] = !!(present.get(table) && present.get(table).has(col));
        }
    }

    const tablesOk = REQUIRED_TABLES.every((t) => result.tables[t] === true);
    const indexesOk = REQUIRED_INDEXES.every((i) => result.indexes[i] === true)
        && UNIQUE_INDEXES.every((i) => result.indexUnique[i] === true);
    const columnsOk = Object.values(result.columns).every((cols) => Object.values(cols).every(Boolean));
    result.ready = result.migrations.ready && tablesOk && indexesOk && columnsOk;

    if (!tablesOk) {
        const missing = REQUIRED_TABLES.filter((t) => result.tables[t] !== true);
        result.notes.push('Missing tables: ' + missing.join(', '));
        if (missing.some((t) => t === 'virtual_accounts' || t === 'collection_events')) {
            result.notes.push('virtual_accounts/collection_events are created lazily on the first collections request; they are absent until then.');
        }
    }
    if (!indexesOk) {
        const missing = REQUIRED_INDEXES.filter((i) => result.indexes[i] !== true);
        const notUnique = UNIQUE_INDEXES.filter((i) => result.indexes[i] === true && result.indexUnique[i] !== true);
        if (missing.length) result.notes.push('Missing indexes: ' + missing.join(', ') + '. The INR rails return 503 until the unique indexes exist.');
        if (notUnique.length) result.notes.push('Indexes are not unique: ' + notUnique.join(', ') + '. Idempotency cannot be DB-enforced until they are rebuilt as UNIQUE.');
    }
    return result;
}

module.exports = { checkSchema, REQUIRED_MIGRATIONS, REQUIRED_TABLES, REQUIRED_INDEXES, UNIQUE_INDEXES, REQUIRED_COLUMNS };
