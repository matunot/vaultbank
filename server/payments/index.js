/**
 * Payment Provider Factory
 *
 * Registry and factory for payment provider adapters.
 * Each adapter exposes a consistent interface:
 *   - createPaymentIntent(payload) -> { providerId, clientToken, redirectUrl, status }
 *   - verifyWebhook(req) -> { event, verified }
 *   - getStatus(providerId) -> { status, details }
 *
 * Sprint 1: production-safety guard wired into `getProvider` and
 * `createPayment`. In production, a provider is rejected if its
 * required env vars are missing or still placeholders.
 *
 * Sprint 2: canary feature flag. If the request is not in the
 * `payments.live_providers_percent` bucket, the factory falls back
 * to mock mode even when real keys ARE configured. This is the
 * "kill switch" we use for safe canary rollouts.
 */

const stripeAdapter = require('./stripe');
const razorpayAdapter = require('./razorpay');
const googlepayAdapter = require('./googlepay');
const paypalAdapter = require('./paypal');
const upiAdapter = require('./upi');
const walletAdapter = require('./wallet');
const bankAdapter = require('./bank');
const { requireRealKey } = require('./safety');
let _flags = null;
function flags() {
    if (_flags === null) {
        try {
            _flags = require('../flags/flags');
        } catch (err) {
            _flags = false;
        }
    }
    return _flags || null;
}

// Map our external provider name to the env-var block required for it.
// googlepay reuses Stripe keys so we don't double-check.
const PROVIDER_SAFETY_NAME = {
    stripe: 'stripe',
    card: 'stripe',
    razorpay: 'razorpay',
    paypal: 'paypal',
    googlepay: 'googlepay',
    upi: 'upi',
    // wallet / bank / email are always allowed (no external deps)
};

// Provider registry
const providers = {
    stripe: stripeAdapter,
    card: stripeAdapter, // Card payments use Stripe
    razorpay: razorpayAdapter,
    googlepay: googlepayAdapter,
    paypal: paypalAdapter,
    upi: upiAdapter,
    wallet: walletAdapter,
    bank: bankAdapter,
    email: walletAdapter, // Email transfers use internal wallet
};

/**
 * Decide whether a request should be served by the live provider
 * (real Stripe / Razorpay / PayPal) or fall back to mock.
 *
 * Returns true when:
 *   * the canary flag is enabled at >0%, AND
 *   * the deterministic hash of the request falls within that bucket
 *
 * Returns false when the flag is missing, disabled, or at 0%.
 */
function liveModeEnabled(req) {
    const f = flags();
    if (!f) return true; // no flag module -> assume live (dev convenience)
    try {
        return f.shouldUseLiveProvider(req);
    } catch (_) {
        return true;
    }
}

/**
 * Get available payment methods based on feature flags and environment.
 * Internal-only methods (wallet / bank / email) are always listed.
 * External methods are only listed when their keys are present (live)
 * OR when NODE_ENV is not production (mock is fine in dev).
 */
function getAvailableMethods(options = {}) {
    const { currency = 'USD' } = options;
    const isProd = process.env.NODE_ENV === 'production';

    const allMethods = [
        { id: 'card', label: 'Card (Stripe)', icon: '\u{1F4B3}', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'], provider: 'stripe' },
        { id: 'googlepay', label: 'Google Pay', icon: '\u{1F4F1}', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'], provider: 'googlepay' },
        { id: 'upi', label: 'UPI (India)', icon: '\u{1F1EE}\u{1F1F3}', enabled: true, currencies: ['INR'], provider: 'upi' },
        { id: 'razorpay', label: 'Razorpay (India)', icon: '\u{1F4B0}', enabled: true, currencies: ['INR'], provider: 'razorpay' },
        { id: 'paypal', label: 'PayPal', icon: '\u{1F4B8}', enabled: true, currencies: ['USD', 'EUR', 'GBP'], provider: 'paypal' },
        { id: 'bank', label: 'Bank Transfer', icon: '\u{1F3E6}', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'], provider: null },
        { id: 'wallet', label: 'Internal Wallet', icon: '\u{1F45B}', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'], provider: null },
        { id: 'email', label: 'Email Transfer', icon: '\u{1F4E7}', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'], provider: null },
    ];

    return allMethods
        .filter((m) => m.enabled && m.currencies.includes(currency))
        .filter((m) => {
            if (!m.provider) return true;
            if (!isProd) return true;
            try {
                requireRealKey(m.provider);
                return true;
            } catch (_) {
                return false;
            }
        })
        .map(({ id, label, icon }) => ({ id, label, icon }));
}

/**
 * Get provider adapter by method name.
 * Honors the canary feature flag: in production, if the canary flag
 * is at 0% (or the request hashes outside the bucket), the safety
 * check is skipped so the adapter falls back to its mock mode.
 */
function getProvider(method, req) {
    const provider = providers[String(method || '').toLowerCase()];
    if (!provider) {
        throw new Error('Unknown payment method: ' + method);
    }
    const safetyName = PROVIDER_SAFETY_NAME[method.toLowerCase()];
    if (safetyName) {
        // Allow the call if either the canary flag is on for this req,
        // or we are not in production. requireRealKey() itself checks
        // NODE_ENV, so this is just a "should we even try live mode"
        // gate on top of the per-key placeholder check.
        if (process.env.NODE_ENV === 'production' && req && !liveModeEnabled(req)) {
            // Canary off for this request: skip the safety throw and let
            // the adapter return its mock response. This is the soft
            // kill switch: the next request with the flag bumped will
            // reach the safety check.
            return provider;
        }
        requireRealKey(safetyName);
    }
    return provider;
}

/**
 * Create a payment intent using the appropriate provider.
 */
async function createPayment(method, payload, req) {
    const provider = getProvider(method, req);
    return provider.createPaymentIntent(payload);
}

/**
 * Verify webhook signature and parse event.
 */
async function verifyWebhook(provider, req) {
    const adapter = providers[provider];
    if (!adapter || !adapter.verifyWebhook) {
        throw new Error('Webhook not supported for provider: ' + provider);
    }
    return adapter.verifyWebhook(req);
}

/**
 * Get payment status from provider.
 */
async function getPaymentStatus(method, providerId, req) {
    const provider = getProvider(method, req);
    if (!provider.getStatus) {
        return { status: 'unknown', message: 'Status check not available for this provider' };
    }
    return provider.getStatus(providerId);
}

module.exports = {
    getAvailableMethods,
    getProvider,
    createPayment,
    verifyWebhook,
    getPaymentStatus,
    liveModeEnabled,
    providers,
};
