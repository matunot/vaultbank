/**
 * Sprint 1 — Unit tests for the idempotency middleware.
 *
 * Run with: `cd server && npx jest __tests__/idempotency.test.js`
 */
const { idempotencyMiddleware, TtlCache, _internalCache, _internalInFlight } =
    require('../middleware/idempotency');

function makeRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) {
            this.headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        on() {
            // no-op
            return this;
        },
    };
    return res;
}

function makeReq({ method = 'POST', path = '/api/test', idemKey = null } = {}) {
    return {
        method,
        path,
        baseUrl: '',
        headers: idemKey ? { 'idempotency-key': idemKey } : {},
    };
}

describe('idempotencyMiddleware', () => {
    test('passes through when no Idempotency-Key header', (done) => {
        const mw = idempotencyMiddleware();
        const req = makeReq();
        const res = makeRes();
        mw(req, res, () => {
            // next() called synchronously
            expect(true).toBe(true);
            done();
        });
    });

    test('rejects invalid Idempotency-Key shape', () => {
        const mw = idempotencyMiddleware();
        const req = makeReq({ idemKey: 'has spaces and ! symbols' });
        const res = makeRes();
        let nextCalled = false;
        mw(req, res, () => {
            nextCalled = true;
        });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('rejects too-long Idempotency-Key', () => {
        const mw = idempotencyMiddleware();
        const req = makeReq({ idemKey: 'a'.repeat(256) });
        const res = makeRes();
        let nextCalled = false;
        mw(req, res, () => {
            nextCalled = true;
        });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(400);
    });

    test('replays cached response on second call with same key', (done) => {
        // Clear the in-memory cache so we start clean
        _internalCache().map.clear();
        _internalInFlight().clear();

        const mw = idempotencyMiddleware();
        const key = 'idem-test-replay-1';
        const res1 = makeRes();
        const req1 = makeReq({ idemKey: key });

        mw(req1, res1, () => {
            // Simulate the handler calling res.json(...) which the middleware wraps.
            res1.json({ success: true, status: 'succeeded', echo: 1 });
            // Now the second request with the same key should be a replay
            const res2 = makeRes();
            const req2 = makeReq({ idemKey: key });
            mw(req2, res2, () => {
                done(new Error('next() should not be called for a replay'));
            });
            // Instead of next, the middleware should have set status 200 and the same body
            expect(res2.statusCode).toBe(200);
            expect(res2.body.echo).toBe(1);
            expect(res2.headers['Idempotent-Replay']).toBe('true');
            done();
        });
    });

    test('returns 409 for concurrent in-flight requests with the same key', (done) => {
        _internalCache().map.clear();
        _internalInFlight().clear();
        const mw = idempotencyMiddleware();
        const key = 'idem-test-concurrent';
        const res1 = makeRes();
        const res2 = makeRes();
        const req1 = makeReq({ idemKey: key });
        const req2 = makeReq({ idemKey: key });
        mw(req1, res1, () => {
            // While req1 is still "in flight", fire req2
            mw(req2, res2, () => {
                done(new Error('second request should not hit next()'));
            });
            expect(res2.statusCode).toBe(409);
            done();
        });
    });

    test('TtlCache expires entries after ttlMs', async () => {
        const cache = new TtlCache({ max: 10, ttlMs: 30 });
        cache.set('k', 'v');
        expect(cache.get('k')).toBe('v');
        await new Promise((r) => setTimeout(r, 50));
        expect(cache.get('k')).toBeUndefined();
    });
});
