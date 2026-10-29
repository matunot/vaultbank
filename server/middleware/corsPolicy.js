'use strict';

const CANONICAL_ORIGIN = 'https://vaultbank-md20.onrender.com';

function normalizeOrigin(value) {
    if (typeof value !== 'string' || value.trim() === '' || value.trim().toLowerCase() === 'null') {
        return null;
    }
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        return parsed.origin;
    } catch (_) {
        return null;
    }
}

function allowedProductionOrigins(env = process.env) {
    const allowed = new Set([CANONICAL_ORIGIN]);
    const configured = String(env.VB_CORS_ALLOWED_ORIGINS || '');
    for (const value of configured.split(',')) {
        const normalized = normalizeOrigin(value);
        if (normalized) allowed.add(normalized);
    }
    return allowed;
}

function isAllowedOrigin(origin, env = process.env) {
    if (!origin) return true; // server-to-server, CLI, webhooks
    if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') return true;
    const normalized = normalizeOrigin(origin);
    return !!normalized && allowedProductionOrigins(env).has(normalized);
}

function rejectDisallowedOrigin(req, res, next) {
    if (isAllowedOrigin(req.headers && req.headers.origin)) return next();
    return res.status(403).json({
        success: false,
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'This origin is not authorized to access the VaultBank API.',
    });
}

function corsOrigin(origin, callback) {
    if (!origin) return callback(null, false);
    return callback(null, isAllowedOrigin(origin));
}

module.exports = { CANONICAL_ORIGIN, normalizeOrigin, allowedProductionOrigins, isAllowedOrigin, rejectDisallowedOrigin, corsOrigin };
