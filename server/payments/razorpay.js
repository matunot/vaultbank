/**
 * Razorpay Payment Adapter
 *
 * Handles UPI, cards, and netbanking payments through Razorpay (India).
 * Uses Razorpay SDK when API keys are configured, falls back to
 * mock mode for development and demo environments.
 *
 * Environment variables:
 *   PAYMENT_PROVIDER_RAZORPAY_KEY    – Razorpay key ID (rzp_test_...)
 *   PAYMENT_PROVIDER_RAZORPAY_SECRET – Razorpay key secret
 *   RAZORPAY_WEBHOOK_SECRET          – Webhook signing secret
 */

const { v4: uuidv4 } = require('uuid');

// Lazy-load Razorpay SDK – allows the module to load even if the
// SDK is not installed (mock mode will be used instead).
let Razorpay = null;
let razorpay = null;

function getRazorpay() {
    const keyId = process.env.PAYMENT_PROVIDER_RAZORPAY_KEY;
    const keySecret = process.env.PAYMENT_PROVIDER_RAZORPAY_SECRET;
    if (!keyId || !keySecret || keyId.startsWith('rzp_test_your')) {
        return null; // No real key – use mock mode
    }
    if (!razorpay) {
        try {
            Razorpay = require('razorpay');
            razorpay = new Razorpay({
                key_id: keyId,
                key_secret: keySecret
            });
        } catch (err) {
            console.warn('Razorpay SDK not available, using mock mode:', err.message);
            return null;
        }
    }
    return razorpay;
}

// In-memory store for mock payment orders (demo mode)
const mockOrders = new Map();

/**
 * Create a Razorpay Order (payment intent)
 * @param {Object} payload
 * @param {number} payload.amount - Amount in base currency (INR)
 * @param {string} payload.currency - ISO currency code (default: INR)
 * @param {string} payload.description - Payment description / notes
 * @param {string} payload.userId - User identifier
 * @param {string} [payload.receipt] - Receipt identifier
 * @returns {Promise<Object>} { providerId, keyId, clientSecret, status }
 */
async function createPaymentIntent(payload) {
    const { amount, currency = 'INR', description, userId, receipt } = payload;
    const rz = getRazorpay();

    if (rz) {
        // ── Real Razorpay API ──
        const order = await rz.orders.create({
            amount: Math.round(amount * 100), // Razorpay expects paise
            currency: currency.toUpperCase(),
            receipt: receipt || `vb_${Date.now()}`,
            notes: {
                description: description || 'VaultBank Payment',
                userId
            }
        });

        return {
            provider: 'razorpay',
            providerId: order.id,
            keyId: process.env.PAYMENT_PROVIDER_RAZORPAY_KEY,
            clientSecret: null, // Razorpay uses key_id + order_id on client
            status: order.status || 'created',
            amount,
            currency,
            orderId: order.id
        };
    }

    // ── Mock Mode ──
    const mockId = `order_mock_${uuidv4().replace(/-/g, '').slice(0, 14)}`;

    const order = {
        id: mockId,
        entity: 'order',
        amount: Math.round(amount * 100),
        amount_paid: 0,
        amount_due: Math.round(amount * 100),
        currency: currency.toUpperCase(),
        receipt: receipt || `vb_mock_${Date.now()}`,
        status: 'created',
        attempts: 0,
        notes: {
            description: description || 'VaultBank Payment (Mock)',
            userId
        },
        created_at: Math.floor(Date.now() / 1000),
        createdAt: new Date().toISOString()
    };

    mockOrders.set(mockId, order);

    return {
        provider: 'razorpay',
        providerId: mockId,
        keyId: process.env.PAYMENT_PROVIDER_RAZORPAY_KEY || 'rzp_test_mock',
        clientSecret: null,
        status: 'created',
        amount,
        currency,
        orderId: mockId,
        mock: true
    };
}

/**
 * Verify Razorpay webhook signature
 * @param {Object} req - Express request
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
    const rz = getRazorpay();
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const sig = req.headers['x-razorpay-signature'];

    if (rz && webhookSecret && sig) {
        try {
            const crypto = require('crypto');
            const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            const expectedSig = crypto
                .createHmac('sha256', webhookSecret)
                .update(body)
                .digest('hex');

            if (sig === expectedSig) {
                const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                return { event, verified: true };
            }
            return { event: null, verified: false, error: 'Signature mismatch' };
        } catch (err) {
            console.error('Razorpay webhook verification failed:', err.message);
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
 * Get payment/order status
 * @param {string} providerId - Razorpay order ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const rz = getRazorpay();

    if (rz && providerId.startsWith('order_')) {
        try {
            const order = await rz.orders.fetch(providerId);
            return {
                status: order.status,
                details: {
                    id: order.id,
                    amount: order.amount / 100,
                    amount_paid: (order.amount_paid || 0) / 100,
                    currency: order.currency,
                    status: order.status,
                    attempts: order.attempts
                }
            };
        } catch (err) {
            return { status: 'error', details: { error: err.message } };
        }
    }

    // Mock mode
    const mock = mockOrders.get(providerId);
    if (mock) {
        return { status: mock.status, details: mock, mock: true };
    }

    return { status: 'not_found', details: null };
}

/**
 * Confirm a mock payment (for demo/testing)
 * Simulates Razorpay payment capture
 * @param {string} providerId - Order ID
 * @param {string} [paymentId] - Simulated payment ID
 * @returns {Object} Updated order
 */
function confirmMockPayment(providerId, paymentId) {
    const order = mockOrders.get(providerId);
    if (!order) return null;

    const mockPaymentId = paymentId || `pay_mock_${uuidv4().replace(/-/g, '').slice(0, 14)}`;

    order.status = 'paid';
    order.amount_paid = order.amount;
    order.amount_due = 0;
    order.attempts = 1;
    order.confirmedAt = new Date().toISOString();
    order.paymentId = mockPaymentId;

    mockOrders.set(providerId, order);

    return {
        ...order,
        payment_id: mockPaymentId,
        status: 'paid'
    };
}

module.exports = {
    createPaymentIntent,
    verifyWebhook,
    getStatus,
    confirmMockPayment,
    getRazorpay
};