/**
 * VaultBank Database Migration Runner
 * Runs all SQL migration files against the PostgreSQL database
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config(); // load the server environment file from the working directory (run from server/)

const DATABASE_URL = process.env.DATABASE_URL || (() => { console.error('database URL is not set - run this script from the server directory with the environment file present'); process.exit(1); })();

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const migrationsDir = path.join(__dirname, '..', 'migrations');

async function runMigrations() {
    const client = await pool.connect();
    
    try {
        // Create migrations tracking table
        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                filename TEXT NOT NULL UNIQUE,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Get list of migration files
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        console.log(`Found ${files.length} migration files`);

        // Get already executed migrations
        const executed = await client.query('SELECT filename FROM _migrations');
        const executedFiles = new Set(executed.rows.map(r => r.filename));

        for (const file of files) {
            if (executedFiles.has(file)) {
                console.log(`â­ï¸  Skipping ${file} (already executed)`);
                continue;
            }

            console.log(`â–¶ï¸  Running migration: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log(`âœ… ${file} - Success`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`âŒ ${file} - Failed:`, err.message);
                // Continue with next migration
            }
        }

        console.log('\nâœ… All migrations completed!');

        // Verify tables exist
        const tables = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        console.log('\nðŸ“Š Database tables:');
        tables.rows.forEach(t => console.log(`   - ${t.table_name}`));

    } catch (err) {
        console.error('Migration runner error:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations();
