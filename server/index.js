require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/auth');
const transferRoutes = require('./routes/transfers');
const rewardsRoutes = require('./routes/rewards');
const alertsRoutes = require('./routes/alerts');
const auditRoutes = require('./routes/audit');
const businessRoutes = require('./routes/business');
const investmentsRoutes = require('./routes/investments');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/payments');

// Import middleware
const { generalLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false // Allow for development
}));

// ─── CORS Configuration ─────────────────────────────────────────────────────
const allowedOrigins = [
    process.env.CLIENT_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'https://vaultbank.vercel.app',
    'https://vaultbank.com',
    'https://www.vaultbank.com'
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Requested-With']
}));

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Rate Limiting (global) ──────────────────────────────────────────────────
app.use(generalLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    return res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        memory: process.memoryUsage(),
        message: '🏦 VaultBank API is running!'
    });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/', authRoutes);
app.use('/', transferRoutes);
app.use('/', rewardsRoutes);
app.use('/', alertsRoutes);
app.use('/', auditRoutes);
app.use('/', businessRoutes);
app.use('/', investmentsRoutes);
app.use('/', adminRoutes);
app.use('/', paymentsRoutes);

// ─── API Info ────────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
    return res.status(200).json({
        name: 'VaultBank API',
        version: '1.0.0',
        status: 'operational',
        endpoints: {
            auth: [
                'POST /signup',
                'POST /login',
                'POST /api/auth/login (admin)',
                'POST /api/auth/logout',
                'GET /auth/me',
                'GET /api/profile'
            ],
            transfers: [
                'POST /api/transfers',
                'GET /api/transfers',
                'GET /api/transfers/history'
            ],
            rewards: [
                'POST /api/rewards/earn',
                'GET /api/rewards',
                'GET /api/rewards/me',
                'POST /api/rewards/redeem',
                'GET /api/rewards/leaderboard'
            ],
            alerts: [
                'GET /api/alerts',
                'GET /api/alerts/unread-count',
                'POST /api/alerts/create',
                'PUT /api/alerts/:id/read',
                'PUT /api/alerts/read-all'
            ],
            audit: [
                'GET /api/audit/logs',
                'POST /api/audit/log',
                'GET /api/audit/stats'
            ],
            business: [
                'POST /api/business/create',
                'GET /api/business/me',
                'POST /api/business/payroll',
                'POST /api/business/invoice',
                'GET /api/business/:id/analytics'
            ],
            investments: [
                'POST /api/investments/add',
                'GET /api/investments/me',
                'GET /api/investments',
                'PUT /api/investments/:id',
                'DELETE /api/investments/:id'
            ],
            admin: [
                'GET /api/admin/stats',
                'GET /api/admin/users',
                'PUT /api/admin/users/:id/suspend',
                'GET /api/admin/transactions',
                'GET /api/admin/aml-alerts'
            ],
            payments: [
                'POST /api/payments/upi/initiate',
                'POST /api/payments/paypal/initiate',
                'GET /api/payments/history'
            ]
        },
        docs: 'See DEPLOYMENT_README.md for full documentation',
        timestamp: new Date().toISOString()
    });
});

// ─── Input Sanitization ──────────────────────────────────────────────────────
app.use((req, res, next) => {
    const sanitize = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                // Remove potential XSS/script injection
                obj[key] = obj[key]
                    .trim()
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            } else if (typeof obj[key] === 'object') {
                sanitize(obj[key]);
            }
        }
    };
    sanitize(req.body);
    sanitize(req.query);
    next();
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.originalUrl} not found.`,
        availableAt: '/api'
    });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);

    // CORS error
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS: Origin not allowed.'
        });
    }

    // Rate limit error (from express-rate-limit)
    if (err.status === 429) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please slow down.',
            retryAfter: err.retryAfter
        });
    }

    return res.status(err.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === 'production'
            ? 'Internal server error.'
            : err.message || 'Internal server error.'
    });
});

// ─── Process Error Handlers ──────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                     🏦 VAULTBANK SERVER                       ║
╚══════════════════════════════════════════════════════════════╝

  🚀 Server running on port ${PORT}
  🌍 Environment: ${process.env.NODE_ENV || 'development'}
  🔗 Health check: http://localhost:${PORT}/health
  📋 API docs: http://localhost:${PORT}/api
  🔐 Auth: POST http://localhost:${PORT}/login
  📊 Admin: POST http://localhost:${PORT}/api/auth/login

  Demo credentials:
  ├── User:  demo@vaultbank.com  / password
  └── Admin: admin@vaultbank.com / admin123

  Mode: ${!process.env.SUPABASE_URL ? '⚡ In-Memory Demo (no Supabase)' : '🗄️ Supabase Connected'}

══════════════════════════════════════════════════════════════════
`);
});

module.exports = app;
