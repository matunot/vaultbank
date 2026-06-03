/**
 * Vercel Serverless Function: /api (catch-all)
 * 
 * This is a minimal health-check endpoint. The actual API routes are handled
 * by individual serverless functions: api/login.js, api/transfers.js, api/payments.js
 * 
 * The frontend should call the individual endpoints directly:
 * - Auth: /api/login (signup, login, logout, profile, 2FA, etc.)
 * - Transfers: /api/transfers
 * - Payments: /api/payments
 */
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    return res.status(200).json({
        status: 'ok',
        message: 'VaultBank API is running!',
        version: '1.0.0',
        endpoints: {
            auth: '/api/login',
            transfers: '/api/transfers',
            payments: '/api/payments'
        }
    });
});

// API info
app.get('/api', (req, res) => {
    return res.status(200).json({
        name: 'VaultBank API',
        version: '1.0.0',
        status: 'operational',
        message: 'Use individual endpoints: /api/login, /api/transfers, /api/payments'
    });
});

// Catch-all
app.use((req, res) => {
    return res.status(200).json({
        message: 'VaultBank API - use /api/login for auth, /api/transfers for transfers, /api/payments for payments',
        health: '/api/health'
    });
});

module.exports = app;