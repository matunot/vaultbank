/**
 * Vercel Serverless Function: /api/transfers
 *
 * This file reuses the existing transfer routes defined for the Express
 * server (server/routes/transfers.js). By mounting the router on a fresh
 * Express instance we expose the same endpoints (`/api/transfers`,
 * `/api/transfers/history`, etc.) under the Vercel `/api/transfers` namespace.
 * Vercel will treat the exported Express app as the handler for the
 * serverless function.
 */

const express = require('express');
const transferRouter = require('../server/routes/transfers');

const app = express();

// Parse JSON bodies for POST requests
app.use(express.json());

// Mount the transfer router at the root. The router defines its routes with
// the full `/api/transfers` prefix, so they will be reachable as
// `/api/transfers`, `/api/transfers/history`, etc.
app.use('/', transferRouter);

module.exports = app;
