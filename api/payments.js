/**
 * Vercel Serverless Function: /api/payments
 *
 * This file re-uses the existing payment routes defined for the
 * Express server (server/routes/payments.js). By mounting the router on a fresh
 * Express instance we expose the same payment endpoints under the Vercel `/api` namespace.
 */
const express = require('express');
// Import the payment router from the existing server implementation
const paymentRoutes = require('../server/routes/payments');

const app = express();

// Body parsing – required for POST requests
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mount the payment routes at the root of this function. Vercel will expose them
// as `/api/payments/methods`, `/api/payments/transfer`, etc., because the file
// name determines the base path (`payments.js` → `/api/payments`).
app.use('/', paymentRoutes);

// Export the Express app – Vercel treats the exported function as the handler.
module.exports = app;