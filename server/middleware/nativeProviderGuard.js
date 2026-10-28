'use strict';

const { isNativeRailsOnly } = require('../utils/nativeRailsOnly');

const BLOCKED_PREFIXES = [
    /^\/api\/stripe(?:\/|$)/i,
    /^\/api\/paypal(?:\/|$)/i,
    /^\/api\/issuing(?:\/|$)/i,
    /^\/api\/usdc(?:\/|$)/i,
    /^\/api\/collections(?:\/|$)/i,
    /^\/api\/payouts(?:\/|$)/i,
    /^\/api\/payments\/(?:transfer|webhook|upi)(?:\/|$)/i,
    /^\/api\/provider-webhooks(?:\/|$)/i,
    /^\/api\/webhooks(?:\/|$)/i,
];

function isBlockedProviderPath(pathname) {
    return BLOCKED_PREFIXES.some((pattern) => pattern.test(String(pathname || '')));
}

function nativeProviderGuard(req, res, next) {
    if (!isNativeRailsOnly()) return next();
    const pathname = String(req.path || req.originalUrl || '').split('?')[0];
    if (!isBlockedProviderPath(pathname)) return next();
    return res.status(503).json({
        success: false,
        code: 'NATIVE_RAILS_ONLY',
        message: 'This provider-backed route is disabled in native-only production mode. Use VaultBank-native rails.',
    });
}

module.exports = { nativeProviderGuard, isBlockedProviderPath };
