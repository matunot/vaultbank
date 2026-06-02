/**
 * Payment Provider Factory
 * 
 * Registry and factory for payment provider adapters.
 * Each adapter exposes a consistent interface:
 *   - createPaymentIntent(payload) → { providerId, clientToken, redirectUrl, status }
 *   - verifyWebhook(req) → { event, verified }
 *   - getStatus(providerId) → { status, details }
 */

const stripeAdapter = require('./stripe');
const razorpayAdapter = require('./razorpay');
const googlepayAdapter = require('./googlepay');
const paypalAdapter = require('./paypal');
const upiAdapter = require('./upi');
const walletAdapter = require('./wallet');
const bankAdapter = require('./bank');

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
    email: walletAdapter // Email transfers use internal wallet
};

/**
 * Get available payment methods based on feature flags and environment
 * @param {Object} options - { currency, country, user }
 * @returns {Array} List of available payment methods
 */
function getAvailableMethods(options = {}) {
    const { currency = 'USD' } = options;

    const allMethods = [
        { id: 'card', label: 'Card (Stripe)', icon: '💳', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'] },
        { id: 'googlepay', label: 'Google Pay', icon: '📱', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'] },
        { id: 'upi', label: 'UPI (India)', icon: '🇮🇳', enabled: true, currencies: ['INR'] },
        { id: 'razorpay', label: 'Razorpay (India)', icon: '💰', enabled: true, currencies: ['INR'] },
        { id: 'paypal', label: 'PayPal', icon: '💸', enabled: true, currencies: ['USD', 'EUR', 'GBP'] },
        { id: 'bank', label: 'Bank Transfer', icon: '🏦', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'] },
        { id: 'wallet', label: 'Internal Wallet', icon: '👛', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'] },
        { id: 'email', label: 'Email Transfer', icon: '📧', enabled: true, currencies: ['USD', 'EUR', 'GBP', 'INR'] }
    ];

    // Filter by currency availability
    return allMethods
        .filter(m => m.enabled && m.currencies.includes(currency))
        .map(({ id, label, icon }) => ({ id, label, icon }));
}

/**
 * Get provider adapter by method name
 * @param {string} method - Payment method identifier
 * @returns {Object} Provider adapter
 */
function getProvider(method) {
    const provider = providers[method.toLowerCase()];
    if (!provider) {
        throw new Error(`Unknown payment method: ${method}`);
    }
    return provider;
}

/**
 * Create a payment intent using the appropriate provider
 * @param {string} method - Payment method
 * @param {Object} payload - Payment details
 * @returns {Promise<Object>} Payment intent result
 */
async function createPayment(method, payload) {
    const provider = getProvider(method);
    return provider.createPaymentIntent(payload);
}

/**
 * Verify webhook signature and parse event
 * @param {string} provider - Provider name
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Verified event data
 */
async function verifyWebhook(provider, req) {
    const adapter = providers[provider];
    if (!adapter || !adapter.verifyWebhook) {
        throw new Error(`Webhook not supported for provider: ${provider}`);
    }
    return adapter.verifyWebhook(req);
}

/**
 * Get payment status from provider
 * @param {string} method - Payment method
 * @param {string} providerId - Provider's payment ID
 * @returns {Promise<Object>} Payment status
 */
async function getPaymentStatus(method, providerId) {
    const provider = getProvider(method);
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
    providers
};