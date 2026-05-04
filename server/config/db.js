/**
 * PostgreSQL connection configuration using the `pg` library.
 * The connection string is taken from the `DATABASE_URL` environment variable.
 * In production environments SSL is required; the configuration disables
 * certificate verification to support self‑signed certificates commonly used
 * on managed services (e.g., Railway, Heroku).
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set.');
}

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Enable SSL in production; rejectUnauthorized false allows self‑signed certs.
    ssl: isProduction ? { rejectUnauthorized: false } : false,
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    pool,
};
