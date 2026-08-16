/**
 * VAULTBANK DATABASE LAYER
 * ========================
 * Mongoose/MongoDB implementation with in-memory demo store fallback.
 *
 * All data access functions go through this module so the rest of the app
 * is completely database-agnostic.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Try bcrypt first (local), fallback to bcryptjs (Vercel)
let bcrypt;
try {
    bcrypt = require('bcrypt');
} catch (e) {
    bcrypt = require('bcryptjs');
}

const db = require('./db');
const isDemo = db.isDemo;

// ============================================================
// UNIQUE ACCOUNT NUMBER GENERATION
// ============================================================
/**
 * Generates a unique VaultBank account number in the format:
 *   VB-XXXX-XXXX-XXXX-C
 * where the final C is a check digit (0-9) computed from the
 * numeric portion. Every new account gets a genuinely unique
 * number — collisions are detected and the number is regenerated.
 */
function generateRawAccountNumber() {
    const group = () => Math.floor(1000 + Math.random() * 9000); // 1000-9999
    const a = group();
    const b = group();
    const c = group();
    const numeric = `${a}${b}${c}`; // 12-digit string
    // Simple Luhn-like check digit so the number is self-validating
    let sum = 0;
    for (let i = 0; i < numeric.length; i++) {
        const digit = parseInt(numeric[i], 10);
        if (i % 2 === 0) {
            const doubled = digit * 2;
            sum += doubled > 9 ? doubled - 9 : doubled;
        } else {
            sum += digit;
        }
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return `VB-${a}-${b}-${c}-${checkDigit}`;
}

const accountNumberExists = async (accountNumber) => {
    if (isDemo) {
        return demoStore.accounts.some(a => a.account_number === accountNumber);
    }
    try {
        await db.ensureConnection();
        const account = await db.Account.findOne({ account_number: accountNumber });
        return !!account;
    } catch (err) {
        console.error('accountNumberExists error:', err.message);
        return false;
    }
};

const generateUniqueAccountNumber = async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateRawAccountNumber();
        const exists = await accountNumberExists(candidate);
        if (!exists) return candidate;
    }
    // Extremely unlikely fallback: append timestamp to guarantee uniqueness
    return `VB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
};

// ============================================================
// DEMO STORE (Fallback when no DATABASE_URL)
// ============================================================
const demoStore = {
    users: [
        {
            id: 'demo-user-001',
            email: 'demo@vaultbank.com',
            password_hash: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
            full_name: 'Demo User',
            phone: '+1234567890',
            role: 'user',
            subscription: 'trial',
            kyc_status: 'verified',
            status: 'active',
            email_verified: true,
            two_fa_enabled: false,
            two_fa_secret: null,
            backup_codes: [],
            stripe_customer_id: null,
            created_at: new Date().toISOString(),
        },
        {
            id: 'admin-user-001',
            email: 'admin@vaultbank.com',
            password_hash: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
            full_name: 'Admin User',
            phone: '+1234567891',
            role: 'super_admin',
            subscription: 'admin',
            kyc_status: 'verified',
            status: 'active',
            email_verified: true,
            two_fa_enabled: false,
            two_fa_secret: null,
            backup_codes: [],
            stripe_customer_id: null,
            created_at: new Date().toISOString(),
        }
    ],
    accounts: [
        {
            id: 'demo-account-001',
            user_id: 'demo-user-001',
            account_number: 'VB-1000-2000-3000',
            account_type: 'checking',
            account_name: 'Primary Account',
            currency: 'USD',
            balance: 5230.50,
            available_balance: 5230.50,
            held_balance: 0,
            status: 'active',
            interest_rate: 0.01,
            daily_transfer_limit: 10000,
            monthly_transfer_limit: 100000,
        },
        {
            id: 'demo-account-002',
            user_id: 'admin-user-001',
            account_number: 'VB-9999-8888-7777',
            account_type: 'business',
            account_name: 'Admin Business Account',
            currency: 'USD',
            balance: 0,
            available_balance: 0,
            held_balance: 0,
            status: 'active',
            interest_rate: 0,
            daily_transfer_limit: 100000,
            monthly_transfer_limit: 1000000,
        }
    ],
    transactions: [
        {
            id: 'demo-txn-001',
            account_id: 'demo-account-001',
            user_id: 'demo-user-001',
            type: 'deposit',
            status: 'completed',
            amount: 2000.00,
            currency: 'USD',
            balance_before: 3230.50,
            balance_after: 5230.50,
            description: 'Salary Deposit',
            category: 'income',
            created_at: '2025-10-01T00:00:00Z',
        },
        {
            id: 'demo-txn-002',
            account_id: 'demo-account-001',
            user_id: 'demo-user-001',
            type: 'payment',
            status: 'completed',
            amount: -500.00,
            currency: 'USD',
            balance_before: 3730.50,
            balance_after: 3230.50,
            description: 'Rent Payment',
            category: 'expense',
            created_at: '2025-10-05T00:00:00Z',
        }
    ],
    notifications: [],
    audit_logs: [],
    rewards: [],
    investments: [],
    bills: [],
    kyc_documents: [],
    payment_methods: []
};

// ============================================================
// HELPER: Convert MongoDB _id to string ID for API consistency
// ============================================================
function docToApi(doc) {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    if (obj._id) {
        obj.id = obj._id.toString();
        delete obj.__v;
    }
    return obj;
}

function docsToApi(docs) {
    return docs.map(d => docToApi(d));
}

// ============================================================
// USER QUERIES
// ============================================================

const findUserByEmail = async (email) => {
    if (isDemo) {
        return demoStore.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
    }
    try {
        await db.ensureConnection();
        const user = await db.User.findOne({ email });
        return user || null;
    } catch (err) {
        console.error('findUserByEmail error:', err.message);
        return null;
    }
};

const findUserById = async (id) => {
    if (isDemo) {
        return demoStore.users.find(u => u.id === id) || null;
    }
    try {
        await db.ensureConnection();
        const user = await db.User.findById(id);
        return user || null;
    } catch (err) {
        console.error('findUserById error:', err.message);
        return null;
    }
};

const createUser = async ({ email, password, fullName, phone }) => {
    const passwordHash = await bcrypt.hash(password, 12);
    
    if (isDemo) {
        const user = {
            id: 'user-' + Date.now(),
            email,
            password_hash: passwordHash,
            full_name: fullName,
            phone: phone || null,
            role: 'user',
            subscription: 'free',
            kyc_status: 'pending',
            status: 'active',
            email_verified: false,
            phone_verified: false,
            two_fa_enabled: false,
            two_fa_secret: null,
            backup_codes: [],
            stripe_customer_id: null,
            created_at: new Date().toISOString(),
        };
        demoStore.users.push(user);

        const uniqueAccountNumber = await generateUniqueAccountNumber();
        const account = {
            id: 'account-' + Date.now(),
            user_id: user.id,
            account_number: uniqueAccountNumber,
            account_type: 'checking',
            account_name: 'Primary Account',
            currency: 'USD',
            balance: 0,
            available_balance: 0,
            held_balance: 0,
            status: 'active',
            interest_rate: 0.01,
            daily_transfer_limit: 10000,
            monthly_transfer_limit: 100000,
        };
        demoStore.accounts.push(account);

        demoStore.rewards.push({
            id: 'reward-' + Date.now(),
            user_id: user.id,
            points: 100,
            tier: 'bronze',
            lifetime_points: 100,
        });

        demoStore.notifications.push({
            id: 'notif-' + Date.now(),
            user_id: user.id,
            type: 'success',
            title: 'Welcome to VaultBank!',
            message: 'Your account has been created successfully. Start by adding funds to your account.',
            read: false,
            created_at: new Date().toISOString(),
        });

        return user;
    }

    // PostgreSQL implementation
    await db.ensureConnection();
    const user = await db.User.create({
        email,
        password_hash: passwordHash,
        full_name: fullName,
        phone: phone || null,
    });

    const userId = user.id;

    // Auto-create bank account with guaranteed-unique account number
    const accountNumber = await generateUniqueAccountNumber();

    await db.Account.create({
        user_id: userId,
        account_number: accountNumber,
        account_type: 'checking',
        account_name: 'Primary Account',
        currency: 'USD',
    });

    // Auto-create rewards
    await db.Reward.create({
        user_id: userId,
        points: 100,
        tier: 'bronze',
        lifetime_points: 100,
    });

    // Welcome notification
    await db.Notification.create({
        user_id: userId,
        type: 'success',
        title: 'Welcome to VaultBank!',
        message: 'Your account has been created successfully. Start by adding funds to your account.',
    });

    return user;
};

const updateUser = async (id, updates) => {
    if (isDemo) {
        const user = demoStore.users.find(u => u.id === id);
        if (!user) return null;
        Object.assign(user, updates);
        return user;
    }

    await db.ensureConnection();
    const setData = {};
    for (const [key, value] of Object.entries(updates)) {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        setData[snakeKey] = value;
    }
    const user = await db.User.findByIdAndUpdate(id, { $set: setData }, { new: true });
    return user || null;
};

const updateLastLogin = async (id, ip) => {
    if (isDemo) {
        const user = demoStore.users.find(u => u.id === id);
        if (user) user.last_login_at = new Date().toISOString();
        return;
    }
    await db.ensureConnection();
    await db.User.findByIdAndUpdate(id, {
        $set: { last_login_at: new Date(), last_login_ip: ip }
    });
};

// ============================================================
// ACCOUNT QUERIES
// ============================================================

const findAccountByUserId = async (userId) => {
    if (isDemo) {
        return demoStore.accounts.find(a => a.user_id === userId) || null;
    }
    try {
        await db.ensureConnection();
        const account = await db.Account.findOne({ user_id: userId, status: 'active' });
        return account || null;
    } catch (err) {
        console.error('findAccountByUserId error:', err.message);
        return null;
    }
};

const findAccountByNumber = async (accountNumber) => {
    if (isDemo) {
        return demoStore.accounts.find(a => a.account_number === accountNumber) || null;
    }
    await db.ensureConnection();
    const account = await db.Account.findOne({ account_number: accountNumber });
    return account || null;
};

const createAccount = async (userId, accountType = 'checking', currency = 'USD') => {
    if (isDemo) {
        const uniqueAccountNumber = await generateUniqueAccountNumber();
        const account = {
            id: 'account-' + Date.now(),
            user_id: userId,
            account_number: uniqueAccountNumber,
            account_type: accountType,
            account_name: accountType.charAt(0).toUpperCase() + accountType.slice(1) + ' Account',
            currency,
            balance: 0,
            available_balance: 0,
            held_balance: 0,
            status: 'active',
            interest_rate: 0.01,
            daily_transfer_limit: 10000,
            monthly_transfer_limit: 100000,
        };
        demoStore.accounts.push(account);
        return account;
    }
    await db.ensureConnection();
    const accountNumber = await generateUniqueAccountNumber();
    const account = await db.Account.create({
        user_id: userId,
        account_number: accountNumber,
        account_type: accountType,
        account_name: accountType.charAt(0).toUpperCase() + accountType.slice(1) + ' Account',
        currency,
    });
    return account;
};

const updateAccountBalance = async (accountId, newBalance, availableBalance) => {
    if (isDemo) {
        const account = demoStore.accounts.find(a => a.id === accountId);
        if (account) {
            account.balance = newBalance;
            if (availableBalance !== undefined) account.available_balance = availableBalance;
        }
        return account;
    }
    await db.ensureConnection();
    const updateData = { balance: newBalance };
    if (availableBalance !== undefined) updateData.available_balance = availableBalance;
    const account = await db.Account.findByIdAndUpdate(accountId, { $set: updateData }, { new: true });
    return account || null;
};

// ============================================================
// TRANSACTION QUERIES
// ============================================================

const createTransaction = async (txData) => {
    if (isDemo) {
        const tx = {
            id: 'txn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            ...txData,
            created_at: new Date().toISOString(),
        };
        demoStore.transactions.push(tx);
        return tx;
    }
    await db.ensureConnection();
    const tx = await db.Transaction.create({
        account_id: txData.account_id,
        user_id: txData.user_id,
        type: txData.type,
        status: txData.status || 'completed',
        amount: txData.amount,
        currency: txData.currency || 'USD',
        balance_before: txData.balance_before,
        balance_after: txData.balance_after,
        description: txData.description,
        category: txData.category,
        reference_id: txData.reference_id || null,
        external_reference: txData.external_reference || null,
        counterparty_name: txData.counterparty_name || null,
        counterparty_account: txData.counterparty_account || null,
        metadata: txData.metadata || {},
    });
    return tx;
};

const getTransactions = async (userId, { limit = 50, offset = 0, type, startDate, endDate } = {}) => {
    if (isDemo) {
        let txns = demoStore.transactions.filter(t => t.user_id === userId);
        if (type) txns = txns.filter(t => t.type === type);
        txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return txns.slice(offset, offset + limit);
    }

    await db.ensureConnection();
    const filter = { user_id: userId };
    if (type) filter.type = type;
    if (startDate) filter.created_at = { ...filter.created_at, $gte: new Date(startDate) };
    if (endDate) filter.created_at = { ...filter.created_at, $lte: new Date(endDate) };

    // The PostgreSQL compat layer (db.Transaction.find) already applies
    // ORDER BY created_at DESC, LIMIT and OFFSET via the options object.
    // Do NOT chain .sort()/.skip()/.limit() — those are Mongoose-only and
    // will throw on the plain-array result returned by the pg layer.
    const txns = await db.Transaction.find(filter, { limit, skip: offset });
    return txns;
};

// ============================================================
// TRANSFER QUERIES
// ============================================================

const createTransfer = async (transferData) => {
    if (isDemo) {
        const transfer = {
            id: 'transfer-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            ...transferData,
            status: transferData.status || 'completed',
            initiated_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
        };
        demoStore.transactions.push(transfer);
        return transfer;
    }
    await db.ensureConnection();
    const transfer = await db.Transfer.create({
        from_account_id: transferData.from_account_id,
        to_account_id: transferData.to_account_id || null,
        from_user_id: transferData.from_user_id,
        to_user_id: transferData.to_user_id || null,
        amount: transferData.amount,
        currency: transferData.currency || 'USD',
        fee: transferData.fee || 0,
        transfer_type: transferData.transfer_type || 'internal',
        status: transferData.status || 'completed',
        description: transferData.description,
        reason: transferData.reason || null,
        metadata: transferData.metadata || {},
    });
    return transfer;
};

const getTransfers = async (userId, { limit = 50, offset = 0 } = {}) => {
    if (isDemo) {
        let transfers = demoStore.transactions.filter(
            t => t.from_user_id === userId || t.to_user_id === userId
        );
        transfers.sort((a, b) => new Date(b.created_at || b.initiated_at) - new Date(a.created_at || a.initiated_at));
        return transfers.slice(offset, offset + limit);
    }
    await db.ensureConnection();
    // The pg compat layer (db.Transfer.find) applies ORDER BY created_at DESC,
    // LIMIT and OFFSET via the options object — do not chain Mongoose methods.
    const transfers = await db.Transfer.find({
        $or: [{ from_user_id: userId }, { to_user_id: userId }]
    }, { limit, skip: offset });

    // Enrich with user names
    const enriched = await Promise.all(transfers.map(async (t) => {
        const result = { ...t, id: t.id };
        try {
            if (t.from_user_id) {
                const fromUser = await db.User.findById(t.from_user_id);
                if (fromUser) {
                    result.from_user_name = fromUser.full_name;
                    result.from_user_email = fromUser.email;
                }
            }
            if (t.to_user_id) {
                const toUser = await db.User.findById(t.to_user_id);
                if (toUser) {
                    result.to_user_name = toUser.full_name;
                    result.to_user_email = toUser.email;
                }
            }
        } catch (e) { /* ignore enrichment errors */ }
        return result;
    }));
    return enriched;
};

// ============================================================
// NOTIFICATION QUERIES
// ============================================================

const createNotification = async (userId, { type = 'info', title, message, actionUrl, metadata }) => {
    if (isDemo) {
        const notif = {
            id: 'notif-' + Date.now(),
            user_id: userId,
            type,
            title,
            message,
            read: false,
            action_url: actionUrl || null,
            metadata: metadata || {},
            created_at: new Date().toISOString(),
        };
        demoStore.notifications.push(notif);
        return notif;
    }
    await db.ensureConnection();
    const notif = await db.Notification.create({
        user_id: userId,
        type,
        title,
        message,
        action_url: actionUrl || null,
        metadata: metadata || {},
    });
    return { ...notif, id: notif.id };
};

const getNotifications = async (userId, { limit = 20, unreadOnly = false } = {}) => {
    if (isDemo) {
        let notifs = demoStore.notifications.filter(n => n.user_id === userId);
        if (unreadOnly) notifs = notifs.filter(n => !n.read);
        notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return notifs.slice(0, limit);
    }
    await db.ensureConnection();
    const filter = { user_id: userId };
    if (unreadOnly) filter.read = false;
    // The pg compat layer (db.Notification.find) applies ORDER BY created_at DESC
    // and LIMIT via the options object — do not chain Mongoose methods.
    const notifs = await db.Notification.find(filter, { limit });
    return notifs;
};

// ============================================================
// AUDIT LOG QUERIES
// ============================================================

const createAuditLog = async ({ userId, action, resourceType, resourceId, details, ipAddress, userAgent }) => {
    if (isDemo) {
        const log = {
            id: 'audit-' + Date.now(),
            user_id: userId,
            action,
            resource_type: resourceType || null,
            resource_id: resourceId || null,
            details: details || {},
            ip_address: ipAddress || null,
            user_agent: userAgent || null,
            created_at: new Date().toISOString(),
        };
        demoStore.audit_logs.push(log);
        return log;
    }
    await db.ensureConnection();
    const log = await db.AuditLog.create({
        user_id: userId,
        action,
        resource_type: resourceType || null,
        resource_id: resourceId || null,
        details: details || {},
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
    });
    return log;
};

// ============================================================
// REWARD QUERIES
// ============================================================

const getRewards = async (userId) => {
    if (isDemo) {
        return demoStore.rewards.find(r => r.user_id === userId) || { points: 0, tier: 'bronze', lifetime_points: 0 };
    }
    await db.ensureConnection();
    const { rows } = await db.query('SELECT * FROM rewards WHERE user_id = $1', [userId]);
    if (rows.length > 0) {
        const reward = rows[0];
        return { ...reward, id: reward.id };
    }
    return { points: 0, tier: 'bronze', lifetime_points: 0 };
};

const addRewardPoints = async (userId, points, description) => {
    if (isDemo) {
        let reward = demoStore.rewards.find(r => r.user_id === userId);
        if (!reward) {
            reward = { id: 'reward-' + Date.now(), user_id: userId, points: 0, tier: 'bronze', lifetime_points: 0 };
            demoStore.rewards.push(reward);
        }
        reward.points += points;
        reward.lifetime_points += points;
        return reward;
    }
    await db.ensureConnection();

    // Upsert rewards
    const reward = await db.Reward.findOne({ user_id: userId });
    if (!reward) {
        await db.Reward.create({
            user_id: userId,
            points,
            tier: points >= 10000 ? 'platinum' : points >= 5000 ? 'gold' : points >= 1000 ? 'silver' : 'bronze',
            lifetime_points: points,
        });
    } else {
        const newLifetime = (reward.lifetime_points || 0) + points;
        await db.query(
            'UPDATE rewards SET points = points + $2, lifetime_points = lifetime_points + $2, tier = $3 WHERE user_id = $1',
            [userId, points, newLifetime >= 10000 ? 'platinum' : newLifetime >= 5000 ? 'gold' : newLifetime >= 1000 ? 'silver' : 'bronze']
        );
    }

    // Create reward transaction
    await db.RewardTransaction.create({
        user_id: userId,
        type: 'earn',
        points,
        description: description || '',
    });

    return getRewards(userId);
};

// ============================================================
// SEQUELIZE-STYLE COMPAT (some routes use db.User.findAll etc.)
// ============================================================

const User = {
    findByPk: async (id) => findUserById(id),
    findOne: async (where) => {
        if (where && where.email) return findUserByEmail(where.email);
        return null;
    },
    create: async (data) => createUser(data),
    findAll: async () => {
        if (isDemo) return demoStore.users;
        await db.ensureConnection();
        const users = await db.User.find().sort({ created_at: -1 });
        return users;
    },
    update: async (data, where) => {
        if (where && where.id) return updateUser(where.id, data);
        return null;
    }
};

const Account = {
    findByPk: async (id) => {
        if (isDemo) return demoStore.accounts.find(a => a.id === id) || null;
        await db.ensureConnection();
        const account = await db.Account.findById(id);
        return account || null;
    },
    findOne: async (where) => {
        if (where && where.user_id) return findAccountByUserId(where.user_id);
        if (where && where.account_number) return findAccountByNumber(where.account_number);
        return null;
    },
    create: async (data) => createAccount(data.user_id, data.account_type, data.currency),
    findAll: async (where) => {
        if (where && where.user_id) {
            if (isDemo) return demoStore.accounts.filter(a => a.user_id === where.user_id);
            await db.ensureConnection();
            const accounts = await db.Account.find({ user_id: where.user_id });
            return accounts;
        }
        if (isDemo) return demoStore.accounts;
        await db.ensureConnection();
        const accounts = await db.Account.find();
        return accounts;
    }
};

const Transaction = {
    create: async (data) => createTransaction(data),
    findAll: async (where, options) => {
        if (where && where.user_id) return getTransactions(where.user_id, options);
        return [];
    }
};

// ============================================================
// SEED INITIAL DATA (Real PostgreSQL)
// ============================================================
const seedDemoData = async () => {
    // Demo mode: users are already in demoStore — nothing to do
    if (isDemo) {
        console.info('ℹ️  Demo mode active, seed data already in memory');
        return;
    }

    await db.ensureConnection();

    console.info('🌱 Ensuring seed users exist in PostgreSQL...');

    // Check if demo/admin users already exist
    const { rows: existingUsers } = await db.query(
        `SELECT email FROM users WHERE email IN ($1, $2)`,
        ['demo@vaultbank.com', 'admin@vaultbank.com']
    );
    const existingEmails = new Set(existingUsers.map(u => u.email));

    // Demo user (password: "password")
    let demoUser = null;
    if (!existingEmails.has('demo@vaultbank.com')) {
        const demoPassHash = await bcrypt.hash('password', 12);
        const result = await db.query(`
            INSERT INTO users (email, password_hash, full_name, phone, role, subscription, kyc_status, status, email_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (email) DO NOTHING
            RETURNING *
        `, ['demo@vaultbank.com', demoPassHash, 'Demo User', '+1234567890', 'user', 'basic', 'verified', 'active', true]);
        demoUser = result.rows[0] || null;
    } else {
        const { rows } = await db.query('SELECT * FROM users WHERE email = $1', ['demo@vaultbank.com']);
        demoUser = rows[0] || null;
    }
    console.log('Demo user:', demoUser ? `✅ found (${demoUser.email})` : '⚠️ not found');

    // Admin user (password: "admin123")
    let adminUser = null;
    if (!existingEmails.has('admin@vaultbank.com')) {
        const adminPassHash = await bcrypt.hash('admin123', 12);
        const result = await db.query(`
            INSERT INTO users (email, password_hash, full_name, phone, role, subscription, kyc_status, status, email_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (email) DO NOTHING
            RETURNING *
        `, ['admin@vaultbank.com', adminPassHash, 'Admin User', '+1234567891', 'super_admin', 'business', 'verified', 'active', true]);
        adminUser = result.rows[0] || null;
    } else {
        const { rows } = await db.query('SELECT * FROM users WHERE email = $1', ['admin@vaultbank.com']);
        adminUser = rows[0] || null;
    }
    console.log('Admin user:', adminUser ? `✅ found (${adminUser.email})` : '⚠️ not found');

    // Seed demo account + rewards (only if demo user was newly created or account missing)
    if (demoUser) {
        const { rows: accountRows } = await db.query(
            `SELECT id FROM accounts WHERE account_number = $1`,
            ['VB-1000-2000-3000']
        );
        if (accountRows.length === 0) {
            await db.query(`
                INSERT INTO accounts (user_id, account_number, account_type, account_name, currency, balance, available_balance, status, interest_rate)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (account_number) DO NOTHING
            `, [demoUser.id, 'VB-1000-2000-3000', 'checking', 'Primary Account', 'USD', 5230.50, 5230.50, 'active', 0.0100]);
        }

        const { rows: rewardRows } = await db.query(
            `SELECT id FROM rewards WHERE user_id = $1`,
            [demoUser.id]
        );
        if (rewardRows.length === 0) {
            await db.query(`
                INSERT INTO rewards (user_id, points, tier, lifetime_points)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
            `, [demoUser.id, 100, 'bronze', 100]);
        }
    }

    // Seed admin account + rewards
    if (adminUser) {
        const { rows: accountRows } = await db.query(
            `SELECT id FROM accounts WHERE account_number = $1`,
            ['VB-9999-8888-7777']
        );
        if (accountRows.length === 0) {
            await db.query(`
                INSERT INTO accounts (user_id, account_number, account_type, account_name, currency, balance, available_balance, status, interest_rate)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (account_number) DO NOTHING
            `, [adminUser.id, 'VB-9999-8888-7777', 'business', 'Admin Business Account', 'USD', 0, 0, 'active', 0.0000]);
        }

        const { rows: rewardRows } = await db.query(
            `SELECT id FROM rewards WHERE user_id = $1`,
            [adminUser.id]
        );
        if (rewardRows.length === 0) {
            await db.query(`
                INSERT INTO rewards (user_id, points, tier, lifetime_points)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
            `, [adminUser.id, 2500, 'gold', 2500]);
        }
    }

    console.info('✅ Seed data ensured successfully in PostgreSQL');
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    db,
    isDemo,

    // User functions
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    updateLastLogin,

    // Account functions
    findAccountByUserId,
    findAccountByNumber,
    createAccount,
    updateAccountBalance,
    generateUniqueAccountNumber,
    generateRawAccountNumber,

    // Transaction functions
    createTransaction,
    getTransactions,

    // Transfer functions
    createTransfer,
    getTransfers,

    // Notification functions
    createNotification,
    getNotifications,

    // Audit log functions
    createAuditLog,

    // Reward functions
    getRewards,
    addRewardPoints,

    // ORM-like compat layer
    User,
    Account,
    Transaction,

    // Expose demo store for backward compat
    demoStore,

    // Seed function
    seedDemoData,
};
