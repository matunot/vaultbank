require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const requestLogger = require('./middleware/logger');

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
const amlRoutes = require('./routes/aml');
const reportsRoutes = require('./routes/reports');
const accountRoutes = require('./routes/accounts');
const stripePaymentRoutes = require('./routes/stripe-payments');
const anomaliesRoutes = require('./routes/anomalies');

// Import middleware
const { generalLimiter } = require('./middleware/rateLimiter');
const { logAction } = require('./middleware/audit');

const app = express();
const PORT = process.env.PORT || 5000;
const startTime = Date.now();

// ─── Frontend Static Serving (single-origin) ────────────────────────────────
// Serve the built React app from client/dist so the whole VaultBank app runs
// on ONE origin (e.g. https://vaultbank-md20.onrender.com). This makes the
// frontend impossible to go stale or lose API connectivity.
const path = require('path');
const fs = require('fs');
const FRONTEND_DIST = path.join(__dirname, '..', 'client', 'dist');
const hasFrontend = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false // Allow for development
}));

// ─── CORS Configuration ─────────────────────────────────────────────────────
// Allow all origins. This is a public banking app and the frontend may be
// accessed from any domain (Vercel previews, custom domains, local dev).
// Credentials are still required for JWT auth.
app.use(cors({
    origin: true, // Reflect any origin (safe for public API with JWT auth)
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
    // Custom request logger for structured logging
    app.use(requestLogger);
}

// ─── Rate Limiting (global) ──────────────────────────────────────────────────
app.use(generalLimiter);

// Attach audit logger to request for easy use in routes
app.use((req, res, next) => {
    req.logAction = logAction;
    next();
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    return res.status(200).json({
        status: 'ok',
        uptime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        memory: typeof process.memoryUsage === 'function' ? process.memoryUsage() : {},
        message: '🏦 VaultBank API is running!'
    });
});

// ─── Input Sanitization ──────────────────────────────────────────────────────
// Sanitize all request bodies and query parameters BEFORE routes so XSS
// payloads are stripped from every endpoint, including auth.
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
app.use('/', amlRoutes);
// Register anomalies route
app.use('/', anomaliesRoutes);
// Register compliance reports route
app.use('/', reportsRoutes);

// ─── Banking Account Routes (Real Banking) ──────────────────────────────────
app.use('/', accountRoutes);

// ─── Stripe Payment Routes (Deposits, Withdrawals, Webhooks) ──────────────
app.use(stripePaymentRoutes);

// ─── Root Route ──────────────────────────────────────────────────────────────
// ─── Frontend Static Serving (single-origin) ────────────────────────────────
// Serve the built React SPA so the app runs on one origin (frontend + API).
// This guarantees the deployed app can always reach its own API — no stale
// frontend build or cross-origin mismatch can break login again.
if (hasFrontend) {
    app.use(express.static(FRONTEND_DIST));
}

app.get('/', (req, res) => {
    if (hasFrontend) {
        return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    }
    return res.status(200).json({
        name: 'VaultBank API',
        version: '1.0.0',
        status: 'operational',
        message: '🏦 Welcome to the VaultBank API!',
        endpoints: {
            health: 'GET /health',
            apiInfo: 'GET /api',
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
            ],
            aml: [
                'GET /api/aml/flags',
                'PUT /api/aml/:flagId/approve',
                'PUT /api/aml/:flagId/reject'
            ]
        },
        docs: 'See DEPLOYMENT_README.md for full documentation',
        timestamp: new Date().toISOString()
    });
});

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
            ],
            aml: [
                'GET /api/aml/flags',
                'PUT /api/aml/:flagId/approve',
                'PUT /api/aml/:flagId/reject'
            ]
        },
        docs: 'See DEPLOYMENT_README.md for full documentation',
        timestamp: new Date().toISOString()
    });
});

// ─── SPA Fallback (after all API routes) ─────────────────────────────────────
// Any non-API GET that didn't match an API route returns the React app, so
// client-side routing (/dashboard, /payments, ...) works on a single origin.
if (hasFrontend) {
    app.get(/^\/(?!api\/|health|login|signup)(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/%?]*)$/, (req, res) => {
        return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
}

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.originalUrl} not found.`,
        availableAt: '/api'
    });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
//The fourth argument is required by Express to identify error-handling middleware.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
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

// ─── Ensure Database Connection ───────────────────────────────────────────────
const { ensureConnection } = require('./config/db');
const { seedDemoData } = require('./config/database');

// ─── Start Server ─────────────────────────────────────────────────────────────
async function startServer() {
    // Wait for PostgreSQL database connection
    try {
        await ensureConnection();
        console.info('✅ Database connection established');
        // Seed demo data (safe: only runs if no users exist)
        await seedDemoData();
    } catch (err) {
        console.warn('⚠️  Could not connect to database, starting in demo mode:', err.message);
    }

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

  Credentials:
  ├── User:  demo@vaultbank.com  / password
  └── Admin: admin@vaultbank.com / admin123

  Mode: 🗄️  PostgreSQL (Neon) - Real Database

═════════════════════════════════════════════════════════════════
`);
    });
}

startServer();

module.exports = app;
