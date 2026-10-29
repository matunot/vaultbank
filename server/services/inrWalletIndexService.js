'use strict';

/**
 * Scope the INR wallet uniqueness guard to non-savings accounts.
 *
 * The original guard was `UNIQUE (user_id) WHERE currency = 'INR'`, which
 * blocked every INR savings vault as soon as the customer had an INR wallet.
 * Savings vaults are separate ledger accounts and must be allowed alongside
 * the wallet.
 */
const path = require('path');
const fs = require('fs');
const db = require('../config/db');

const MIGRATION_FILE = '015_scope_inr_wallet_unique_index.sql';
let schemaReady = false;
let schemaPromise = null;

async function ensureInrWalletIndex() {
    if (db.isDemo) return;
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
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
            const ready = await client.query(
                `SELECT indexdef FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'accounts_one_inr_per_user'
                  LIMIT 1`
            );
            const definition = ready.rows[0] && ready.rows[0].indexdef
                ? String(ready.rows[0].indexdef)
                : '';
            if (!definition.includes("currency = 'INR'") || !definition.includes('account_type')) {
                const error = new Error('INR wallet index did not pass its post-migration readiness check.');
                error.code = 'INR_WALLET_SCHEMA_NOT_READY';
                throw error;
            }
            await client.query('COMMIT');
            schemaReady = true;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
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

module.exports = { ensureInrWalletIndex };
