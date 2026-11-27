const crypto = require('crypto');
const logger = require('../logger');

const MAX_SAMPLES = 500;
const SLOW_REQUEST_MS = 1000;

const samples = [];

/**
 * Sanitized route key: method + path only. Query strings are dropped (search
 * terms and tokens never enter logs) and identifiers are collapsed.
 */
function routeKey(req) {
    const path = String(req.path || req.originalUrl || '/')
        .split(/[?#]/)[0]
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d+(?=\/|$)/g, '/:id');
    return `${req.method} ${path}`;
}

function resolveRequestId(req) {
    const supplied = String(req.headers['x-request-id'] || '').trim();
    if (/^[A-Za-z0-9._-]{8,100}$/.test(supplied)) return supplied;
    return crypto.randomUUID();
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

function recordRequest(route, status, durationMs) {
    samples.push({ route, status, ms: durationMs });
    if (samples.length > MAX_SAMPLES) samples.shift();

    if (samples.length % 100 === 0) {
        const values = samples.map((s) => s.ms).sort((a, b) => a - b);
        const p50 = Math.round(percentile(values, 50));
        const p95 = Math.round(percentile(values, 95));
        const p99 = Math.round(percentile(values, 99));
        logger.info('http_stats p50=%dms p95=%dms p99=%dms samples=%d', p50, p95, p99, values.length, {
            p50,
            p95,
            p99,
            samples: values.length,
        });
    }
}

function getHttpTimingStats() {
    const buckets = new Map();
    for (const sample of samples) {
        const entry = buckets.get(sample.route) || { values: [], errors: 0 };
        entry.values.push(sample.ms);
        if (sample.status >= 500) entry.errors += 1;
        buckets.set(sample.route, entry);
    }
    return Array.from(buckets.entries())
        .map(([route, { values, errors }]) => {
            const sorted = values.slice().sort((a, b) => a - b);
            return {
                route,
                count: sorted.length,
                errors,
                p50: Math.round(percentile(sorted, 50)),
                p95: Math.round(percentile(sorted, 95)),
                p99: Math.round(percentile(sorted, 99)),
            };
        })
        .sort((a, b) => b.p95 - a.p95);
}

/**
 * Request logger: correlation ID + sanitized route + timing.
 * No query strings, tokens, bodies, balances or account numbers are logged.
 */
function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const requestId = resolveRequestId(req);
    req.id = requestId;
    res.setHeader('X-Request-ID', requestId);

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const route = routeKey(req);
        recordRequest(route, res.statusCode, durationMs);

        const meta = {
            requestId,
            route,
            status: res.statusCode,
            durationMs: Math.round(durationMs),
        };
        if (durationMs >= SLOW_REQUEST_MS) {
            logger.warn('http_slow %s %d %dms', route, res.statusCode, Math.round(durationMs), meta);
        } else {
            logger.info('http_request %s %d %dms', route, res.statusCode, Math.round(durationMs), meta);
        }
    });

    next();
}

module.exports = requestLogger;
module.exports.routeKey = routeKey;
module.exports.getHttpTimingStats = getHttpTimingStats;
module.exports.SLOW_REQUEST_MS = SLOW_REQUEST_MS;
