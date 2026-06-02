/**
 * VaultBank Payment Routes
 *
 * Unified payment API endpoints supporting multiple providers:
 *   - GET  /api/payments/methods       → List available payment methods
 *   - POST /api/payments/transfer      → Create a payment/transfer
 *   - GET  /api/payments/status/:id    → Check payment status
 *   - POST /api/payments/webhook/:provider → Provider webhook handler
 *   - POST /api/payments/confirm/:id   → Confirm mock/demo payment
 *   - GET  /api/payments/history       → Payment history
 *   - GET  /api/payments/wallet/balance → Wallet balance
 *
 * Legacy endpoints preserved for backward compatibility:
 *   - POST /api/payments/upi/initiate
 *   - POST /api/payments/paypal/initiate
 *   - POST /api/payments/stripe/initiate
 *   - POST /api/payments/paypal/success
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore } = require('../config/database');
const { logAudit } = require('../utils/audit');
const paymentProviders = require('../payments');
const stripeAdapter = require('../payments/stripe');
const razorpayAdapter = require('../payments/razorpay');
const paypalAdapter = require('../payments/paypal');
const upiAdapter = require('../payments/upi');
const walletAdapter = require('../payments/wallet');

const router = express.Router();

// ============================================================================
// UNIFIED PAYMENT API
// ============================================================================

/**
 * GET /api/payments/methods
 * List available payment methods based on currency/country
 */
router.get('/api/payments/methods', authenticateToken, (req, res) => {
    try {
        const { currency = 'USD', country = 'US' } = req.query;
        const methods = paymentProviders.getAvailableMethods({ currency, country });

        return res.status(200).json({
            success: true,
            methods
        });
    } catch (error) {
        console.error('Error fetching payment methods:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching payment methods.'
        });
    }
});

/**
 * POST /api/payments/transfer
 * Create a payment using the specified method
 * Body: { fromAccountId, to, amount, currency, method, metadata }
 */
router.post('/api/payments/transfer', authenticateToken, async (req, res) => {
    try {
        const {
            fromAccountId,
            to,
            amount,
            currency = 'USD',
            method = 'wallet',
            metadata = {}
        } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'A valid amount is required.'
            });
        }

        if (!method) {
            return res.status(400).json({
                success: false,
                message: 'Payment method is required.'
            });
        }

        // Build payload for provider adapter
        const payload = {
            amount: parseFloat(amount),
            currency: currency.toUpperCase(),
            description: metadata.note || metadata.description || `Payment via ${method}`,
            userId,
            fromAccountId,
            to: to || metadata.recipient,
            recipientAccount: to || metadata.recipientAccount,
            recipientName: metadata.recipientName,
            routingNumber: metadata.routingNumber,
            upiId: to || metadata.upiId,
            transferType: method,
            paymentMethod: method,
            receipt: metadata.receipt
        };

        // Create payment through the provider adapter
        const result = await paymentProviders.createPayment(method, payload);

        // Record audit log
        if (demoStore.auditLogs) {
            demoStore.auditLogs.push({
                id: uuidv4(),
                userId,
                action: `${method}_transfer_initiated`,
                category: 'financial',
                resourceId: result.providerId,
                details: JSON.stringify({
                    amount: payload.amount,
                    currency: payload.currency,
                    to: payload.to,
                    method
                }),
                timestamp: new Date().toISOString()
            });
        }

        await logAudit(userId, `payment_${method}`, 'payment');

        return res.status(200).json({
            success: true,
            status: result.status || 'pending',
            provider: result.provider || method,
            providerId: result.providerId,
            clientSecret: result.clientSecret,
            clientToken: result.clientSecret || result.keyId,
            redirectUrl: result.approvalUrl || result.redirectUrl,
            upiDeepLink: result.upiDeepLink,
            qrCode: result.qrCode,
            reference: result.reference || result.providerId,
            publishableKey: result.publishableKey || result.keyId,
            googlePayConfig: result.googlePayConfig,
            amount: result.amount || payload.amount,
            currency: result.currency || payload.currency,
            mock: result.mock || false,
            message: result.message || `Payment initiated via ${method}`
        });

    } catch (error) {
        console.error('Payment transfer error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error processing payment.'
        });
    }
});

/**
 * GET /api/payments/status/:id
 * Check payment status by provider ID
 */
router.get('/api/payments/status/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { method = 'stripe' } = req.query;

        const result = await paymentProviders.getPaymentStatus(method, id);

        return res.status(200).json({
            success: true,
            status: result.status,
            details: result.details,
            mock: result.mock || false
        });

    } catch (error) {
        console.error('Payment status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching payment status.'
        });
    }
});

