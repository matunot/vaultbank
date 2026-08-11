/**
 * Production-safety validation (Sprint 1)
 * --------------------------------------
 * At server boot we verify that all required provider secrets are present
 * if the app is running in production and live mode is requested. If a
 * provider is "requested" (any of its method IDs is enabled in env) and
 * the corresponding secret is missing or still a placeholder, we throw.
 *
 * Override: set `ALLOW_MOCK_IN_PRODUCTION=true` to permit mock mode
 * (useful for staging deploys with no real keys, never for real money).
 *
 * This module is intentionally side-effect free at import time: it
 * exports `validateProductionConfig()` which the server entry point
 * (or the Vercel function) calls at startup. It also exports a small
 * `requireRealKey()` helper for the adapter factory so a per-call
 * check happens too (defense in depth).
 */

// Fragments that indicate a value is a placeholder and not a real secret.
// The list includes common patterns used in the repo as well as a generic
// "placeholder" keyword to catch values like "pk_test_placeholder".
const PLACEHOLDER_FRAGMENTS = [
    'your_',
    '_your_',
    'replace',
    'change',
    'changeme',
    'example',
    'sk_test_your',
    'pk_test_your',
    'rzp_test_your',
    'placeholder',
];

function isPlaceholder(value) {
    if (!value || typeof value !== 'string') return true;
    const v = value.toLowerCase();
    return PLACEHOLDER_FRAGMENTS.some((frag) => v.includes(frag));
}

const PROVIDER_REQUIREMENTS = {
    stripe: {
        label: 'Stripe (card / Google Pay)',
        required: [
            'PAYMENT_PROVIDER_STRIPE_KEY',
            'PAYMENT_PROVIDER_STRIPE_SECRET',
            'STRIPE_WEBHOOK_SECRET',
        ],
    },
    razorpay: {
        label: 'Razorpay (UPI / cards IN)',
        required: [
            'PAYMENT_PROVIDER_RAZORPAY_KEY',
            'PAYMENT_PROVIDER_RAZORPAY_SECRET',
            'RAZORPAY_WEBHOOK_SECRET',
        ],
    },
    paypal: {
        label: 'PayPal',
        required: [
            'PAYMENT_PROVIDER_PAYPAL_CLIENT_ID',
            'PAYMENT_PROVIDER_PAYPAL_SECRET',
            'PAYPAL_WEBHOOK_ID',
        ],
    },
    googlepay: {
        label: 'Google Pay (via Stripe)',
        required: ['PAYMENT_PROVIDER_GOOGLEPAY_MERCHANT_ID'],
    },
    upi: {
        label: 'UPI',
        required: ['PAYMENT_PROVIDER_UPI_PROVIDER'],
    },
};

/**
 * Returns a list of provider keys that the operator has chosen to
 * enable. Defaults to the four external providers + upi. Setting
 * PAYMENT_PROVIDER_<NAME>_ENABLED=false for a specific provider
 * disables it.
 */
function getEnabledProviders() {
    const providers = Object.keys(PROVIDER_REQUIREMENTS);
    return providers.filter((name) => {
        const flag = process.env[`PAYMENT_PROVIDER_${name.toUpperCase()}_ENABLED`];
        if (flag === 'false' || flag === '0') return false;
        return true;
    });
}

/**
 * Validate all enabled providers' required env vars. Throws a single
 * aggregated Error if anything is missing or placeholder.
 */
function validateProductionConfig(opts = {}) {
    const errors = [];
    const isProd = process.env.NODE_ENV === 'production';
    const allowMock = String(process.env.ALLOW_MOCK_IN_PRODUCTION || '').toLowerCase() === 'true';

    if (!isProd) {
        return { ok: true, errors: [] };
    }
    if (allowMock) {
        if (!opts.silent) {
            console.warn(
                '[payments-safety] ALLOW_MOCK_IN_PRODUCTION=true -- mock providers will be used. NEVER set this in real-money production.'
            );
        }
        return { ok: true, errors: [] };
    }

    const enabled = getEnabledProviders();
    for (const name of enabled) {
        const spec = PROVIDER_REQUIREMENTS[name];
        for (const envName of spec.required) {
            const value = process.env[envName];
            if (!value || isPlaceholder(value)) {
                errors.push(
                    '[' + spec.label + '] ' + envName + ' is missing or still a placeholder. ' +
                    'Set it to a real production secret or disable the provider ' +
                    'with PAYMENT_PROVIDER_' + name.toUpperCase() + '_ENABLED=false.'
                );
            }
        }
    }

    if (errors.length) {
        if (opts.silent) return { ok: false, errors };
        const err = new Error(
            'Production payment configuration invalid. Refusing to start.\n  - ' +
            errors.join('\n  - ')
        );
        err.code = 'PAYMENTS_CONFIG_INVALID';
        err.details = errors;
        throw err;
    }
    return { ok: true, errors: [] };
}

/**
 * Per-call guard. Throws if a specific provider is being used in
 * production without real keys.
 */
function requireRealKey(providerName, opts = {}) {
    const env = opts.env || process.env;
    const isProd = env.NODE_ENV === 'production';
    const allowMock = String(env.ALLOW_MOCK_IN_PRODUCTION || '').toLowerCase() === 'true';

    if (!isProd) return;
    if (allowMock) return;

    const spec = PROVIDER_REQUIREMENTS[providerName];
    if (!spec) return;

    const missing = spec.required
        .map((name) => ({ name, value: env[name] }))
        .filter(({ value }) => !value || isPlaceholder(value));
    if (missing.length) {
        const err = new Error(
            'Refusing to use provider "' + providerName + '" in production: ' +
            'missing or placeholder env vars: ' + missing.map((m) => m.name).join(', ') + '. ' +
            'Set ALLOW_MOCK_IN_PRODUCTION=true to bypass (NOT recommended for real money).'
        );
        err.code = 'PAYMENTS_PROVIDER_MISCONFIGURED';
        throw err;
    }
}

module.exports = {
    validateProductionConfig,
    requireRealKey,
    getEnabledProviders,
    isPlaceholder,
    PROVIDER_REQUIREMENTS,
};
