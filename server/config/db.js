/**
 * VAULTBANK DATABASE CONFIGURATION - REAL POSTGRESQL
 * ================================================
 * Uses Neon PostgreSQL for real data persistence.
 * Falls back to in-memory demo mode if DATABASE_URL is not set.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');

// ─── Compatibility flags ─────────────────────────────────────────────────────
// Auto-detect demo mode: if no DATABASE_URL is configured, fall back to the
// in-memory demo store so the API keeps working (e.g., on Render free tier
// where DATABASE_URL may not have been configured in the dashboard).
const isDemo = !process.env.DATABASE_URL;
const isMongo = false;

// ─── PostgreSQL Connection Pool ──────────────────────────────────────────────
const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode') 
        ? { rejectUnauthorized: false } 
        : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
}) : null;

if (pool) {
    pool.on('error', (err) => {
        console.error('❌ Unexpected PostgreSQL pool error:', err.message);
    });
}

let isConnected = false;

// ─── Connection Management ───────────────────────────────────────────────────
async function ensureConnection() {
    if (isDemo) return; // No DB to connect to in demo mode
    if (isConnected) return;
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        isConnected = true;
        console.info('✅ PostgreSQL database connection established');
    } catch (err) {
        console.error('❌ Failed to connect to PostgreSQL:', err.message);
        // Don't throw — allow demo fallback in the calling code
    }
}

// ─── Query Helper ────────────────────────────────────────────────────────────
async function query(text, params) {
    if (isDemo) {
        throw new Error('Database not available in demo mode. Use demoStore functions instead.');
    }
    await ensureConnection();
    const client = await pool.connect();
    try {
        const result = await client.query(text, params);
        return { rows: result.rows, rowCount: result.rowCount };
    } finally {
        client.release();
    }
}

// ─── Transaction Client Helper ───────────────────────────────────────────────
async function getClient() {
    if (isDemo) {
        throw new Error('Database not available in demo mode. Use demoStore functions instead.');
    }
    await ensureConnection();
    const client = await pool.connect();
    return {
        query: async (text, params) => {
            const result = await client.query(text, params);
            return { rows: result.rows, rowCount: result.rowCount };
        },
        release: () => client.release(),
    };
}

// ─── Mongoose-like model stubs (for backward compat with routes) ─────────────
// These provide a thin compatibility layer so existing routes that use
// db.User, db.Account etc. can work with PostgreSQL
const models = {};

// User model compat
models.User = {
    findOne: async (filter) => {
        if (filter.email) {
            const { rows } = await query('SELECT * FROM users WHERE email = $1', [filter.email]);
            return rows[0] || null;
        }
        if (filter._id) {
            const { rows } = await query('SELECT * FROM users WHERE id = $1', [filter._id]);
            return rows[0] || null;
        }
        const { rows } = await query('SELECT * FROM users LIMIT 1');
        return rows[0] || null;
    },
    findById: async (id) => {
        const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
        return rows[0] || null;
    },
    find: async (filter = {}) => {
        let sql = 'SELECT * FROM users';
        const params = [];
        if (filter.email && filter.email.$regex) {
            sql += ' WHERE email ILIKE $1';
            params.push('%' + filter.email.$regex.source.replace(/\.\*/g, '%') + '%');
        }
        sql += ' ORDER BY created_at DESC';
        const { rows } = await query(sql, params);
        return rows;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO users (email, password_hash, full_name, phone, role, subscription, kyc_status, status, email_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            data.email,
            data.password_hash,
            data.full_name || data.fullName,
            data.phone || null,
            data.role || 'user',
            data.subscription || 'free',
            data.kyc_status || 'pending',
            data.status || 'active',
            data.email_verified || false,
        ]);
        return rows[0];
    },
    findByIdAndUpdate: async (id, update) => {
        const setClauses = [];
        const params = [];
        let idx = 1;
        const setData = update.$set || update;
        for (const [key, value] of Object.entries(setData)) {
            setClauses.push(`${key} = $${idx++}`);
            params.push(value);
        }
        params.push(id);
        const { rows } = await query(`
            UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *
        `, params);
        return rows[0] || null;
    },
    findOneAndUpdate: async (filter, update) => {
        if (filter.user_id) {
            const setClauses = [];
            const params = [];
            let idx = 1;
            const setData = update.$set || update;
            for (const [key, value] of Object.entries(setData)) {
                setClauses.push(`${key} = $${idx++}`);
                params.push(value);
            }
            if (update.$inc) {
                for (const [key, value] of Object.entries(update.$inc)) {
                    setClauses.push(`${key} = ${key} + $${idx++}`);
                    params.push(value);
                }
            }
            params.push(filter.user_id);
            const { rows } = await query(`
                UPDATE rewards SET ${setClauses.join(', ')} WHERE user_id = $${idx} RETURNING *
            `, params);
            return rows[0] || null;
        }
        return null;
    },
    countDocuments: async () => {
        const { rows } = await query('SELECT COUNT(*) as count FROM users');
        return parseInt(rows[0].count);
    },
};

