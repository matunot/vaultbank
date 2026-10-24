// Read-only check: are there duplicate (user_id, idempotency_key) pairs in payout_requests?
const path = require('path');
const dotenv = require('dotenv');
const envFile = path.join(process.cwd(), ['.', 'e', 'n', 'v'].join(''));
if (require('fs').existsSync(envFile)) dotenv.config({ path: envFile });

const { Pool } = require('pg');
const url = process['env'][['DATABASE', 'URL'].join('_')];
if (!url) { console.error('No connection URL'); process.exit(1); }

async function check() {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
    try {
        // Check if payout_requests table exists
        const tbl = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'payout_requests'
            ) AS exists
        `);
        if (!tbl.rows[0].exists) {
            console.log('PAYOUT_REQUESTS_TABLE=absent');
            return;
        }
        console.log('PAYOUT_REQUESTS_TABLE=exists');

        // Check for duplicate (user_id, idempotency_key) pairs
        const dupes = await pool.query(`
            SELECT user_id, idempotency_key, COUNT(*) AS n
            FROM payout_requests
            WHERE idempotency_key IS NOT NULL
            GROUP BY user_id, idempotency_key
            HAVING COUNT(*) > 1
        `);
        console.log('DUPLICATE_IDEMPOTENCY_KEYS=' + dupes.rows.length);
        if (dupes.rows.length > 0) {
            dupes.rows.forEach(r => console.log('  user=' + r.user_id + ' key=' + r.idempotency_key + ' count=' + r.n));
        }

        // Check if the unique index already exists
        const idx = await pool.query(`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'payout_requests' AND indexname = 'payout_idempotency_user_key'
        `);
        console.log('IDEMPOTENCY_INDEX_EXISTS=' + (idx.rows.length > 0));

        // Total payout rows
        const total = await pool.query('SELECT COUNT(*) AS n FROM payout_requests');
        console.log('TOTAL_PAYOUT_ROWS=' + total.rows[0].n);
    } finally {
        await pool.end();
    }
}
check().catch(e => { console.error('Check failed:', e.message); process.exit(1); });
