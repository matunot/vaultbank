/**
 * Vercel Serverless Function: /api/login
 *
 * This file re-uses the existing authentication routes defined for the
 * Express server (server/routes/auth.js). By mounting the router on a fresh
 * Express instance we expose the same signup, login, logout and profile
 * endpoints under the Vercel `/api` namespace.
 */
const express = require('express');
// Import the auth router from the existing server implementation
const authRoutes = require('../server/routes/auth');

const app = express();

// Body parsing – required for POST requests
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mount the auth routes at the root of this function. Vercel will expose them
// as `/api/login`, `/api/signup`, etc., because the file name determines the
// base path (`login.js` → `/api/login`). The router itself defines the full
// paths (e.g. POST /signup), so they remain unchanged.
app.use('/', authRoutes);

// Export the Express app – Vercel treats the exported function as the handler.
module.exports = app;