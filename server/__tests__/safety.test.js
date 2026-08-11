/**
 * Sprint 1 — Unit tests for production-safety validation.
 *
 * Run with: `cd server && npx jest __tests__/safety.test.js`
 */
const safety = require('../payments/safety');

describe('payments/safety', () => {
    const ORIGINAL_ENV = process.env;
    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    test('isPlaceholder recognises common placeholders', () => {
        expect(safety.isPlaceholder('sk_test_your_key_here')).toBe(true);
        expect(safety.isPlaceholder('whsec_change_me')).toBe(true);
        expect(safety.isPlaceholder('rzp_live_REPLACE_ME')).toBe(true);
        expect(safety.isPlaceholder('sk_live_real_secret_1234567890')).toBe(false);
        expect(safety.isPlaceholder('')).toBe(true);
        expect(safety.isPlaceholder(null)).toBe(true);
    });

    test('validateProductionConfig is a no-op outside production', () => {
        process.env = { ...ORIGINAL_ENV, NODE_ENV: 'development' };
        const r = safety.validateProductionConfig();
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });

    test('validateProductionConfig throws in production with placeholder Stripe secret', () => {
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'production',
            PAYMENT_PROVIDER_STRIPE_KEY: 'pk_test_your_key',
            PAYMENT_PROVIDER_STRIPE_SECRET: 'sk_test_your_secret',
            STRIPE_WEBHOOK_SECRET: 'whsec_your_secret',
            // force-enable stripe (the default) by setting ENABLE
            PAYMENT_PROVIDER_STRIPE_ENABLED: 'true',
        };
        const r = safety.validateProductionConfig({ silent: true });
        expect(r.ok).toBe(false);
        expect(r.errors.join('\n')).toMatch(/Stripe/i);
    });

    test('ALLOW_MOCK_IN_PRODUCTION=true bypasses checks', () => {
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'production',
            ALLOW_MOCK_IN_PRODUCTION: 'true',
        };
        const r = safety.validateProductionConfig();
        expect(r.ok).toBe(true);
    });

    test('requireRealKey throws per-provider in production', () => {
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'production',
            PAYMENT_PROVIDER_STRIPE_KEY: 'pk_test_your_key',
            PAYMENT_PROVIDER_STRIPE_SECRET: 'sk_test_your_secret',
            STRIPE_WEBHOOK_SECRET: 'whsec_your_secret',
        };
        expect(() => safety.requireRealKey('stripe')).toThrow(/missing or placeholder/);
    });

    test('requireRealKey passes when all required env vars are real', () => {
        process.env = {
            ...ORIGINAL_ENV,
            NODE_ENV: 'production',
            PAYMENT_PROVIDER_STRIPE_KEY: 'pk_live_REAL_KEY_123',
            PAYMENT_PROVIDER_STRIPE_SECRET: 'sk_live_REAL_SECRET_456',
            STRIPE_WEBHOOK_SECRET: 'whsec_REAL_789',
        };
        expect(() => safety.requireRealKey('stripe')).not.toThrow();
    });

    test('requireRealKey ignores unknown provider', () => {
        process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
        expect(() => safety.requireRealKey('not-a-real-provider')).not.toThrow();
    });
});
