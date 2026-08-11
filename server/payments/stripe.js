/**
 * Stripe Payment Adapter
 *
 * Handles card payments and Google Pay through Stripe using real Stripe API calls.
 * This adapter no longer falls back to mock payment intents. Use Stripe test keys
 * for sandbox testing and Stripe live keys for production money movement.
 *
 * Environment variables:
 *   PAYMENT_PROVIDER_STRIPE_KEY    – Stripe publishable key (pk_test_... or pk_live_...)
 *   PAYMENT_PROVIDER_STRIPE_SECRET – Stripe secret key (sk_test_... or sk_live_...)
 *   STRIPE_WEBHOOK_SECRET          – Webhook signing secret (whsec_...)
 */

let Stripe = null;
let stripe = null;

function providerConfigError(message) {
  const error = new Error(message);
  error.code = 'PAYMENTS_PROVIDER_MISCONFIGURED';
  return error;
}

function isPlaceholderSecret(secret) {
  return (
    !secret ||
    /your|placeholder|demo|sk_test_your|pk_test_your|whsec_your/i.test(secret)
  );
}

/**
 * Create or reuse the Stripe SDK client.
 *
 * @returns {Stripe} Configured Stripe client.
 * @throws {Error} PAYMENTS_PROVIDER_MISCONFIGURED when live/test keys are absent.
 */
function getStripe() {
  const secret = process.env.PAYMENT_PROVIDER_STRIPE_SECRET;

  if (isPlaceholderSecret(secret)) {
    throw providerConfigError(
      'Stripe secret key is not configured. Set PAYMENT_PROVIDER_STRIPE_SECRET to a Stripe sk_test_ or sk_live_ key.'
    );
  }

  if (!/^sk_(test|live)_/.test(secret)) {
    throw providerConfigError(
      'Invalid Stripe secret key format. Use a Stripe key starting with sk_test_ or sk_live_.'
    );
  }

  if (!stripe) {
    try {
      Stripe = require('stripe');
      stripe = new Stripe(secret, {
        apiVersion: '2023-10-16',
        maxNetworkRetries: 2,
      });
    } catch (err) {
      throw providerConfigError(`Stripe SDK unavailable: ${err.message}`);
    }
  }

  return stripe;
}

function validateAmount(amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    const error = new Error('A valid positive payment amount is required.');
    error.code = 'INVALID_PAYMENT_AMOUNT';
    throw error;
  }
  return numericAmount;
}

function validateCurrency(currency) {
  const normalized = String(currency || 'usd').toLowerCase();
  if (!/^[a-z]{3}$/.test(normalized)) {
    const error = new Error('Payment currency must be a valid 3-letter ISO code.');
    error.code = 'INVALID_PAYMENT_CURRENCY';
    throw error;
  }
  return normalized;
}

/**
 * Create a real Stripe PaymentIntent.
 *
 * @param {Object} payload
 * @param {number} payload.amount - Amount in major unit (e.g. 10.00 USD).
 * @param {string} payload.currency - ISO currency code.
 * @param {string} payload.description - Payment description.
 * @param {string} payload.userId - User identifier.
 * @param {string} [payload.paymentMethod] - card | googlepay.
 * @param {string} [payload.transferType] - Optional transfer type.
 * @returns {Promise<Object>} { providerId, clientSecret, status }
 */
async function createPaymentIntent(payload = {}) {
  const s = getStripe();
  const amount = validateAmount(payload.amount);
  const currency = validateCurrency(payload.currency);
  const description = String(payload.description || 'VaultBank payment').slice(0, 255);
  const userId = String(payload.userId || 'unknown');
  const paymentMethod = String(payload.paymentMethod || 'card');

  const intent = await s.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    description,
    metadata: {
      vaultbankUserId: userId,
      vaultbankPaymentMethod: paymentMethod,
      vaultbankTransferType: payload.transferType || paymentMethod,
    },
    automatic_payment_methods: { enabled: true },
  });

  return {
    provider: 'stripe',
    providerId: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
    amount,
    currency,
    publishableKey: process.env.PAYMENT_PROVIDER_STRIPE_KEY,
    mock: false,
  };
}

/**
 * Verify Stripe webhook signature.
 *
 * @param {Object} req - Express request with rawBody or body.
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
  const s = getStripe();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    throw providerConfigError('Stripe webhook request missing stripe-signature header.');
  }

  if (isPlaceholderSecret(webhookSecret)) {
    throw providerConfigError(
      'Stripe webhook secret is not configured. Set STRIPE_WEBHOOK_SECRET to a whsec_ webhook signing secret.'
    );
  }

  try {
    const event = s.webhooks.constructEvent(req.rawBody || req.body, sig, webhookSecret);
    return { event, verified: true, mock: false };
  } catch (err) {
    const error = new Error(`Stripe webhook verification failed: ${err.message}`);
    error.code = 'PAYMENTS_WEBHOOK_VERIFICATION_FAILED';
    throw error;
  }
}

/**
 * Get PaymentIntent status from Stripe.
 *
 * @param {string} providerId - Stripe PaymentIntent ID.
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
  const s = getStripe();

  if (!providerId || !/^pi_/.test(providerId)) {
    const error = new Error('Invalid Stripe PaymentIntent ID.');
    error.code = 'INVALID_PAYMENT_PROVIDER_ID';
    throw error;
  }

  const intent = await s.paymentIntents.retrieve(providerId);
  return {
    status: intent.status,
    details: {
      amount: intent.amount / 100,
      currency: intent.currency,
      paymentMethod: intent.payment_method,
      charges: intent.charges?.data?.map((c) => ({
        id: c.id,
        status: c.status,
        receiptUrl: c.receipt_url,
      })),
    },
    mock: false,
  };
}

/**
 * Confirm a real Stripe PaymentIntent.
 * @param {string} providerId - Stripe PaymentIntent ID.
 * @param {Object} [paymentData] - Optional payment data for confirmation.
 * @returns {Object} Updated intent.
 */
async function confirmPayment(providerId, paymentData = {}) {
  const s = getStripe();
  const intent = await s.paymentIntents.confirm(providerId, paymentData);
  return {
    status: intent.status,
    ...intent,
  };
}

/**
 * Mock confirmation is intentionally disabled.
 * Stripe confirmations must come from the Stripe webhook or the client-side
 * Stripe Elements confirmation flow.
 *
 * @throws {Error} PAYMENTS_PROVIDER_MISCONFIGURED
 */
function confirmMockPayment(providerId) {
  throw providerConfigError(
    'Mock payment confirmation is disabled. Confirm payments through Stripe Elements and Stripe webhooks.'
  );
}

module.exports = {
  createPaymentIntent,
  verifyWebhook,
  getStatus,
  confirmPayment,
  confirmMockPayment,
  getStripe,
};