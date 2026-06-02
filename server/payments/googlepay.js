/**
 * Google Pay Payment Adapter
 *
 * Google Pay on web is processed through Stripe's Payment Intents API
 * with a Google Pay payment method. This adapter wraps the Stripe adapter
 * and provides Google Pay-specific configuration.
 *
 * Environment variables:
 *   PAYMENT_PROVIDER_GOOGLEPAY_MERCHANT_ID - Google Pay Merchant ID
 *   PAYMENT_PROVIDER_STRIPE_KEY           - Stripe publishable key (for Google Pay)
 *   PAYMENT_PROVIDER_STRIPE_SECRET        - Stripe secret key
 */

const stripeAdapter = require('./stripe');

// Google Pay configuration
const GOOGLE_PAY_CONFIG = {
    environment: process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'TEST',
    merchantId: process.env.PAYMENT_PROVIDER_GOOGLEPAY_MERCHANT_ID || '',
    merchantName: 'VaultBank',
    allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
    allowedPaymentMethods: ['CARD', 'TOKENIZED_CARD'],
    gateway: 'stripe',
    gatewayMerchantId: process.env.PAYMENT_PROVIDER_STRIPE_KEY || ''
};

// In-memory store for Google Pay payment data
const googlePayIntents = new Map();

/**
 * Get Google Pay configuration for client
 * @returns {Object} Google Pay configuration
 */
function getConfig() {
    return {
        environment: GOOGLE_PAY_CONFIG.environment,
        merchantId: GOOGLE_PAY_CONFIG.merchantId,
        merchantName: GOOGLE_PAY_CONFIG.merchantName,
        allowedCardNetworks: GOOGLE_PAY_CONFIG.allowedCardNetworks,
        allowedPaymentMethods: GOOGLE_PAY_CONFIG.allowedPaymentMethods,
        gateway: GOOGLE_PAY_CONFIG.gateway,
        stripePublishableKey: process.env.PAYMENT_PROVIDER_STRIPE_KEY || 'pk_test_mock'
    };
}

/**
 * Create a Google Pay payment intent (via Stripe)
 * @param {Object} payload
 * @param {number} payload.amount - Amount
 * @param {string} payload.currency - ISO currency code
 * @param {string} payload.description - Payment description
 * @param {string} payload.userId - User identifier
 * @returns {Promise<Object>} { providerId, clientSecret, googlePayConfig }
 */
async function createPaymentIntent(payload) {
    const { amount, currency = 'USD', description, userId } = payload;

    // Create payment intent through Stripe with Google Pay payment method type
    const stripeResult = await stripeAdapter.createPaymentIntent({
        amount,
        currency,
        description,
        userId,
        paymentMethod: 'googlepay'
    });

    // Store the intent with Google Pay metadata
    const gpayIntent = {
        ...stripeResult,
        id: stripeResult.providerId,
        googlePayConfig: getConfig(),
        createdAt: new Date().toISOString()
    };

    googlePayIntents.set(stripeResult.providerId, gpayIntent);

    return {
        provider: 'googlepay',
        providerId: stripeResult.providerId,
        clientSecret: stripeResult.clientSecret,
        status: stripeResult.status,
        amount,
        currency,
        googlePayConfig: getConfig(),
        stripePublishableKey: stripeResult.publishableKey,
        // Google Pay button options for frontend
        buttonOptions: {
            buttonColor: 'black',
            buttonType: 'pay',
            buttonSizeMode: 'fill'
        },
        mock: stripeResult.mock
    };
}

/**
 * Verify webhook (delegates to Stripe)
 * @param {Object} req - Express request
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
    return stripeAdapter.verifyWebhook(req);
}

/**
 * Get payment status (delegates to Stripe)
 * @param {string} providerId - Payment intent ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const result = await stripeAdapter.getStatus(providerId);
    const gpayIntent = googlePayIntents.get(providerId);

    return {
        ...result,
        provider: 'googlepay',
        googlePayIntent: gpayIntent || null
    };
}

/**
 * Generate Google Pay token request data for frontend
 * @param {Object} paymentData - { amount, currency }
 * @returns {Object} Token request data for Google Pay API
 */
function getTokenRequestData(paymentData) {
    const { amount, currency = 'USD' } = paymentData;

    return {
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [
            {
                type: 'CARD',
                parameters: {
                    allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
                    allowedCardNetworks: GOOGLE_PAY_CONFIG.allowedCardNetworks
                },
                tokenizationSpecification: {
                    type: 'PAYMENT_GATEWAY',
                    parameters: {
                        gateway: GOOGLE_PAY_CONFIG.gateway,
                        gatewayMerchantId: GOOGLE_PAY_CONFIG.gatewayMerchantId
                    }
                }
            }
        ],
        merchantInfo: {
            merchantId: GOOGLE_PAY_CONFIG.merchantId,
            merchantName: GOOGLE_PAY_CONFIG.merchantName
        },
        transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: amount.toFixed(2),
            currencyCode: currency,
            countryCode: 'US'
        }
    };
}

module.exports = {
    createPaymentIntent,
    verifyWebhook,
    getStatus,
    getConfig,
    getTokenRequestData
};