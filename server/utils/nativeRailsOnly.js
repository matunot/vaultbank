'use strict';

const { isProductionRuntime } = require('../config/database-mode');

/**
 * In production, VaultBank-owned rails are the default. Provider-backed
 * routes must not activate merely because old credentials or env flags remain.
 * A deliberate operator opt-out exists for controlled migration/testing only.
 */
function isNativeRailsOnly(env = process.env) {
    if (!isProductionRuntime(env)) return false;
    return String(env.VB_NATIVE_RAILS_ONLY == null ? 'true' : env.VB_NATIVE_RAILS_ONLY)
        .trim()
        .toLowerCase() !== 'false';
}

module.exports = { isNativeRailsOnly };
