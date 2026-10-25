/**
 * INR collections schema (lazy, idempotent).
 *
 * These two tables are not in migrations 001-012, so this module is the
 * deployed source of truth. The composite unique indexes are REQUIRED:
 *   - virtual_accounts(provider, provider_virtual_account_id) is the arbiter
 *     for the provisioning ON CONFLICT;
 *   - collection_events(provider, event_id) is the arbiter for the webhook
 *     event claim.
 * Without them PostgreSQL raises 42P10 ("no unique or exclusion constraint
 * matching the ON CONFLICT specification") and both rails fail closed.
 *
 * If an index cannot be created (for example historical duplicate events),
 * readiness stays false and the routes return 503 rather than risk a duplicate
 * credit. An operator must resolve the rows; no financial data is deleted here.
 */

const { db } = require('../config/database');

let tablesReady = false;

async function ensureCollectionsSchema() {
    if (tablesReady) return;
    await db.ensureConnection();

    await db.query(`
        CREATE TABLE IF NOT EXISTS virtual_accounts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            provider TEXT NOT NULL,
            provider_virtual_account_id TEXT NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id UUID NOT NULL,
            currency TEXT NOT NULL DEFAULT 'INR',
            bank_code TEXT,
            account_number TEXT,
            ifsc TEXT,
            status TEXT NOT NULL DEFAULT 'provisioning'
                CHECK (status IN ('provisioning','active','conflict','error','disabled')),
            provisioned_at TIMESTAMP WITH TIME ZONE,
            last_error TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    try {
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS virtual_accounts_provider_va_uidx
            ON virtual_accounts (provider, provider_virtual_account_id)
        `);
    } catch (err) {
        console.error('[collections] virtual account unique index not ready:', err.message);
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS collection_events (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            provider TEXT NOT NULL,
            event_id TEXT NOT NULL,
            event_type TEXT,
            status TEXT NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','credited','credited_duplicate','unmatched','currency_rejected','failed')),
            amount NUMERIC(15,2),
            currency TEXT,
            virtual_account_id TEXT,
            utr TEXT,
            credited_at TIMESTAMP WITH TIME ZONE,
            payload JSONB,
            received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    try {
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS collection_events_provider_event_id_uidx
            ON collection_events (provider, event_id)
        `);
    } catch (err) {
        console.error('[collections] event unique index not ready:', err.message);
    }

    // Presence by name is not enough: a non-unique index with the same name
    // would not arbitrate ON CONFLICT. Require indisunique for both.
    const { rows } = await db.query(`
        SELECT (
            COALESCE((SELECT indisunique FROM pg_index
                       WHERE indexrelid = to_regclass('public.virtual_accounts_provider_va_uidx')), false)
            AND
            COALESCE((SELECT indisunique FROM pg_index
                       WHERE indexrelid = to_regclass('public.collection_events_provider_event_id_uidx')), false)
        ) AS ready
    `);
    if (!rows[0] || !rows[0].ready) {
        const err = new Error('INR collections schema is missing required unique indexes — an operator must resolve duplicate rows before crediting.');
        err.code = 'COLLECTIONS_SCHEMA_NOT_READY';
        throw err;
    }
    tablesReady = true;
}

module.exports = { ensureCollectionsSchema };