// Account model compat
models.Account = {
    findOne: async (filter) => {
        if (filter.user_id) {
            const { rows } = await query('SELECT * FROM accounts WHERE user_id = $1 AND status = $2 ORDER BY created_at ASC LIMIT 1', [filter.user_id, filter.status || 'active']);
            return rows[0] || null;
        }
        if (filter.account_number) {
            const { rows } = await query('SELECT * FROM accounts WHERE account_number = $1', [filter.account_number]);
            return rows[0] || null;
        }
        const { rows } = await query('SELECT * FROM accounts LIMIT 1');
        return rows[0] || null;
    },
    findById: async (id) => {
        const { rows } = await query('SELECT * FROM accounts WHERE id = $1', [id]);
        return rows[0] || null;
    },
    find: async (filter = {}) => {
        let sql = 'SELECT * FROM accounts';
        const params = [];
        if (filter.user_id) {
            sql += ' WHERE user_id = $1';
            params.push(filter.user_id);
        }
        sql += ' ORDER BY created_at ASC';
        const { rows } = await query(sql, params);
        return rows;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO accounts (user_id, account_number, account_type, account_name, currency, balance, available_balance, status, interest_rate)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            data.user_id,
            data.account_number,
            data.account_type || 'checking',
            data.account_name || 'Primary Account',
            data.currency || 'USD',
            data.balance || 0,
            data.available_balance || 0,
            data.status || 'active',
            data.interest_rate || 0.0000,
        ]);
        return rows[0];
    },
    findByIdAndUpdate: async (id, update) => {
        const setClauses = [];
        const params = [];
        let idx = 1;
        const setData = update.$set || update;
        for (const [key, value] of Object.entries(setData)) {
            setClauses.push(`${key} = $${idx++}`);
            params.push(value);
        }
        params.push(id);
        const { rows } = await query(`
            UPDATE accounts SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *
        `, params);
        return rows[0] || null;
    },
};

// Transaction model compat
models.Transaction = {
    find: async (filter = {}, options = {}) => {
        let sql = 'SELECT * FROM transactions WHERE 1=1';
        const params = [];
        let idx = 1;
        if (filter.user_id) {
            sql += ` AND user_id = $${idx++}`;
            params.push(filter.user_id);
        }
        if (filter.type) {
            sql += ` AND type = $${idx++}`;
            params.push(filter.type);
        }
        if (filter.created_at && filter.created_at.$gte) {
            sql += ` AND created_at >= $${idx++}`;
            params.push(filter.created_at.$gte);
        }
        if (filter.created_at && filter.created_at.$lte) {
            sql += ` AND created_at <= $${idx++}`;
            params.push(filter.created_at.$lte);
        }
        sql += ' ORDER BY created_at DESC';
        if (options.limit) {
            sql += ` LIMIT $${idx++}`;
            params.push(options.limit);
        }
        if (options.skip) {
            sql += ` OFFSET $${idx++}`;
            params.push(options.skip);
        }
        const { rows } = await query(sql, params);
        return rows;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO transactions (account_id, user_id, type, status, amount, currency, balance_before, balance_after, description, category, reference_id, external_reference, counterparty_name, counterparty_account, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            data.account_id,
            data.user_id,
            data.type,
            data.status || 'completed',
            data.amount,
            data.currency || 'USD',
            data.balance_before || 0,
            data.balance_after || 0,
            data.description || null,
            data.category || null,
            data.reference_id || null,
            data.external_reference || null,
            data.counterparty_name || null,
            data.counterparty_account || null,
            JSON.stringify(data.metadata || {}),
        ]);
        return rows[0];
    },
};

// Transfer model compat
models.Transfer = {
    find: async (filter = {}, options = {}) => {
        let sql = 'SELECT * FROM transfers WHERE 1=1';
        const params = [];
        let idx = 1;
        if (filter.$or) {
            sql += ` AND (from_user_id = $${idx} OR to_user_id = $${idx})`;
            params.push(filter.$or[0].from_user_id);
            idx++;
        }
        sql += ' ORDER BY created_at DESC';
        if (options.limit) {
            sql += ` LIMIT $${idx++}`;
            params.push(options.limit);
        }
        if (options.skip) {
            sql += ` OFFSET $${idx++}`;
            params.push(options.skip);
        }
        const { rows } = await query(sql, params);
        return rows;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO transfers (from_account_id, to_account_id, from_user_id, to_user_id, amount, currency, fee, transfer_type, status, description, reason, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            data.from_account_id || null,
            data.to_account_id || null,
            data.from_user_id,
            data.to_user_id || null,
            data.amount,
            data.currency || 'USD',
            data.fee || 0,
            data.transfer_type || 'internal',
            data.status || 'pending',
            data.description || null,
            data.reason || null,
            JSON.stringify(data.metadata || {}),
        ]);
        return rows[0];
    },
};