/**
 * POST /api/payments/webhook/:provider
 * Handle provider webhooks (Stripe, Razorpay, PayPal, etc.)
 */
router.post('/api/payments/webhook/:provider', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const { provider } = req.params;

        // Parse body if it's a raw string
        if (typeof req.body === 'string') {
            try {
                req.body = JSON.parse(req.body);
            } catch (e) {
                // Body is already parsed or not JSON
            }
        }

        const result = await paymentProviders.verifyWebhook(provider, req);

        if (!result.verified) {
            console.error(`Webhook verification failed for ${provider}:`, result.error);
            return res.status(400).json({
                success: false,
                message: 'Webhook verification failed.'
            });
        }

        // Process webhook event
        const event = result.event;
        console.log(`[${provider}] Webhook event:`, event?.event_type || event?.type || event?.event || 'unknown');

        // Handle provider-specific events
        switch (provider) {
            case 'stripe':
                handleStripeEvent(event);
                break;
            case 'razorpay':
                handleRazorpayEvent(event);
                break;
            case 'paypal':
                handlePayPalEvent(event);
                break;
            default:
                console.log(`Unhandled provider webhook: ${provider}`);
        }

        return res.status(200).json({
            success: true,
            message: 'Webhook processed.',
            mock: result.mock || false
        });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing webhook.'
        });
    }
});

/**
 * POST /api/payments/confirm/:id
 * Confirm a mock payment (for demo/testing)
 */
router.post('/api/payments/confirm/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { method = 'stripe', paymentData } = req.body;

        let result;
        switch (method) {
            case 'stripe':
            case 'card':
            case 'googlepay':
                result = stripeAdapter.confirmMockPayment(id);
                break;
            case 'razorpay':
                result = razorpayAdapter.confirmMockPayment(id, paymentData?.paymentId);
                break;
            case 'upi':
                result = upiAdapter.confirmPayment(id, paymentData);
                break;
            case 'paypal':
                result = await paypalAdapter.capturePayment(id);
                break;
            default:
                result = { status: 'confirmed', id };
        }

        return res.status(200).json({
            success: true,
            status: result?.status || 'confirmed',
            details: result,
            mock: true
        });

    } catch (error) {
        console.error('Confirm payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error confirming payment.'
        });
    }
});

/**
 * GET /api/payments/wallet/balance
 * Get wallet balance for authenticated user
 */
router.get('/api/payments/wallet/balance', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const balance = walletAdapter.getBalance(userId);

        return res.status(200).json({
            success: true,
            ...balance
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error fetching balance.'
        });
    }
});

// ============================================================================
// LEGACY ENDPOINTS (backward compatibility)
// ============================================================================

/**
 * POST /api/payments/upi/initiate
 * Initiate a UPI payment (legacy endpoint)
 */
router.post('/api/payments/upi/initiate', authenticateToken, async (req, res) => {
    try {
        const { amount, upiId, description, currency } = req.body;
        const userId = req.user.id;

        if (!amount || !upiId) {
            return res.status(400).json({
                success: false,
                message: 'Amount and UPI ID are required.'
            });
        }

        const result = await upiAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            upiId,
            description: description || 'UPI Payment',
            userId,
            currency: currency || 'INR'
        });

        return res.status(200).json({
            success: true,
            message: 'UPI payment initiated. Opening UPI app...',
            data: {
                payment: result,
                upiDeepLink: result.upiDeepLink,
                reference: result.reference
            }
        });

    } catch (error) {
        console.error('UPI payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error initiating UPI payment.'
        });
    }
});

/**
 * POST /api/payments/paypal/initiate
 * Initiate a PayPal payment (legacy endpoint)
 */
router.post('/api/payments/paypal/initiate', authenticateToken, async (req, res) => {
    try {
        const { amount, currency, description } = req.body;
        const userId = req.user.id;

        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Amount is required.'
            });
        }

        const result = await paypalAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            description: description || 'PayPal Payment',
            userId
        });

        return res.status(200).json({
            success: true,
            message: 'PayPal payment initiated. Redirecting...',
            data: {
                payment: result,
                approvalUrl: result.approvalUrl,
                reference: result.providerId
            }
        });

    } catch (error) {
        console.error('PayPal payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error initiating PayPal payment.'
        });
    }
});

