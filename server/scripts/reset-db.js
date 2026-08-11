/**
 * Reset database schema - DROPS ALL TABLES and re-creates from scratch
 * Usage: node server/scripts/reset-db.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

async function reset() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
        console.log('Dropping all tables in public schema...');
        await client.query('DROP SCHEMA public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('GRANT ALL ON SCHEMA public TO postgres');
        await client.query('GRANT ALL ON SCHEMA public TO public');
        console.log('Schema reset complete!');
    } finally {
        client.release();
        await pool.end();
    }
}
reset().catch(e => { console.error(e.message); process.exit(1); });