/**
 * PayPal Payment Adapter
 *
 * Handles PayPal checkout and payments.
 * Uses PayPal SDK when API keys are configured, falls back to
 * mock mode for development and demo environments.
 *
 * Environment variables:
 *   PAYMENT_PROVIDER_PAYPAL_CLIENT_ID - PayPal client ID
 *   PAYMENT_PROVIDER_PAYPAL_SECRET    - PayPal client secret
 *   PAYPAL_WEBHOOK_ID                 - PayPal webhook ID
 */

const { v4: uuidv4 } = require('uuid');

// Lazy-load PayPal SDK
let paypal = null;
let paypalClient = null;

function getPayPalClient() {
    const clientId = process.env.PAYMENT_PROVIDER_PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYMENT_PROVIDER_PAYPAL_SECRET;

    if (!clientId || clientId.startsWith('your_paypal') || !clientSecret) {
        return null; // Use mock mode
    }

    if (!paypalClient) {
        try {
            paypal = require('@paypal/checkout-server-sdk');
            const environment = clientId.startsWith('EBX')
                ? new paypal.core.LiveEnvironment(clientId, clientSecret)
                : new paypal.core.SandboxEnvironment(clientId, clientSecret);
            paypalClient = new paypal.core.PayPalHttpClient(environment);
        } catch (err) {
            console.warn('PayPal SDK not available, using mock mode:', err.message);
            return null;
        }
    }
    return paypalClient;
}

// In-memory store for mock orders
const mockOrders = new Map();

/**
 * Create a PayPal Order
 * @param {Object} payload
 * @param {number} payload.amount - Amount
 * @param {string} payload.currency - ISO currency code (default: USD)
 * @param {string} payload.description - Payment description
 * @param {string} payload.userId - User identifier
 * @returns {Promise<Object>} { providerId, approvalUrl, status }
 */
async function createPaymentIntent(payload) {
    const { amount, currency = 'USD', description, userId } = payload;
    const client = getPayPalClient();

    if (client && paypal) {
        // ── Real PayPal API ──
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [
                {
                    reference_id: `vb_${uuidv4().slice(0, 8)}`,
                    description: description || 'VaultBank Payment',
                    amount: {
                        currency_code: currency.toUpperCase(),
                        value: amount.toFixed(2)
                    }
                }
            ],
            application_context: {
                brand_name: 'VaultBank',
                landing_page: 'NO_PREFERENCE',
                user_action: 'PAY_NOW'
            }
        });

        const order = await client.execute(request);
        const approvalLink = order.result.links.find(link => link.rel === 'approve');

        return {
            provider: 'paypal',
            providerId: order.result.id,
            orderId: order.result.id,
            approvalUrl: approvalLink?.href,
            status: order.result.status,
            amount,
            currency
        };
    }

    // ── Mock Mode ──
    const mockId = `PAYPAL_MOCK_${uuidv4().replace(/-/g, '').slice(0, 17).toUpperCase()}`;
    const approvalUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${mockId}`;

    const order = {
        id: mockId,
        intent: 'CAPTURE',
        status: 'CREATED',
        purchase_units: [
            {
                reference_id: `vb_${uuidv4().slice(0, 8)}`,
                description: description || 'VaultBank Payment',
                amount: {
                    currency_code: currency.toUpperCase(),
                    value: amount.toFixed(2)
                }
            }
        ],
        approveUrl: approvalUrl,
        userId,
        createdAt: new Date().toISOString()
    };

    mockOrders.set(mockId, order);

    return {
        provider: 'paypal',
        providerId: mockId,
        orderId: mockId,
        approvalUrl,
        status: 'CREATED',
        amount,
        currency,
        mock: true
    };
}

/**
 * Capture a PayPal Order (after approval)
 * @param {string} orderId - PayPal order ID
 * @returns {Promise<Object>} Capture result
 */
async function capturePayment(orderId) {
    const client = getPayPalClient();

    if (client && paypal) {
        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const capture = await client.execute(request);

        return {
            status: capture.result.status,
            captureId: capture.result.purchase_units[0]?.payments?.captures[0]?.id,
            amount: capture.result.purchase_units[0]?.payments?.captures[0]?.amount
        };
    }

    // Mock mode
    const order = mockOrders.get(orderId);
    if (!order) return { status: 'not_found' };

    order.status = 'COMPLETED';
    order.capturedAt = new Date().toISOString();
    order.captureId = `CAP_MOCK_${uuidv4().slice(0, 12).toUpperCase()}`;
    mockOrders.set(orderId, order);

    return {
        status: 'COMPLETED',
        captureId: order.captureId,
        amount: order.purchase_units[0].amount,
        mock: true
    };
}

/**
 * Verify PayPal webhook signature
 * @param {Object} req - Express request
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (webhookId) {
        // In production, verify the certificate chain and signature
        // For now, verify webhook ID matches
        if (event.webhook_id === webhookId) {
            return { event, verified: true };
        }
        return { event: null, verified: false, error: 'Webhook ID mismatch' };
    }

    // Mock mode – trust the payload
    return { event, verified: true, mock: true };
}

/**
 * Get order status
 * @param {string} providerId - PayPal order ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const client = getPayPalClient();

    if (client && paypal && !providerId.startsWith('PAYPAL_MOCK')) {
        try {
            const request = new paypal.orders.OrdersGetRequest(providerId);
            const order = await client.execute(request);

            return {
                status: order.result.status,
                details: {
                    orderId: order.result.id,
                    intent: order.result.intent,
                    purchaseUnits: order.result.purchase_units
                }
            };
        } catch (err) {
            return { status: 'error', error: err.message };
        }
    }

    // Mock mode
    const mock = mockOrders.get(providerId);
    if (mock) {
        return { status: mock.status, details: mock, mock: true };
    }

    return { status: 'not_found', details: null };
}

module.exports = {
    createPaymentIntent,
    capturePayment,
    verifyWebhook,
    getStatus
};