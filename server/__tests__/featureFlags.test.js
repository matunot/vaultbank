/**
 * Sprint 2 — Unit tests for the feature flag system.
 *
 * The DB-backed parts of `flags` are exercised via demo-mode
 * fallthrough (writes silently no-op, reads return []). We
 * focus on the pure helpers: `hashToFraction()` and
 * `shouldUseLiveProvider()`.
 */
// Hermetic by design (see header): the DB seam is faked so the suite can
// never hang on Neon connection saturation (or touch live data) when the
// whole battery runs in parallel workers. flags.js consumes only
// query() which here always resolves with no rows -> cache-only behavior.
jest.mock('../config/db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));
const flags = require('../flags/flags');

describe('flags/flags', () => {
    test('hashToFraction returns a number in [0,1)', () => {
        for (let i = 0; i < 50; i += 1) {
            const f = flags.hashToFraction('user-' + i);
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThan(1);
        }
    });

    test('hashToFraction is deterministic for the same input', () => {
        const a = flags.hashToFraction('user-42');
        const b = flags.hashToFraction('user-42');
        expect(a).toBe(b);
    });

    test('hashToFraction distributes roughly uniformly', () => {
        // 1000 samples, 10 buckets of width 0.1; each bucket should
        // have between 50 and 200 samples (very loose bounds).
        const counts = new Array(10).fill(0);
        for (let i = 0; i < 1000; i += 1) {
            const f = flags.hashToFraction('uniform-test-' + i);
            counts[Math.min(9, Math.floor(f * 10))] += 1;
        }
        for (const c of counts) {
            expect(c).toBeGreaterThanOrEqual(50);
            expect(c).toBeLessThanOrEqual(200);
        }
    });

    test('shouldUseLiveProvider returns false when flag is missing', () => {
        // We have not seeded any flag in this test, so the cache is empty.
        const req = { user: { id: 'u1' }, ip: '127.0.0.1' };
        const result = flags.shouldUseLiveProvider(req);
        // Without a flag, shouldUseLiveProvider returns false (default).
        expect(result).toBe(false);
    });

    test('setFlag validates percentage bounds', async () => {
        await expect(
            flags.setFlag({ key: 'payments.live_providers_percent', percentage: -5 })
        ).rejects.toThrow(/percentage/);
        await expect(
            flags.setFlag({ key: 'payments.live_providers_percent', percentage: 150 })
        ).rejects.toThrow(/percentage/);
    });

    test('setFlag accepts 0..100 and updates the cache', async () => {
        const f = await flags.setFlag({
            key: 'test.flag',
            percentage: 50,
            enabled: true,
            updatedBy: 'jest',
        });
        expect(f.key).toBe('test.flag');
        expect(f.percentage).toBe(50);
        expect(flags.getFlag('test.flag').percentage).toBe(50);
    });
});