/**
 * POST /api/payments/stripe/initiate
 * Initiate a Stripe payment (legacy endpoint)
 */
router.post('/api/payments/stripe/initiate', authenticateToken, async (req, res) => {
    try {
        const { amount, currency, description } = req.body;
        const userId = req.user.id;

        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Amount is required.'
            });
        }

        const result = await stripeAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            description: description || 'Stripe Payment',
            userId
        });

        await logAudit(userId, 'payment_stripe', 'payment');

        return res.status(200).json({
            success: true,
            message: 'Stripe payment initiated.',
            data: {
                payment: result,
                checkoutUrl: result.clientSecret ? null : `https://checkout.stripe.com/pay/${result.providerId}`,
                reference: result.providerId
            }
        });

    } catch (error) {
        console.error('Stripe payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error initiating Stripe payment.'
        });
    }
});

/**
 * POST /api/payments/bank/initiate
 * Initiate a bank transfer (legacy endpoint)
 */
router.post('/api/payments/bank/initiate', authenticateToken, async (req, res) => {
    try {
        const bankAdapter = require('../payments/bank');
        const { amount, currency, description, recipientAccount, recipientName, routingNumber, transferType } = req.body;
        const userId = req.user.id;

        if (!amount || !recipientAccount) {
            return res.status(400).json({
                success: false,
                message: 'Amount and recipient account are required.'
            });
        }

        const result = await bankAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            description: description || 'Bank Transfer',
            recipientAccount,
            recipientName,
            routingNumber,
            transferType: transferType || 'ach',
            userId
        });

        return res.status(200).json({
            success: true,
            message: result.message,
            data: {
                payment: result,
                reference: result.reference
            }
        });

    } catch (error) {
        console.error('Bank transfer error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error initiating bank transfer.'
        });
    }
});

/**
 * POST /api/payments/paypal/success
 * Handle PayPal payment success callback (legacy endpoint)
 */
router.post('/api/payments/paypal/success', authenticateToken, async (req, res) => {
    try {
        const { paymentId } = req.body;

        if (paymentId) {
            const captureResult = await paypalAdapter.capturePayment(paymentId);
            return res.status(200).json({
                success: true,
                message: 'Payment completed successfully.',
                data: { paymentId, status: captureResult.status, captureId: captureResult.captureId }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Payment completed successfully.',
            data: { paymentId, status: 'completed' }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error processing payment.' });
    }
});

/**
 * GET /api/payments/history
 * Get payment history for authenticated user
 */
router.get('/api/payments/history', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        // Get payment-related audit logs
        const paymentLogs = demoStore.auditLogs.filter(l =>
            l.userId === userId &&
            (l.action.includes('payment') || l.action.includes('transfer'))
        );

        // Also get wallet transfers
        const walletHistory = walletAdapter.getHistory(userId);

        return res.status(200).json({
            success: true,
            data: {
                payments: paymentLogs,
                transfers: walletHistory
            },
            count: paymentLogs.length + walletHistory.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching payment history.' });
    }
});

// ============================================================================
// WEBHOOK EVENT HANDLERS
// ============================================================================

function handleStripeEvent(event) {
    const eventType = event.type;
    switch (eventType) {
        case 'payment_intent.succeeded':
            console.log('[Stripe] Payment succeeded:', event.data?.object?.id);
            break;
        case 'payment_intent.payment_failed':
            console.log('[Stripe] Payment failed:', event.data?.object?.id);
            break;
        case 'charge.refunded':
            console.log('[Stripe] Charge refunded:', event.data?.object?.id);
            break;
        default:
            console.log('[Stripe] Unhandled event:', eventType);
    }
}

function handleRazorpayEvent(event) {
    const eventType = event.event;
    switch (eventType) {
        case 'payment.captured':
            console.log('[Razorpay] Payment captured:', event.payload?.payment?.entity?.id);
            break;
        case 'payment.failed':
            console.log('[Razorpay] Payment failed:', event.payload?.payment?.entity?.id);
            break;
        default:
            console.log('[Razorpay] Unhandled event:', eventType);
    }
}

function handlePayPalEvent(event) {
    const eventType = event.event_type;
    switch (eventType) {
        case 'PAYMENT.CAPTURE.COMPLETED':
            console.log('[PayPal] Capture completed:', event.resource?.id);
            break;
        case 'PAYMENT.CAPTURE.DENIED':
            console.log('[PayPal] Capture denied:', event.resource?.id);
            break;
        default:
            console.log('[PayPal] Unhandled event:', eventType);
    }
}

module.exports = router;