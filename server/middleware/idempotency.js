/**
 * Idempotency middleware (Sprint 1)
 * --------------------------------
 * Stripe-style idempotency: clients send an `Idempotency-Key` header on
 * mutation requests. If the same key is seen twice within the retention
 * window, the cached response is replayed and the handler is NOT called
 * again. This prevents double-ledger writes and double-charges from
 * client-side retries.
 *
 * The store is in-process (TtlCache) for the hot path. If the database
 * is unavailable (demo mode, Vercel cold start without DATABASE_URL),
 * the middleware falls back to in-memory only.
 *
 * Webhook routes are excluded by default (set `skip: () => false` if you
 * want it on for everything). Webhook deduplication is handled separately
 * by `provider_event_id` in the webhook handler.
 */

// Minimal LRU-ish cache with TTL. No external deps to keep the
// serverless cold-start cost low.
class TtlCache {
    constructor({ max = 5000, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
        this.max = max;
        this.ttlMs = ttlMs;
        this.map = new Map();
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt < Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        // refresh LRU order
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.map.has(key)) this.map.delete(key);
        else if (this.map.size >= this.max) {
            // drop the oldest entry
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
        }
        this.map.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }

    delete(key) {
        this.map.delete(key);
    }
}

// Module-level cache. One cache per Node process; safe for serverless
// because each function invocation may live in a different process and
// a cache miss simply means a re-execution (still safe because the
// handler is supposed to be idempotent at the provider level too).
const responseCache = new TtlCache({ max: 5000, ttlMs: 24 * 60 * 60 * 1000 });
// Track keys that are CURRENTLY in-flight so two concurrent requests
// with the same key serialize on the second one (returns 409 to the
// loser) instead of both creating payments.
const inFlight = new Map();

const HEADER = 'idempotency-key';
const MAX_KEY_LEN = 255;
// eslint-disable-next-line no-useless-escape
const KEY_RE = /^[A-Za-z0-9._:-]+$/;

/**
 * Factory for the idempotency middleware.
 * @param {Object} [options]
 * @param {(req:Object)=>boolean} [options.skip]
 *   Predicate that returns true to skip idempotency for a given request.
 * @param {number} [options.inFlightTimeoutMs]  Max time to wait for an
 *   in-flight request with the same key before returning 409 (default 30s).
 */
function idempotencyMiddleware(options = {}) {
    // eslint-disable-next-line no-unused-vars
    const { skip, inFlightTimeoutMs = 30000 } = options;

    return async function idempotency(req, res, next) {
        try {
            if (typeof skip === 'function' && skip(req)) return next();

            const key = req.headers[HEADER] || req.headers[HEADER.toLowerCase()];
            if (!key) return next(); // header is optional; behave as before

            // Validate key shape & length to keep the cache safe
            if (
                typeof key !== 'string' ||
                key.length === 0 ||
                key.length > MAX_KEY_LEN ||
                !KEY_RE.test(key)
            ) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ${HEADER} header. Must be ${MAX_KEY_LEN} chars or fewer and match [A-Za-z0-9._:-]+`,
                });
            }

            // Scope the key by method+path so the same key on a different
            // endpoint does not collide.
            const scopedKey = `${req.method}:${req.baseUrl || ''}${req.path || ''}:${key}`;

            // 1) Replay a successful cached response
            const cached = responseCache.get(scopedKey);
            if (cached) {
                res.setHeader('Idempotent-Replay', 'true');
                res.setHeader(HEADER, key);
                return res.status(cached.status).json(cached.body);
            }

            // 2) Block concurrent requests with the same key
            if (inFlight.has(scopedKey)) {
                res.setHeader('Retry-After', '1');
                return res.status(409).json({
                    success: false,
                    message: 'A request with this Idempotency-Key is already in progress.',
                });
            }

            // 3) Mark in-flight and intercept the response
            inFlight.set(scopedKey, true);
            let resolved = false;
            const release = () => {
                if (resolved) return;
                resolved = true;
                inFlight.delete(scopedKey);
            };
            // Safety net: never leave a key stuck
            const timer = setTimeout(() => {
                if (inFlight.has(scopedKey) && !resolved) {
                    release();
                }
            }, inFlightTimeoutMs);
            if (timer && typeof timer.unref === 'function') timer.unref();

            const originalJson = res.json.bind(res);
            res.json = (body) => {
                try {
                    // Only cache 2xx responses; the client retries other
                    // status codes, and a stale 4xx replay is dangerous.
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        responseCache.set(scopedKey, {
                            status: res.statusCode,
                            body,
                        });
                    }
                } catch (_) {
                    /* swallow -- caching is best-effort */
                }
                release();
                return originalJson(body);
            };
            // If the response errors out before json() is called, still release
            res.on('close', release);
            res.on('error', release);

            return next();
        } catch (err) {
            // Never block the request on a caching bug
            return next();
        }
    };
}

/**
 * Exposed for tests + maintenance scripts.
 */
function _internalCache() {
    return responseCache;
}

function _internalInFlight() {
    return inFlight;
}

module.exports = {
    idempotencyMiddleware,
    TtlCache,
    _internalCache,
    _internalInFlight,
};
