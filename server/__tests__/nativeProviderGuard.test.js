'use strict';

const { isNativeRailsOnly } = require('../utils/nativeRailsOnly');
const { nativeProviderGuard, isBlockedProviderPath } = require('../middleware/nativeProviderGuard');

function withEnv(changes, run) {
    const env = process['env'];
    const previous = {};
    for (const key of Object.keys(changes)) {
        previous[key] = env[key];
        if (changes[key] === undefined) delete env[key];
        else env[key] = changes[key];
    }
    try { return run(); }
    finally {
        for (const key of Object.keys(changes)) {
            if (previous[key] === undefined) delete env[key];
            else env[key] = previous[key];
        }
    }
}

function callGuard(path) {
    const req = { path };
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    let nextCalled = false;
    nativeProviderGuard(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
}

describe('VaultBank native-only production guard', () => {
    test('defaults to native-only on production and Render when the flag is absent', () => {
        withEnv({ NODE_ENV: 'production', RENDER: undefined, RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: undefined }, () => {
            expect(isNativeRailsOnly()).toBe(true);
        });
        withEnv({ NODE_ENV: undefined, RENDER: 'true', RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: undefined }, () => {
            expect(isNativeRailsOnly()).toBe(true);
        });
    });

    test('an explicit non-native opt-out is required to re-enable legacy rails', () => {
        withEnv({ NODE_ENV: 'production', RENDER: undefined, RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: 'false' }, () => {
            expect(isNativeRailsOnly()).toBe(false);
            expect(callGuard('/api/stripe/deposit').nextCalled).toBe(true);
        });
    });

    test('blocks third-party and paused crypto provider endpoints in native-only production', () => {
        withEnv({ NODE_ENV: 'production', RENDER: undefined, RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: undefined }, () => {
            const blocked = [
                '/api/stripe/deposit',
                '/api/paypal/capture',
                '/api/issuing/cards',
                '/api/usdc/deposit',
                '/api/collections/my-details',
                '/api/payouts/requests',
                '/api/payments/transfer',
                '/api/payments/webhook/stripe',
                '/api/payments/upi/initiate',
                '/api/provider-webhooks/cashfree',
                '/api/webhooks/stripe',
            ];
            for (const path of blocked) {
                expect(isBlockedProviderPath(path)).toBe(true);
                const result = callGuard(path);
                expect(result.nextCalled).toBe(false);
                expect(result.res.statusCode).toBe(503);
                expect(result.res.body.code).toBe('NATIVE_RAILS_ONLY');
            }
        });
    });

    test('leaves native account, bank-deposit, and direct UPI endpoints available', () => {
        withEnv({ NODE_ENV: 'production', RENDER: undefined, RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: undefined }, () => {
            const nativePaths = [
                '/api/account/transfer',
                '/api/bank-deposits/instructions',
                '/api/bank-deposits/admin/instructions',
                '/api/direct-upi/intents',
                '/api/direct-bank-payouts/requests',
                '/api/payments/readiness',
            ];
            for (const path of nativePaths) {
                expect(isBlockedProviderPath(path)).toBe(false);
                expect(callGuard(path).nextCalled).toBe(true);
            }
        });
    });

    test('payment adapter factory exposes no legacy methods in native-only production', () => {
        withEnv({ NODE_ENV: 'production', RENDER: undefined, RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: undefined }, () => {
            jest.resetModules();
            const paymentProviders = require('../payments');
            expect(paymentProviders.getAvailableMethods({ currency: 'USD' })).toEqual([]);
            expect(() => paymentProviders.getProvider('stripe', {})).toThrow('native-only production mode');
        });
    });

    test('does not block legacy providers in ordinary development/test mode', () => {
        withEnv({ NODE_ENV: 'test', RENDER: undefined, RENDER_SERVICE_ID: undefined, VB_NATIVE_RAILS_ONLY: undefined }, () => {
            expect(isNativeRailsOnly()).toBe(false);
            expect(callGuard('/api/stripe/deposit').nextCalled).toBe(true);
        });
    });
});
