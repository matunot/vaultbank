/**
 * Stripe Payment Adapter
 *
 * Handles card payments and Google Pay through Stripe.
 * Uses Stripe SDK when API keys are configured, falls back to
 * mock mode for development and demo environments.
 *
 * Environment variables:
 *   PAYMENT_PROVIDER_STRIPE_KEY    – Stripe publishable key (pk_test_...)
 *   PAYMENT_PROVIDER_STRIPE_SECRET – Stripe secret key (sk_test_...)
 *   STRIPE_WEBHOOK_SECRET          – Webhook signing secret (whsec_...)
 */

const { v4: uuidv4 } = require('uuid');

// Lazy-load Stripe SDK – allows the module to load even if the
// SDK is not installed (mock mode will be used instead).
let Stripe = null;
let stripe = null;

function getStripe() {
    const secret = process.env.PAYMENT_PROVIDER_STRIPE_SECRET;
    if (!secret || secret.startsWith('sk_test_your')) {
        return null; // No real key – use mock mode
    }
    if (!stripe) {
        try {
            Stripe = require('stripe');
            stripe = new Stripe(secret, { apiVersion: '2023-10-16' });
        } catch (err) {
            console.warn('Stripe SDK not available, using mock mode:', err.message);
            return null;
        }
    }
    return stripe;
}

// In-memory store for mock payment intents (demo mode)
const mockIntents = new Map();

/**
 * Create a Stripe Payment Intent
 * @param {Object} payload
 * @param {number} payload.amount - Amount in smallest unit (cents/paise)
 * @param {string} payload.currency - ISO currency code
 * @param {string} payload.description - Payment description
 * @param {string} payload.userId - User identifier
 * @param {string} [payload.paymentMethod] - card | googlepay
 * @returns {Promise<Object>} { providerId, clientSecret, status }
 */
async function createPaymentIntent(payload) {
    const { amount, currency = 'usd', description, userId, paymentMethod = 'card' } = payload;
    const s = getStripe();

    if (s) {
        // ── Real Stripe API ──
        const intent = await s.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: currency.toLowerCase(),
            description,
            metadata: { userId, paymentMethod },
            automatic_payment_methods: { enabled: true }
        });

        return {
            provider: 'stripe',
            providerId: intent.id,
            clientSecret: intent.client_secret,
            status: intent.status,
            amount,
            currency,
            publishableKey: process.env.PAYMENT_PROVIDER_STRIPE_KEY
        };
    }

    // ── Mock Mode ──
    const mockId = `pi_mock_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const mockSecret = `${mockId}_secret_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const intent = {
        id: mockId,
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        description,
        userId,
        paymentMethod,
        status: 'requires_payment_method',
        clientSecret: mockSecret,
        createdAt: new Date().toISOString()
    };

    mockIntents.set(mockId, intent);

    return {
        provider: 'stripe',
        providerId: mockId,
        clientSecret: mockSecret,
        status: 'requires_payment_method',
        amount,
        currency,
        publishableKey: process.env.PAYMENT_PROVIDER_STRIPE_KEY || 'pk_test_mock',
        mock: true
    };
}

/**
 * Verify Stripe webhook signature
 * @param {Object} req - Express request (needs raw body)
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
    const s = getStripe();
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (s && webhookSecret && sig) {
        try {
            const event = s.webhooks.constructEvent(req.rawBody || req.body, sig, webhookSecret);
            return { event, verified: true };
        } catch (err) {
            console.error('Stripe webhook verification failed:', err.message);
            return { event: null, verified: false, error: err.message };
        }
    }

    // Mock mode – trust the payload
    return {
        event: typeof req.body === 'string' ? JSON.parse(req.body) : req.body,
        verified: true,
        mock: true
    };
}

/**
 * Get payment intent status
 * @param {string} providerId - Stripe payment intent ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const s = getStripe();

    if (s && providerId.startsWith('pi_')) {
        const intent = await s.paymentIntents.retrieve(providerId);
        return {
            status: intent.status,
            details: {
                amount: intent.amount / 100,
                currency: intent.currency,
                paymentMethod: intent.payment_method,
                charges: intent.charges?.data?.map(c => ({
                    id: c.id,
                    status: c.status,
                    receiptUrl: c.receipt_url
                }))
            }
        };
    }

    // Mock mode
    const mock = mockIntents.get(providerId);
    if (mock) {
        return { status: mock.status, details: mock, mock: true };
    }

    return { status: 'not_found', details: null };
}

/**
 * Confirm a mock payment (for demo/testing)
 * @param {string} providerId
 * @returns {Object} Updated intent
 */
function confirmMockPayment(providerId) {
    const intent = mockIntents.get(providerId);
    if (!intent) return null;

    intent.status = 'succeeded';
    intent.confirmedAt = new Date().toISOString();
    mockIntents.set(providerId, intent);

    return intent;
}

module.exports = {
    createPaymentIntent,
    verifyWebhook,
    getStatus,
    confirmMockPayment,
    getStripe
};