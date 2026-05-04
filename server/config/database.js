const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('⚠️  Supabase credentials not found. Running in demo/offline mode.');
}

// Public client (for user-level operations)
const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

// Admin client (for server-side privileged operations)
const supabaseAdmin = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : null;

// In-memory demo store (when Supabase is not configured)
const demoStore = {
    users: [
        {
            id: 'demo-user-001',
            email: 'demo@vaultbank.com',
            password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // "password"
            name: 'Demo User',
            role: 'user',
            balance: 5230.50,
            subscription: 'trial',
            verified: false,
            risk_score: 0,
            transactions: [
                { id: 1, label: 'Salary Deposit', amount: 2000, date: '2025-10-01', category: 'income' },
                { id: 2, label: 'Rent Payment', amount: -500, date: '2025-10-05', category: 'housing' },
                { id: 3, label: 'Cashback Bonus', amount: 150, date: '2025-10-10', category: 'reward' },
                { id: 4, label: 'Groceries', amount: -250, date: '2025-10-12', category: 'food' }
            ],
            summary: { totalIncome: 2150, totalExpenses: 750, netSavings: 1400 },
            goals: [],
            // 2FA fields (default disabled)
            twoFAEnabled: false,
            twoFASecret: null,
            backupCodes: [],
            createdAt: new Date().toISOString()
        },
        {
            id: 'admin-user-001',
            email: 'admin@vaultbank.com',
            password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // "password" / "admin123"
            name: 'Admin User',
            role: 'super_admin',
            balance: 0,
            subscription: 'admin',
            verified: true,
            risk_score: 0,
            transactions: [],
            summary: { totalIncome: 0, totalExpenses: 0, netSavings: 0 },
            goals: [],
            twoFAEnabled: false,
            twoFASecret: null,
            backupCodes: [],
            createdAt: new Date().toISOString()
        },
        {
            id: 'investor-user-001',
            email: 'investor@vaultbank.com',
            password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // "password"
            name: 'Investor User',
            role: 'investor',
            balance: 10000.00,
            subscription: 'premium',
            verified: false,
            risk_score: 0,
            transactions: [],
            summary: { totalIncome: 0, totalExpenses: 0, netSavings: 0 },
            goals: [],
            createdAt: new Date().toISOString()
        }
    ],
    rewards: [],
    alerts: [],
    auditLogs: [],
    businesses: [],
    investments: [],
    payrolls: [],
    notifications: []
};

// Helper: find user by email (demo mode)
const findUserByEmail = (email) => {
    return demoStore.users.find(u => u.email.toLowerCase() === email.toLowerCase());
};

// Helper: find user by id (demo mode)
const findUserById = (id) => {
    return demoStore.users.find(u => u.id === id);
};

module.exports = {
    supabase,
    supabaseAdmin,
    demoStore,
    findUserByEmail,
    findUserById,
    isDemo: !supabase
};
