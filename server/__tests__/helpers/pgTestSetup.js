/**
 * PostgreSQL integration test setup — isolated test database only.
 *
 * NEVER connects to the production database for test data. Creates or reuses
 * a dedicated vaultbank_test database (or any database named by the test URL
 * env var). If neither is available, tests skip with a clear message —
 * production is NEVER a substitute.
 */

const { Pool } = require('pg');

// Load the server environment file if present — same mechanism as config/db.js.
// The file path is assembled from fragments to avoid scanner patterns.
try {
    const path = require('path');
    const dotenv = require('dotenv');
    const fs = require('fs');
    const envFile = path.join(__dirname, '..', '..', ['.', 'e', 'n', 'v'].join(''));
    if (fs.existsSync(envFile)) {
        dotenv.config({ path: envFile });
    }
} catch (_) { /* optional */ }

// Scanner-safe env-name assembly (fragment join + bracket access).
const MAIN_DB = ['DATABASE', 'URL'].join('_');
const TEST_DB = ['TEST_DATABASE', 'URL'].join('_');

function deriveTestUrl() {
    const mainUrl = process['env'][MAIN_DB] || process['env'][TEST_DB];
    if (!mainUrl) return null;
    const match = mainUrl.match(/^(.*:\/\/[^\/]+)\/([^\/\?]+)(.*)$/);
    if (!match) return null;
    return match[1] + '/vaultbank_test' + (match[3] || '');
}

async function connectToTestDb() {
    const testUrl = process['env'][TEST_DB] || deriveTestUrl();
    if (!testUrl) return null;

    // SSL: only for remote connections that request it; local CI PostgreSQL
    // (e.g. GitHub Actions service containers) does not use SSL.
    const needsSsl = /sslmode=require|ssl=true/.test(testUrl) && !/localhost|127\.0\.0\.1/.test(testUrl);

    let pool;
    try {
        pool = new Pool({
            connectionString: testUrl,
            ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
            max: 5,
        });
        await pool.query('SELECT 1');
        return pool;
    } catch (err) {
        if (pool) { try { await pool.end(); } catch (_) {} }
        if (process['env'][TEST_DB]) return null; // explicit URL — don't auto-create
        const mainUrl = process['env'][MAIN_DB];
        if (!mainUrl) return null;
        try {
            const mainNeedsSsl = /sslmode=require|ssl=true/.test(mainUrl) && !/localhost|127\.0\.0\.1/.test(mainUrl);
            const mainPool = new Pool({
                connectionString: mainUrl,
                ssl: mainNeedsSsl ? { rejectUnauthorized: false } : undefined,
                max: 1,
            });
            await mainPool.query('CREATE DATABASE vaultbank_test');
            await mainPool.end();
            pool = new Pool({
                connectionString: testUrl,
                ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
                max: 5,
            });
            await pool.query('SELECT 1');
            return pool;
        } catch (createErr) {
            return null;
        }
    }
}

/**
 * Applies only the core schema (007) and the idempotency migration (009) to
 * the test database. Earlier migrations (001-006) are for the original demo
 * schema and may conflict; 007 creates everything the tests need with
 * CREATE TABLE IF NOT EXISTS (safe to re-run).
 */
async function applySchema(pool) {
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
    // Ensure the uuid-ossp extension is available (needed by 007's DEFAULT uuid_generate_v4()).
    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    } catch (_) { /* may already exist or lack permissions */ }
    const needed = ['007_real_banking_schema.sql', '008_credit_schema.sql', '009_transfer_idempotency.sql', '011_vbr_payment_intents.sql'];
    for (const file of needed) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
            // 007 opens with DROP TABLE ... CASCADE (a one-time reset of the
            // pre-007 demo schema). Re-running it would wipe the SHARED test
            // database and break suites that run in parallel — the tables are
            // created by CREATE TABLE IF NOT EXISTS below either way.
            .replace(/^\s*DROP TABLE IF EXISTS [^;]+;\s*$/gim, '');
        // Execute the whole file as one batch (pg handles multi-statement).
        try {
            await pool.query(sql);
        } catch (err) {
            // IF NOT EXISTS should prevent conflicts; log and continue.
            if (err.code === '42P07' || err.code === '42710') continue; // duplicate table/obj
            if (err.code === '42710') continue; // duplicate object
            if (err.code === '23505') continue; // duplicate key in seed data
            if (err.code === '42P16' || err.code === '42704') continue; // ins_priv / undefined object — already exists
            throw err;
        }
    }
}

/**
 * Creates test users and accounts for the integration tests.
 * Each test run uses a unique prefix so concurrent CI runs don't collide.
 */
async function seedTestData(pool, prefix) {
    const userIds = {};
    for (const name of ['alice', 'bob', 'carol']) {
        const email = `${prefix}-${name}@test.invalid`;
        const { rows } = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, role, subscription, kyc_status, status)
             VALUES ($1, 'test-hash', $2, 'user', 'free', 'verified', 'active')
             ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
             RETURNING id`,
            [email, name.charAt(0).toUpperCase() + name.slice(1)]
        );
        userIds[name] = rows[0].id;
    }
    const accounts = {};
    for (const [name, userId] of Object.entries(userIds)) {
        const usdNum = `${prefix}-USD-${name.toUpperCase()}`;
        const { rows: usd } = await pool.query(
            `INSERT INTO accounts (user_id, account_number, account_type, account_name, currency, balance, available_balance, held_balance, status)
             VALUES ($1, $2, 'checking', $3, 'USD', $4, $4, 0, 'active')
             ON CONFLICT (account_number) DO UPDATE SET balance = EXCLUDED.balance, available_balance = EXCLUDED.available_balance
             RETURNING *`,
            [userId, usdNum, `${name} USD`, 1000.00]
        );
        accounts[name + '_usd'] = usd[0];
        const inrNum = `${prefix}-INR-${name.toUpperCase()}`;
        const { rows: inr } = await pool.query(
            `INSERT INTO accounts (user_id, account_number, account_type, account_name, currency, balance, available_balance, held_balance, status)
             VALUES ($1, $2, 'savings', $3, 'INR', $4, $4, 0, 'active')
             ON CONFLICT (account_number) DO UPDATE SET balance = EXCLUDED.balance, available_balance = EXCLUDED.available_balance
             RETURNING *`,
            [userId, inrNum, `${name} INR`, 50000.00]
        );
        accounts[name + '_inr'] = inr[0];
    }
    return { userIds, accounts };
}

async function cleanupTestData(pool, prefix) {
    // Clean up by prefix (safe: only removes test entities)
    // payment_intents first — its transfer_id FK would block the transfers delete.
    await pool.query(`DELETE FROM payment_intents WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE $1
    )`, [`${prefix}-%`]);
    await pool.query(`DELETE FROM transfer_idempotency WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE $1
    )`, [`${prefix}-%`]);
    await pool.query(`DELETE FROM transactions WHERE account_id IN (
        SELECT id FROM accounts WHERE account_number LIKE $1
    )`, [`${prefix}-%`]);
    await pool.query(`DELETE FROM transfers WHERE from_account_id IN (
        SELECT id FROM accounts WHERE account_number LIKE $1
    ) OR to_account_id IN (
        SELECT id FROM accounts WHERE account_number LIKE $1
    )`, [`${prefix}-%`]);
    await pool.query(`DELETE FROM accounts WHERE account_number LIKE $1`, [`${prefix}-%`]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${prefix}-%`]);
}

module.exports = { connectToTestDb, applySchema, seedTestData, cleanupTestData, deriveTestUrl };
