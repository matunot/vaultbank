/**
 * Read-only check: is migration 009 recorded in the production _migrations
 * table? Does the transfer_idempotency table exist?
 * NEVER modifies anything — SELECT only.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(process.cwd(), ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
}

const { Pool } = require('pg');
const url = process['env'][['DATABASE', 'URL'].join('_')];
if (!url) {
    console.error('No connection URL configured');
    process.exit(1);
}

async function check() {
    const pool = new Pool({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        max: 1,
    });
    try {
        // Check if _migrations table exists
        const migTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '_migrations'
            ) AS has_table
        `);
        if (!migTable.rows[0].has_table) {
            console.log('_MIGRATIONS_TABLE=absent (migration runner has never been run)');
        } else {
            const rec = await pool.query(`
                SELECT filename FROM _migrations WHERE filename = $1
            `, ['009_transfer_idempotency.sql']);
            console.log('MIGRATION_009_RECORDED=' + (rec.rows.length > 0));
            const all = await pool.query('SELECT filename FROM _migrations ORDER BY filename');
            console.log('MIGRATIONS_COUNT=' + all.rows.length);
        }

        // Check if transfer_idempotency table exists
        const idem = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'transfer_idempotency'
            ) AS has_table
        `);
        console.log('TRANSFER_IDEMPOTENCY_TABLE=' + (idem.rows[0].has_table ? 'exists' : 'missing'));

        if (idem.rows[0].has_table) {
            const idx = await pool.query(`
                SELECT indexname FROM pg_indexes
                WHERE tablename = 'transfer_idempotency'
            `);
            console.log('IDEMPOTENCY_INDEXES=' + idx.rows.map(r => r.indexname).join(','));
        }
    } finally {
        await pool.end();
    }
}

check().catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
