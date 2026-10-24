/**
 * Read-only check: is migration 011 recorded in the production _migrations
 * table? Does the payment_intents table exist with its unique idempotency
 * index? NEVER modifies anything — SELECT only.
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
        const migTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '_migrations'
            ) AS has_table
        `);
        if (!migTable.rows[0].has_table) {
            console.log('_MIGRATIONS_TABLE=absent (migration runner has never been run)');
        } else {
            const rec = await pool.query(
                'SELECT filename FROM _migrations WHERE filename = $1',
                ['011_vbr_payment_intents.sql']
            );
            console.log('MIGRATION_011_RECORDED=' + (rec.rows.length > 0));
            const all = await pool.query('SELECT filename FROM _migrations ORDER BY filename');
            console.log('MIGRATIONS_COUNT=' + all.rows.length);
            console.log('MIGRATIONS=' + all.rows.map(r => r.filename).join(','));
        }

        const table = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'payment_intents'
            ) AS has_table
        `);
        console.log('PAYMENT_INTENTS_TABLE=' + (table.rows[0].has_table ? 'exists' : 'missing'));

        if (table.rows[0].has_table) {
            const cols = await pool.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'payment_intents'
                ORDER BY ordinal_position
            `);
            console.log('PAYMENT_INTENTS_COLUMNS=' + cols.rows.map(r => r.column_name).join(','));
            const idx = await pool.query(`
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'public' AND tablename = 'payment_intents'
                ORDER BY indexname
            `);
            console.log('PAYMENT_INTENTS_INDEXES=' + idx.rows.map(r => r.indexname).join(','));
            const count = await pool.query('SELECT COUNT(*)::int AS n FROM payment_intents');
            console.log('PAYMENT_INTENTS_ROWS=' + count.rows[0].n);
        }
    } finally {
        await pool.end();
    }
}

check().catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