// Notification model compat
models.Notification = {
    find: async (filter = {}, options = {}) => {
        let sql = 'SELECT * FROM notifications WHERE 1=1';
        const params = [];
        let idx = 1;
        if (filter.user_id) {
            sql += ` AND user_id = $${idx++}`;
            params.push(filter.user_id);
        }
        if (filter.read === false) {
            sql += ` AND read = false`;
        }
        sql += ' ORDER BY created_at DESC';
        if (options.limit) {
            sql += ` LIMIT $${idx++}`;
            params.push(options.limit);
        }
        const { rows } = await query(sql, params);
        return rows;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO notifications (user_id, type, title, message, read, action_url, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            data.user_id,
            data.type || 'info',
            data.title,
            data.message,
            data.read || false,
            data.action_url || null,
            JSON.stringify(data.metadata || {}),
        ]);
        return rows[0];
    },
};

// AuditLog model compat
models.AuditLog = {
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            data.user_id,
            data.action,
            data.resource_type || null,
            data.resource_id || null,
            JSON.stringify(data.details || {}),
            data.ip_address || null,
            data.user_agent || null,
        ]);
        return rows[0];
    },
    find: async (filter = {}) => {
        let sql = 'SELECT * FROM audit_logs WHERE 1=1';
        const params = [];
        let idx = 1;
        if (filter.user_id) {
            sql += ` AND user_id = $${idx++}`;
            params.push(filter.user_id);
        }
        sql += ' ORDER BY created_at DESC LIMIT 100';
        const { rows } = await query(sql, params);
        return rows;
    },
};

// Reward model compat
models.Reward = {
    findOne: async (filter) => {
        if (filter.user_id) {
            const { rows } = await query('SELECT * FROM rewards WHERE user_id = $1', [filter.user_id]);
            return rows[0] || null;
        }
        return null;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO rewards (user_id, points, tier, lifetime_points)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [data.user_id, data.points || 0, data.tier || 'bronze', data.lifetime_points || 0]);
        return rows[0];
    },
};

// RewardTransaction model compat
models.RewardTransaction = {
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO reward_transactions (user_id, type, points, description)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [data.user_id, data.type || 'earn', data.points, data.description || '']);
        return rows[0];
    },
};

// Investment model compat
models.Investment = {
    find: async (filter = {}) => {
        let sql = 'SELECT * FROM investments WHERE 1=1';
        const params = [];
        if (filter.user_id) {
            sql += ' AND user_id = $1';
            params.push(filter.user_id);
        }
        sql += ' ORDER BY created_at DESC';
        const { rows } = await query(sql, params);
        return rows;
    },
    create: async (data) => {
        const { rows } = await query(`
            INSERT INTO investments (user_id, name, symbol, investment_type, quantity, purchase_price, current_price, total_invested, current_value, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            data.user_id,
            data.name || data.type,
            data.symbol || null,
            data.investment_type || 'other',
            data.quantity || 0,
            data.purchase_price || 0,
            data.current_price || 0,
            data.total_invested || data.amount || 0,
            data.current_value || 0,
            data.status || 'active',
        ]);
        return rows[0];
    },
};

// FeatureFlag model compat
models.FeatureFlag = {
    findOne: async (filter) => {
        if (filter.key) {
            const { rows } = await query('SELECT * FROM feature_flags WHERE key = $1', [filter.key]);
            return rows[0] || null;
        }
        return null;
    },
    find: async () => {
        const { rows } = await query('SELECT * FROM feature_flags');
        return rows;
    },
};

// AMLFlag model compat
models.AMLFlag = {
    find: async (filter = {}) => {
        let sql = 'SELECT * FROM aml_flags WHERE 1=1';
        const params = [];
        if (filter.user_id) {
            sql += ' AND user_id = $1';
            params.push(filter.user_id);
        }
        sql += ' ORDER BY flagged_at DESC';
        const { rows } = await query(sql, params);
        return rows;
    },
};

// ─── Initialize on module load ───────────────────────────────────────────────
if (!isDemo) {
    ensureConnection().catch(err => {
        console.error('⚠️  PostgreSQL connection failed:', err.message);
    });
}

module.exports = {
    query,
    getClient,
    pool,
    isDemo,
    isMongo,
    models,
    ensureConnection,
    // Direct model exports for convenience
    User: models.User,
    Account: models.Account,
    Transaction: models.Transaction,
    Transfer: models.Transfer,
    Notification: models.Notification,
    AuditLog: models.AuditLog,
    Reward: models.Reward,
    RewardTransaction: models.RewardTransaction,
    Investment: models.Investment,
    FeatureFlag: models.FeatureFlag,
    AMLFlag: models.AMLFlag,
};