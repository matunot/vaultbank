/**
 * PostgreSQL connection configuration using the `pg` library.
 * The connection string is taken from the `DATABASE_URL` environment variable.
 * In production environments SSL is required; the configuration disables
 * certificate verification to support self‑signed certificates commonly used
 * on managed services (e.g., Railway, Heroku).
 */

// Load environment variables from the project's root .env file.
// This ensures that any module requiring this DB configuration has access to
// DATABASE_URL and other settings, even when the script is executed from a
// different working directory (e.g., scripts/check_audit_logs.js).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

// Gracefully handle missing DATABASE_URL for demo/serverless mode
let pool = null;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // Enable SSL in production; rejectUnauthorized false allows self‑signed certs.
        ssl: isProduction ? { rejectUnauthorized: false } : false,
    });
} else {
    console.warn('⚠️  DATABASE_URL not set. Running in demo mode (no database).');
}

module.exports = {
    query: (text, params) => {
        if (!pool) {
            console.warn('Database query skipped (no DATABASE_URL):', text);
            return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return pool.query(text, params);
    },
    getClient: () => {
        if (!pool) {
            throw new Error('Database not configured (DATABASE_URL not set)');
        }
        return pool.connect();
    },
    pool,
    isDemo: !pool,
};
