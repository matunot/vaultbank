/**
 * Feature flags (Sprint 2)
 * ----------------------
 * In-process cache of the `feature_flags` table. The cache refreshes
 * from the DB every `refreshMs` (default 30s) so admin changes take
 * effect quickly without hammering the database.
 *
 * Usage:
 *   const { getFlag, shouldUseLiveProvider } = require('./flags/flags');
 *   const flag = getFlag('payments.live_providers_percent');
 *   if (shouldUseLiveProvider(req)) { ... }
 *
 * The percentage flag is evaluated deterministically per `req` when a
 * `userId` is present (stable hash), so a single user always lands on
 * the same variant within a percentage bucket.
 */

const { query } = require('../config/db');
const crypto = require('crypto');

const REFRESH_MS = Number(process.env.FEATURE_FLAGS_REFRESH_MS || 30_000);

let cache = new Map();
let lastRefresh = 0;
let inflight = null;

function now() {
    return Date.now();
}

async function loadFromDb() {
    try {
        const { rows } = await query(
            'SELECT key, percentage, enabled, description, updated_at, updated_by FROM feature_flags'
        );
        const next = new Map();
        for (const r of rows || []) {
            next.set(r.key, {
                key: r.key,
                percentage: Number(r.percentage) || 0,
                enabled: r.enabled !== false,
                description: r.description || '',
                updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
                updatedBy: r.updated_by || null,
            });
        }
        cache = next;
        lastRefresh = now();
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[flags] DB read skipped:', err.message);
        } else {
            console.error('[flags] DB read failed:', err.message);
        }
        // Do NOT clobber the existing cache; keep last-known values
    }
}

function maybeRefresh() {
    if (cache.size === 0 || now() - lastRefresh > REFRESH_MS) {
        if (!inflight) {
            inflight = loadFromDb().finally(() => {
                inflight = null;
            });
        }
    }
    return inflight;
}

function getFlag(key) {
    if (!key) return null;
    maybeRefresh();
    return cache.get(key) || null;
}

function listFlags() {
    maybeRefresh();
    return Array.from(cache.values()).sort((a, b) => a.key.localeCompare(b.key));
}

async function refreshNow() {
    await loadFromDb();
    return Array.from(cache.values());
}

async function setFlag({ key, percentage, enabled, description, updatedBy }) {
    if (!key) throw new Error('key is required');
    if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
        throw new Error('percentage must be a number 0..100');
    }
    try {
        await query(
            'INSERT INTO feature_flags (key, percentage, enabled, description, updated_at, updated_by) ' +
            'VALUES ($1, $2, $3, $4, now(), $5) ' +
            'ON CONFLICT (key) DO UPDATE SET percentage = EXCLUDED.percentage, ' +
            'enabled = EXCLUDED.enabled, description = EXCLUDED.description, ' +
            'updated_at = now(), updated_by = EXCLUDED.updated_by',
            [key, percentage, enabled !== false, description || null, updatedBy || null]
        );
    } catch (err) {
        // In demo mode we still update the in-memory cache so the change
        // takes effect locally; in prod we surface the error.
        if (process.env.NODE_ENV === 'production') {
            throw err;
        }
        console.warn('[flags] setFlag DB write skipped:', err.message);
    }
    // Update cache immediately so the change is visible right away.
    const existing = cache.get(key);
    cache.set(key, {
        key,
        percentage,
        enabled: enabled !== false,
        description: description || (existing ? existing.description : null),
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || null,
    });
    lastRefresh = now();
    return cache.get(key);
}

/**
 * Deterministic hash so the same user always lands in the same bucket
 * within a percentage flag. 32-bit FNV-1a; fast and good enough.
 */
function hashToFraction(input) {
    const h = crypto.createHash('sha1').update(String(input)).digest();
    // use first 4 bytes as unsigned int
    const n = h.readUInt32BE(0);
    return (n % 100000) / 100000; // 0..1
}

/**
 * Should this request use a live PSP, given the
 * `payments.live_providers_percent` flag?
 *
 * Uses a hash of (userId || IP) so the same caller always lands on the
 * same variant within a single percentage bucket.
 */
function shouldUseLiveProvider(req, opts = {}) {
    const flag = getFlag('payments.live_providers_percent');
    if (!flag || !flag.enabled) return false;
    const pct = Math.max(0, Math.min(100, Number(flag.percentage) || 0));
    if (pct === 0) return false;
    if (pct >= 100) return true;
    // opts.userId wins (server-side hook), else req.user?.id, else IP
    const key =
        opts.userId ||
        (req && req.user && (req.user.id || req.user._id)) ||
        (req && (req.ip || (req.connection && req.connection.remoteAddress))) ||
        'anon';
    return hashToFraction(key) * 100 < pct;
}

module.exports = {
    getFlag,
    listFlags,
    setFlag,
    refreshNow,
    shouldUseLiveProvider,
    hashToFraction,
    REFRESH_MS,
};
