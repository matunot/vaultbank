'use strict';

const {
  validateProductionConfig,
  requireRealKey,
  PROVIDER_REQUIREMENTS,
} = require('../payments/safety');

const ENV_KEYS = Array.from(new Set([
  'NODE_ENV',
  'ALLOW_MOCK_IN_PRODUCTION',
  ...Object.values(PROVIDER_REQUIREMENTS).flatMap((provider) => provider.required),
  ...Object.keys(PROVIDER_REQUIREMENTS).map((name) => 'PAYMENT_PROVIDER_' + name.toUpperCase() + '_ENABLED'),
]));
const SAVED = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    SAVED[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
    delete SAVED[key];
  }
});

describe('production payment safety diagnostics', () => {
  test('native-only mode skips legacy-provider credential warnings', () => {
    const result = validateProductionConfig({ silent: true, nativeOnly: true });

    expect(result).toEqual({
      ok: true,
      errors: [],
      skipped: true,
      reason: 'native-only',
    });
  });

  test('native-only diagnostic bypass does not make legacy provider calls permissible', () => {
    expect(validateProductionConfig({ silent: true, nativeOnly: true }).ok).toBe(true);

    expect(() => requireRealKey('stripe')).toThrow(/Refusing to use provider "stripe" in production/);
    expect(() => requireRealKey('razorpay')).toThrow(/Refusing to use provider "razorpay" in production/);
  });

  test('legacy validation still catches missing credentials when native-only mode is not requested', () => {
    const result = validateProductionConfig({ silent: true, nativeOnly: false });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join('\n')).toMatch(/PAYMENT_PROVIDER_STRIPE_KEY/);
  });
});
