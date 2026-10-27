'use strict';

/**
 * Database-mode guard shared by boot, readiness and tests.
 * Demo accounts are allowed only in local/test environments. Render is
 * explicitly detected because deployment platforms may not always set
 * NODE_ENV as expected.
 */
function isProductionRuntime(env = process.env) {
    return String(env.NODE_ENV || '').toLowerCase() === 'production'
        || String(env.RENDER || '').toLowerCase() === 'true'
        || Boolean(String(env.RENDER_SERVICE_ID || '').trim());
}

function resolveDemoMode(env = process.env) {
    const databaseUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
    if (isProductionRuntime(env) && !databaseUrl) {
        throw new Error('[db] FATAL: DATABASE_URL is required in production; demo mode is disabled.');
    }
    return !databaseUrl;
}

module.exports = { isProductionRuntime, resolveDemoMode };
