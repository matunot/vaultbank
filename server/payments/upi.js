/**
 * UPI Payment Adapter
 *
 * Handles UPI payments for India.
 * Generates UPI deep links for mobile apps and integrates with
 * Razorpay for UPI collect requests when configured.
 *
 * Environment variables:
 *   PAYMENT_PROVIDER_UPI_PROVIDER - UPI PSP provider (razorpay | direct)
 *   PAYMENT_PROVIDER_RAZORPAY_KEY - Razorpay key for UPI via Razorpay
 */

const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');

// In-memory store for UPI payments
const upiPayments = new Map();

// UPI PSP handle mapping
const UPI_HANDLES = [
    '@oksbi', '@okaxis', '@okhdfcbank', '@okicici',
    '@ybl', '@ibl', '@axl', '@hdfcbank'
];

/**
 * Create a UPI payment intent
 * @param {Object} payload
 * @param {number} payload.amount - Amount in INR
 * @param {string} payload.upiId - Recipient UPI ID (optional for QR)
 * @param {string} payload.description - Payment description
 * @param {string} payload.userId - User identifier
 * @param {string} payload.currency - Currency (default: INR)
 * @param {string} payload.merchantUpiId - Merchant VPA for collection
 * @returns {Promise<Object>} { providerId, upiDeepLink, qrCode, status }
 */
async function createPaymentIntent(payload) {
    const {
        amount,
        upiId,
        description = 'VaultBank Payment',
        userId,
        currency = 'INR',
        merchantUpiId = 'vaultbank@oksbi'
    } = payload;

    const paymentRef = `VB-UPI-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const txnId = `TXN${Date.now()}${Math.floor(Math.random() * 10000)}`;

    // Build UPI deep link
    const params = new URLSearchParams({
        pa: upiId || merchantUpiId,  // Payee VPA
        pn: 'VaultBank',              // Payee name
        mc: '0000',                   // Merchant category code
        tid: txnId,                   // Transaction ID
        tr: paymentRef,               // Transaction reference
        tn: description,              // Transaction note
        am: amount.toFixed(2),        // Amount
        cu: currency,                 // Currency
        url: `https://vaultbank.vercel.app/payments/verify?ref=${paymentRef}`
    });

    const upiDeepLink = `upi://pay?${params.toString()}`;

    // Generate QR code data URL
    let qrCodeDataUrl = null;
    try {
        qrCodeDataUrl = await qrcode.toDataURL(upiDeepLink, {
            width: 256,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });
    } catch (err) {
        console.warn('QR code generation failed:', err.message);
    }

    const payment = {
        id: paymentRef,
        provider: 'upi',
        type: 'upi',
        amount: parseFloat(amount),
        currency,
        upiId: upiId || merchantUpiId,
        description,
        userId,
        reference: paymentRef,
        txnId,
        upiDeepLink,
        qrCode: qrCodeDataUrl,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    upiPayments.set(paymentRef, payment);

    return {
        provider: 'upi',
        providerId: paymentRef,
        upiDeepLink,
        qrCode: qrCodeDataUrl,
        reference: paymentRef,
        status: 'pending',
        amount,
        currency,
        validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 min expiry
    };
}

/**
 * Verify UPI payment status
 * In production, this would check with the PSP or UPI callback
 * @param {string} providerId - Payment reference ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const payment = upiPayments.get(providerId);
    if (!payment) {
        return { status: 'not_found', details: null };
    }

    // Check if payment has expired
    const validUntil = new Date(payment.validUntil || new Date(Date.now() + 15 * 60 * 1000));
    if (new Date() > validUntil && payment.status === 'pending') {
        payment.status = 'expired';
        upiPayments.set(providerId, payment);
    }

    return {
        status: payment.status,
        details: payment
    };
}

/**
 * Confirm UPI payment (simulate callback from PSP)
 * @param {string} providerId - Payment reference
 * @param {Object} callbackData - UPI callback data
 * @returns {Object} Updated payment
 */
function confirmPayment(providerId, callbackData = {}) {
    const payment = upiPayments.get(providerId);
    if (!payment) return null;

    payment.status = 'completed';
    payment.completedAt = new Date().toISOString();
    payment.upiTxnId = callbackData.txnId || `UTIBRN${Date.now()}`;
    payment.upiResponseCode = callbackData.responseCode || '000';
    payment.upiApprovalRef = callbackData.approvalRef || uuidv4().slice(0, 12);

    upiPayments.set(providerId, payment);
    return payment;
}

/**
 * Webhook handler for UPI payment notifications
 * @param {Object} req - Express request
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // In production, verify the PSP signature
    return {
        event,
        verified: true,
        mock: true
    };
}

/**
 * Validate UPI ID format
 * @param {string} upiId - UPI ID to validate
 * @returns {boolean} Whether the UPI ID is valid
 */
function validateUpiId(upiId) {
    if (!upiId) return false;
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,49}@[a-zA-Z]{2,}$/;
    return upiRegex.test(upiId);
}

module.exports = {
    createPaymentIntent,
    getStatus,
    confirmPayment,
    verifyWebhook,
    validateUpiId,
    UPI_HANDLES
};