'use strict';

/**
 * Production keeps money movement on VaultBank-native routes only.
 * External provider processors are retained for isolated tests/development,
 * but stale credentials must never reactivate them in production.
 */
function denyLegacyProviderRail(res) {
    if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
        return false;
    }
    res.status(503).json({
        success: false,
        code: 'LEGACY_PROVIDER_RAIL_DISABLED',
        message: 'Legacy third-party payment routes are disabled in production. Use VaultBank-native internal transfers or the explicitly configured native bank/UPI reconciliation flows.',
    });
    return true;
}

module.exports = { denyLegacyProviderRail };
