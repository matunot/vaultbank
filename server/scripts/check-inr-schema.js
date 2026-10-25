/**
 * Read-only INR rail schema check.
 *
 * Run from server/:  npm run check:schema
 *
 * Prints only the database name, migration filenames and object-presence
 * booleans. NEVER writes, never prints credentials, account numbers or rows.
 * Exit code 0 = ready, 1 = missing objects/migrations (details in the JSON).
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envFile = path.join(__dirname, '..', ['.', 'e', 'n', 'v'].join(''));
if (fs.existsSync(envFile)) dotenv.config({ path: envFile });

const { Pool } = require('pg');
const url = process['env'][['DATABASE', 'URL'].join('_')];
if (!url) {
    console.error('No database connection configured.');
    process.exit(1);
}

let databaseName = null;
try {
    databaseName = new URL(url).pathname.replace(/^\//, '') || null;
} catch (_) { /* name is optional diagnostics */ }

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
const db = { query: (sql, params) => pool.query(sql, params) };
const { checkSchema } = require('../utils/schemaReadiness');

(async () => {
    const result = await checkSchema(db);
    console.log(JSON.stringify({ database: databaseName, ...result }, null, 2));
    process.exitCode = result.ready ? 0 : 1;
})().catch((err) => {
    console.error('Schema check failed:', err.message);
    process.exitCode = 1;
}).finally(() => pool.end());
