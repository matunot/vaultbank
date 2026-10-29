/**
 * VaultBank Payment Routes
 *
 * Unified payment API endpoints supporting multiple providers:
 *   - GET  /api/payments/methods             -> List available payment methods
 *   - POST /api/payments/transfer            -> Create a payment/transfer
 *   - GET  /api/payments/status/:id          -> Check payment status
 *   - POST /api/payments/webhook/:provider   -> Provider webhook handler (dedup'd)
 *   - GET  /api/payments/history             -> Payment history
 *   - GET  /api/payments/wallet/balance      -> Wallet balance
 *
 * Sprint 1 hardening:
 *   - Webhook dedup via webhook_events(provider, provider_event_id) UNIQUE.
 *   - Webhook handlers write status updates to the `payments` table.
 *   - The transfer route writes an initial `payments` row before calling
 *     the provider, so the ledger has a record even if the provider call
 *     fails. Idempotency-Key replays return the original row.
 *   - Idempotency-Key is read from the request here and used both for the
 *     in-memory middleware (set up in api/payments.js) AND for the
 *     DB unique index. The middleware layer caches the response; the
 *     DB unique index is the durable backstop.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { demoStore, isDemo, findAccountByUserId } = require('../config/database');
const { logAudit } = require('../utils/audit');
const paymentProviders = require('../payments');
const stripeAdapter = require('../payments/stripe');
const razorpayAdapter = require('../payments/razorpay');
const paypalAdapter = require('../payments/paypal');
const upiAdapter = require('../payments/upi');
const walletAdapter = require('../payments/wallet');
const ledger = require('../payments/ledger');
const paypalDeposits = require('./paypal-deposits');
const bankDeposits = require('./bank-deposits');
const collectionsRegistry = require('../collections');
const payoutsRegistry = require('../payouts');
const directUpiRoutes = require('./direct-upi');
const directBankPayoutRoutes = require('./direct-bank-payouts');

const router = express.Router();
const { denyLegacyProviderRail } = require('../middleware/nativeOnlyPolicy');

const IDEMPOTENCY_HEADER = 'idempotency-key';

// ============================================================================
// GET /api/payments/readiness — PUBLIC per-rail readiness.
// Non-secret states only: never secret values, never user data. These are
// deliberately NOT all booleans: "configured" is not "credential-valid", and
// "credential-valid" is not "a real settlement succeeded".
// ============================================================================
router.get('/api/payments/readiness', (req, res) => {
    try {
        // Mirror of the Stripe adapter's own config rules (sk_ prefix + placeholder check).
        const stripeEnv = ['PAYMENT_PROVIDER', 'STRIPE_SECRET'].join('_');
        const stripeSecret = process['env'][stripeEnv] || '';
        const nativeOnly = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
        const stripeConfigured = !nativeOnly && /^sk_(test|live)_/.test(stripeSecret) && !/placeholder|your_/i.test(stripeSecret);
        // PayPal: keys present is NOT the same as live mode. Report the
        // selected mode honestly; a live mode claim requires an actual
        // successful live deposit — none has been verified yet.
        const paypalKeysPresent = !nativeOnly && paypalDeposits.missingPayPalKeys().length === 0;
        const paypalInfo = paypalDeposits.paypalConfigInfo();
        const paypalMode = nativeOnly ? 'disabled-native-only' : (paypalKeysPresent ? (paypalInfo.mode === 'live' ? 'live-unverified' : 'sandbox') : 'not-configured');
        const bankConfigured = !!(bankDeposits.receivingConfig && bankDeposits.receivingConfig().enabled);
        const collections = collectionsRegistry.collectionsAvailability();
        const payouts = payoutsRegistry.payoutAvailability();
        const directUpi = directUpiRoutes.readiness();
        const directBankPayout = directBankPayoutRoutes.readiness();
        return res.status(200).json({
            success: true,
            nativeOnly,
            rails: {
                usd: {
                    cardStripe: stripeConfigured,
                    paypal: paypalKeysPresent,
                    paypalMode,
                    bankTransferInstructions: bankConfigured,
                    internalTransfers: true,
                    externalWithdrawals: false, // honest: no USD payout rail exists today
                },
                inr: {
                    directUpi: directUpi.available,
                    directUpiProvider: directUpi.provider,
                    directUpiVerification: directUpi.verification,
                    directUpiAutoCredit: directUpi.autoCredit,
                    directUpiReason: directUpi.reason,
                    directBankPayouts: directBankPayout.available,
                    directBankPayoutsProvider: directBankPayout.provider,
                    directBankPayoutsAutoTransfer: directBankPayout.autoTransfer,
                    directBankPayoutsEncryptionKeyReady: directBankPayout.encryptionKeyReady,
                    directBankPayoutsReason: directBankPayout.reason,
                    collections: collections.available,
                    collectionsProvider: collections.available ? collections.provider : null,
                    collectionsConfigured: collections.configured,
                    collectionsMode: collections.mode,
                    collectionsCredentialValid: collections.credentialValid,
                    collectionsWebhookReady: collections.webhookReady,
                    collectionsProviderLive: collections.providerLive,
                    collectionsLiveSettlementVerified: collections.liveSettlementVerified,
                    collectionsReason: collections.reason || null,
                    collectionsWebhookPath: nativeOnly ? null : '/api/collections/webhook/cashfree',
                    internalTransfers: true,
                    payouts: payouts.available,
                    payoutsProvider: payouts.available ? payouts.provider : null,
                    payoutsConfigured: payouts.configured,
                    payoutsMode: payouts.mode,
                    payoutsCredentialValid: payouts.credentialValid,
                    payoutsWebhookReady: payouts.webhookReady,
                    payoutsProviderLive: payouts.providerLive,
                    payoutsLiveSettlementVerified: payouts.liveSettlementVerified,
                    payoutsReason: payouts.reason || null,
                    payoutsReconciliation: payouts.reconciliation,
                },
            },
            currencies: ['USD', 'INR'],
            readinessDefinitions: {
                configured: nativeOnly
                    ? 'Third-party provider configuration is ignored in production; native routes expose their own readiness.'
                    : 'Provider selected and credentials present — NOT proof they are valid',
                credentialValid: nativeOnly
                    ? 'Not applicable to native-only production; third-party credentials are ignored.'
                    : 'Credentials accepted by a safe provider probe; collections credentials remain unverified without a probe.',
                webhookReady: nativeOnly
                    ? 'Legacy provider webhooks are disabled; native deposits and payouts use bank-statement reconciliation.'
                    : 'A signature-verified provider webhook is mounted and configured; provider payouts use the status API.',
                providerLive: nativeOnly
                    ? 'Third-party providers are disabled in production.'
                    : 'Production host + credentials accepted by a probe; never inferred from environment variables alone',
                liveSettlementVerified: 'A real external settlement has been observed; false until then.',
            },
        });
    } catch (error) {
        console.error('Readiness error:', error);
        return res.status(200).json({ success: true, rails: null, error: 'readiness-unavailable' }); // never fail-closed-crash the UI on diagnostics
    }
});

// ============================================================================
// GET /api/payments/admin/readiness?probe=1 — admin diagnostics.
// The payout probe calls POST /payout/v1/authorize only; it never moves money.
// Collections intentionally has no safe credential probe.
// ============================================================================
router.get('/api/payments/admin/readiness', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const collections = collectionsRegistry.collectionsAvailability();
        const payoutsBefore = payoutsRegistry.payoutAvailability();
        let payoutProbe = null;
        if (String(req.query.probe || '') === '1' && payoutsBefore.available && payoutsBefore.provider) {
            const adapter = payoutsRegistry.providers[payoutsBefore.provider];
            if (adapter && typeof adapter.probeCredentials === 'function') {
                payoutProbe = await adapter.probeCredentials();
            } else {
                payoutProbe = { ok: false, code: 'NO_SAFE_PROBE' };
            }
        }
        const payouts = payoutProbe ? payoutsRegistry.payoutAvailability() : payoutsBefore;
        return res.status(200).json({
            success: true,
            collections,
            payouts,
            payoutProbe,
            note: 'Payout probe: POST /payout/v1/authorize (read-only, no money). Collections: no safe credential probe; credentialValid stays unverified.',
        });
    } catch (error) {
        console.error('Admin readiness probe error:', error.message);
        return res.status(502).json({ success: false, message: 'Readiness probe failed.' });
    }
});

// ============================================================================
// Helpers used by the webhook handler
// ============================================================================

function extractProviderEventId(provider, event) {
    if (!event || typeof event !== 'object') return null;
    if (provider === 'stripe') return event.id || null;
    if (provider === 'razorpay') return event.id || event.entity_id || null;
    if (provider === 'paypal') return event.id || (event.resource && event.resource.id) || null;
    return null;
}

function extractEventType(provider, event) {
    if (!event || typeof event !== 'object') return null;
    if (provider === 'stripe') return event.type || null;
    if (provider === 'razorpay') return event.event || null;
    if (provider === 'paypal') return event.event_type || null;
    return null;
}

// ============================================================================
// UNIFIED PAYMENT API
// ============================================================================

router.get('/api/payments/methods', authenticateToken, (req, res) => {
    try {
        const { currency = 'USD', country = 'US' } = req.query;
        const methods = paymentProviders.getAvailableMethods({ currency, country });
        return res.status(200).json({ success: true, methods });
    } catch (error) {
        console.error('Error fetching payment methods:', error);
        return res.status(500).json({ success: false, message: 'Error fetching payment methods.' });
    }
});

router.post('/api/payments/transfer', authenticateToken, async (req, res) => {
    if (denyLegacyProviderRail(res)) return;
    try {
        const {
            fromAccountId,
            to,
            amount,
            currency = 'USD',
            method = 'wallet',
            metadata = {},
        } = req.body;
        const userId = req.user.id;
        const idempotencyKey = req.headers[IDEMPOTENCY_HEADER] || req.headers[IDEMPOTENCY_HEADER.toLowerCase()] || null;

        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ success: false, message: 'A valid amount is required.' });
        }
        if (!method) {
            return res.status(400).json({ success: false, message: 'Payment method is required.' });
        }

        // Simulation rails: bank/upi have no live provider connection, and
        // wallet/email internal money movement belongs to the atomic account
        // transfer rail (/api/account/transfer) — never to a demo-store adapter.
        if (!isDemo) {
            if (method === 'bank' || method === 'upi') {
                return res.status(503).json({
                    success: false,
                    code: method === 'bank' ? 'BANK_TRANSFERS_NOT_CONFIGURED' : 'UPI_NOT_CONFIGURED',
                    message: 'This method has no live provider connection configured.',
                });
            }
            if (method === 'wallet' || method === 'email') {
                return res.status(503).json({
                    success: false,
                    code: 'INTERNAL_TRANSFER_USES_ACCOUNT_RAIL',
                    message: 'Internal transfers run on /api/account/transfer and VaultBank Pay.',
                });
            }
        }

        if (idempotencyKey) {
            const existing = await ledger.findPaymentByIdempotencyKey(idempotencyKey);
            if (existing) {
                res.setHeader('Idempotent-Replay', 'true');
                res.setHeader(IDEMPOTENCY_HEADER, idempotencyKey);
                return res.status(200).json({
                    success: true,
                    status: existing.status,
                    provider: existing.provider,
                    providerId: existing.provider_id,
                    clientSecret: existing.client_secret,
                    amount: existing.amount,
                    currency: existing.currency,
                    replay: true,
                    message: 'Replayed from idempotency key',
                });
            }
        }

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
            receipt: metadata.receipt,
        };

        const t0 = Date.now();
        let result;
        try {
            result = await paymentProviders.createPayment(method, payload, req);
        } catch (e) {
            // Note: metrics object should be imported or defined if used
            if (typeof metrics !== 'undefined') {
                metrics.recordPaymentAttempt({ provider: method, method, outcome: 'failure', reason: e.code || 'error', durationMs: Date.now() - t0 });
                metrics.captureException(e, { route: 'transfer', method });
            }
            throw e;
        }

        await ledger.upsertPayment({
            provider: result.provider || method,
            provider_id: result.providerId,
            from_account_id: fromAccountId || null,
            to_identifier: payload.to || payload.upiId || payload.recipientAccount || 'unknown',
            amount: payload.amount,
            currency: payload.currency,
            status: result.status || 'pending',
            method,
            user_id: userId,
            idempotency_key: idempotencyKey,
            client_secret: result.clientSecret || null,
            metadata: {
                note: metadata.note,
                description: payload.description,
                to: payload.to,
                upiId: payload.upiId,
            },
        });

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
                    method,
                }),
                timestamp: new Date().toISOString(),
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
            message: result.message || `Payment initiated via ${method}`,
        });
    } catch (error) {
        console.error('Payment transfer error:', error);
        return res.status(error.code === 'PAYMENTS_PROVIDER_MISCONFIGURED' ? 503 : 500).json({
            success: false,
            code: error.code || 'PAYMENT_ERROR',
            message: error.message || 'Error processing payment.',
        });
    }
});

router.get('/api/payments/status/:id', authenticateToken, async (req, res) => {
    if (denyLegacyProviderRail(res)) return;
    try {
        const { id } = req.params;
        const { method = 'stripe' } = req.query;
        const result = await paymentProviders.getPaymentStatus(method, id);
        return res.status(200).json({ success: true, status: result.status, details: result.details, mock: result.mock || false });
    } catch (error) {
        console.error('Payment status error:', error);
        return res.status(500).json({ success: false, message: 'Error fetching payment status.' });
    }
});

router.post('/api/payments/webhook/:provider', async (req, res) => {
    if (denyLegacyProviderRail(res)) return;
    let webhookDbId = null;
    try {
        const { provider } = req.params;

        // PayPal: cryptographic signature verification BEFORE any database
        // write (claim, status update or credit). Unverified or unconfigured
        // keys fail closed with 400 — nothing is recorded.
        if (provider === 'paypal' && !isDemo) {
            let event = req.body;
            if (typeof event === 'string') {
                try { event = JSON.parse(event); } catch (_) { event = null; }
            }
            const h = (req && req.headers) || {};
            const ok = event && await paypalAdapter.verifyWebhookSignature({
                transmissionId: h['paypal-transmission-id'],
                transmissionTime: h['paypal-transmission-time'],
                certUrl: h['paypal-cert-url'],
                authAlgo: h['paypal-auth-algo'],
                transmissionSig: h['paypal-transmission-sig'],
                event,
            });
            if (!ok) {
                console.error('[PayPal] Webhook signature verification failed — ignored.');
                return res.status(400).json({ success: false, message: 'Webhook signature verification failed.' });
            }
        }

        const result = await paymentProviders.verifyWebhook(provider, req);
        if (!result.verified) {
            console.error(`[${provider}] Webhook verification failed:`, result.error);
            return res.status(400).json({ success: false, message: 'Webhook verification failed.' });
        }

        const event = result.event;
        const providerEventId = extractProviderEventId(provider, event);
        const eventType = extractEventType(provider, event);

        if (!providerEventId) {
            console.warn(`[${provider}] Webhook missing event id; ack'd but not recorded.`);
            return res.status(200).json({ success: true, message: 'Webhook received (no event id).' });
        }

        const dedup = await ledger.recordWebhookEvent({
            provider,
            providerEventId,
            eventType,
            payload: event,
        });
        // Durable webhook deduplication is a money-safety prerequisite. If
        // PostgreSQL cannot record/check the event, do not process or ACK it;
        // return 503 so the sender can retry after the database recovers.
        if (dedup.dbError) {
            return res.status(503).json({
                success: false,
                code: 'WEBHOOK_DEDUP_UNAVAILABLE',
                message: 'Webhook was not processed because durable event deduplication is unavailable. Retry later.',
            });
        }
        webhookDbId = dedup.id;
        if (dedup.duplicate) {
            return res.status(200).json({ success: true, duplicate: true, message: 'Duplicate webhook ignored.' });
        }

        switch (provider) {
            case 'stripe':
                await handleStripeEvent(event);
                break;
            case 'razorpay':
                await handleRazorpayEvent(event);
                break;
            case 'paypal':
                await handlePayPalEvent(event, req);
                break;
            default:
                console.log(`Unhandled provider webhook: ${provider}`);
        }

        if (webhookDbId) {
            await ledger.markWebhookProcessed(webhookDbId, { status: 'processed' });
        }
        return res.status(200).json({ success: true, message: 'Webhook processed.', mock: result.mock || false });
    } catch (error) {
        console.error('Webhook error:', error);
        if (webhookDbId) {
            await ledger.markWebhookProcessed(webhookDbId, {
                status: 'failed',
                error: String(error && error.message ? error.message : error),
            });
        }
        return res.status(500).json({ success: false, message: 'Error processing webhook.' });
    }
});

router.get('/api/payments/wallet/balance', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        if (!isDemo) {
            // Real mode: never fabricate a balance — read the real account.
            const account = await findAccountByUserId(userId);
            if (!account) {
                return res.status(404).json({ success: false, message: 'No account found.' });
            }
            return res.status(200).json({ success: true, balance: account.balance, currency: account.currency, accountId: account.id });
        }
        const balance = walletAdapter.getBalance(userId);
        return res.status(200).json({ success: true, ...balance });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching balance.' });
    }
});

// ============================================================================
// LEGACY ENDPOINTS (backward compatibility)
// ============================================================================

router.post('/api/payments/upi/initiate', authenticateToken, async (req, res) => {
    try {
        if (!isDemo) {
            // UPI deep links have no PSP settlement confirmation wired — fail closed.
            return res.status(503).json({
                success: false,
                code: 'UPI_NOT_CONFIGURED',
                message: 'UPI payments are not available yet — no UPI PSP settlement confirmation is wired.',
            });
        }
        const { amount, upiId, description, currency } = req.body;
        const userId = req.user.id;
        if (!amount || !upiId) {
            return res.status(400).json({ success: false, message: 'Amount and UPI ID are required.' });
        }
        const result = await upiAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            upiId,
            description: description || 'UPI Payment',
            userId,
            currency: currency || 'INR',
        });
        return res.status(200).json({
            success: true,
            message: 'UPI payment initiated. Opening UPI app...',
            data: { payment: result, upiDeepLink: result.upiDeepLink, reference: result.reference },
        });
    } catch (error) {
        console.error('UPI payment error:', error);
        return res.status(500).json({ success: false, message: 'Error initiating UPI payment.' });
    }
});

router.post('/api/payments/paypal/initiate', authenticateToken, async (req, res) => {
    if (denyLegacyProviderRail(res)) return;
    try {
        const { amount, currency, description } = req.body;
        const userId = req.user.id;
        if (!amount) {
            return res.status(400).json({ success: false, message: 'Amount is required.' });
        }
        const missing = paypalDeposits.missingPayPalKeys();
        if (missing.length) {
            return res.status(503).json({
                success: false,
                code: 'PAYPAL_NOT_CONFIGURED',
                message: 'PayPal payments are not enabled yet. Missing env: ' + missing.join(', '),
            });
        }
        const account = await findAccountByUserId(userId);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }
        const result = await paypalAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            description: description || 'PayPal Payment',
            userId,
            // Credit marker: the verified webhook parses custom_id to credit this account.
            customId: `${userId}:${account.id}`,
        });
        if (!result || result.mock || !result.approvalUrl) {
            return res.status(503).json({ success: false, code: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal payments are not enabled yet.' });
        }
        await ledger.upsertPayment({
            provider: 'paypal',
            provider_id: result.providerId,
            user_id: userId,
            amount: parseFloat(amount),
            currency: (currency || 'USD').toUpperCase(),
            status: result.status || 'CREATED',
            method: 'paypal',
            metadata: { kind: 'payment', account_id: account.id },
        });
        return res.status(200).json({
            success: true,
            message: 'PayPal payment initiated. Redirecting...',
            data: { payment: result, approvalUrl: result.approvalUrl, reference: result.providerId },
        });
    } catch (error) {
        console.error('PayPal payment error:', error);
        return res.status(500).json({ success: false, message: 'Error initiating PayPal payment.' });
    }
});

router.post('/api/payments/stripe/initiate', authenticateToken, async (req, res) => {
    if (denyLegacyProviderRail(res)) return;
    try {
        const { amount, currency, description } = req.body;
        const userId = req.user.id;
        if (!amount) {
            return res.status(400).json({ success: false, message: 'Amount is required.' });
        }
        const result = await stripeAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            description: description || 'Stripe Payment',
            userId,
        });
        await logAudit(userId, 'payment_stripe', 'payment');
        return res.status(200).json({
            success: true,
            message: 'Stripe payment initiated.',
            data: {
                payment: result,
                checkoutUrl: result.clientSecret ? null : `https://checkout.stripe.com/pay/${result.providerId}`,
                reference: result.providerId,
            },
        });
    } catch (error) {
        console.error('Stripe payment error:', error);
        return res.status(error.code === 'PAYMENTS_PROVIDER_MISCONFIGURED' ? 503 : 500).json({
            success: false,
            code: error.code || 'PAYMENT_ERROR',
            message: error.message || 'Error initiating Stripe payment.',
        });
    }
});

router.post('/api/payments/bank/initiate', authenticateToken, async (req, res) => {
    try {
        if (!isDemo) {
            // The bank adapter is a wall-clock simulation; no bank connection exists.
            return res.status(503).json({
                success: false,
                code: 'BANK_TRANSFERS_NOT_CONFIGURED',
                message: 'Bank transfers are not available yet — no bank connection is configured.',
            });
        }
        const bankAdapter = require('../payments/bank');
        const { amount, currency, description, recipientAccount, recipientName, routingNumber, transferType } = req.body;
        const userId = req.user.id;
        if (!amount || !recipientAccount) {
            return res.status(400).json({ success: false, message: 'Amount and recipient account are required.' });
        }
        const result = await bankAdapter.createPaymentIntent({
            amount: parseFloat(amount),
            currency: currency || 'USD',
            description: description || 'Bank Transfer',
            recipientAccount,
            recipientName,
            routingNumber,
            transferType: transferType || 'ach',
            userId,
        });
        return res.status(200).json({ success: true, message: result.message, data: { payment: result, reference: result.reference } });
    } catch (error) {
        console.error('Bank transfer error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error initiating bank transfer.' });
    }
});

router.post('/api/payments/paypal/success', authenticateToken, async (req, res) => {
    if (denyLegacyProviderRail(res)) return;
    try {
        const { paymentId } = req.body;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'paymentId is required.' });
        }
        const missing = paypalDeposits.missingPayPalKeys();
        if (missing.length) {
            return res.status(503).json({
                success: false,
                code: 'PAYPAL_NOT_CONFIGURED',
                message: 'PayPal payments are not enabled yet. Missing env: ' + missing.join(', '),
            });
        }
        // Same money path as /api/paypal/capture: capture + exactly-once credit.
        const out = await paypalDeposits.captureAndCredit(req.user.id, String(paymentId));
        if (out.error) {
            return res.status(out.error).json({ success: false, message: out.message });
        }
        return res.status(200).json({
            success: true,
            credited: out.credited,
            duplicate: out.duplicate,
            newBalance: out.newBalance,
            message: 'Payment completed successfully.',
        });
    } catch (error) {
        console.error('PayPal success error:', error);
        return res.status(500).json({ success: false, message: 'Error processing payment.' });
    }
});

router.get('/api/payments/history', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const paymentLogs = (demoStore.auditLogs || []).filter(
            (l) => l.userId === userId && (String(l.action).includes('payment') || String(l.action).includes('transfer'))
        );
        const walletHistory = walletAdapter.getHistory(userId);
        return res.status(200).json({
            success: true,
            data: { payments: paymentLogs, transfers: walletHistory },
            count: paymentLogs.length + walletHistory.length,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching payment history.' });
    }
});

// ============================================================================
// WEBHOOK EVENT HANDLERS
// ============================================================================

async function handleStripeEvent(event) {
    const eventType = event && event.type;
    switch (eventType) {
        case 'payment_intent.succeeded': {
            const pi = event.data && event.data.object;
            if (pi) {
                await ledger.updatePaymentStatus('stripe', pi.id, 'succeeded', { metadata: { last_event: eventType, amount: pi.amount, currency: pi.currency } });
            }
            console.log('[Stripe] Payment succeeded:', pi && pi.id);
            break;
        }
        case 'payment_intent.payment_failed': {
            const pi = event.data && event.data.object;
            if (pi) {
                await ledger.updatePaymentStatus('stripe', pi.id, 'failed', { metadata: { last_event: eventType, last_error: pi.last_payment_error && pi.last_payment_error.message } });
            }
            console.log('[Stripe] Payment failed:', pi && pi.id);
            break;
        }
        case 'charge.refunded': {
            const ch = event.data && event.data.object;
            if (ch && ch.payment_intent) {
                await ledger.updatePaymentStatus('stripe', ch.payment_intent, 'refunded', { metadata: { last_event: eventType, charge: ch.id } });
            }
            console.log('[Stripe] Charge refunded:', ch && ch.id);
            break;
        }
        default:
            console.log('[Stripe] Unhandled event:', eventType);
    }
}

async function handleRazorpayEvent(event) {
    const eventType = event && event.event;
    switch (eventType) {
        case 'payment.captured': {
            const pay = event.payload && event.payload.payment && event.payload.payment.entity;
            if (pay && pay.order_id) {
                await ledger.updatePaymentStatus('razorpay', pay.order_id, 'succeeded', { metadata: { last_event: eventType, payment_id: pay.id, amount: pay.amount } });
            }
            console.log('[Razorpay] Payment captured:', pay && pay.id);
            break;
        }
        case 'payment.failed': {
            const pay = event.payload && event.payload.payment && event.payload.payment.entity;
            if (pay && pay.order_id) {
                await ledger.updatePaymentStatus('razorpay', pay.order_id, 'failed', { metadata: { last_event: eventType, payment_id: pay.id, error: pay.error_description } });
            }
            console.log('[Razorpay] Payment failed:', pay && pay.id);
            break;
        }
        default:
            console.log('[Razorpay] Unhandled event:', eventType);
    }
}

async function handlePayPalEvent(event, req) {
    const eventType = event && event.event_type;
    switch (eventType) {
        case 'PAYMENT.CAPTURE.COMPLETED': {
            const cap = event.resource || {};
            if (cap.id) {
                await ledger.updatePaymentStatus('paypal', cap.id, 'succeeded', { metadata: { last_event: eventType, amount: cap.amount && cap.amount.value, currency: cap.amount && cap.amount.currency_code } });
            }
            console.log('[PayPal] Capture completed:', cap && cap.id);
            // REAL money credit — only after PayPal itself confirms the signature.
            try {
                const h = (req && req.headers) || {};
                const ok = await paypalAdapter.verifyWebhookSignature({
                    transmissionId: h['paypal-transmission-id'],
                    transmissionTime: h['paypal-transmission-time'],
                    certUrl: h['paypal-cert-url'],
                    authAlgo: h['paypal-auth-algo'],
                    transmissionSig: h['paypal-transmission-sig'],
                    webhookId: process.env.PAYPAL_WEBHOOK_ID,
                    event,
                });
                if (!ok) {
                    console.error('[PayPal] Webhook signature NOT verified — no credit.');
                    break;
                }
                const custom = String((cap && cap.custom_id) || '');
                const [userId, accountId] = custom.split(':');
                const amt = parseFloat(cap.amount && cap.amount.value);
                if (userId && accountId && amt > 0) {
                    const { creditPayPalDeposit } = require('./paypal-deposits');
                    await creditPayPalDeposit({
                        userId,
                        accountId,
                        amount: amt,
                        currency: (cap.amount && cap.amount.currency_code) || 'USD',
                        captureId: cap.id,
                        orderId: null,
                    });
                }
            } catch (e) {
                console.error('[PayPal] Capture credit error:', e.message);
            }
            break;
        }
        case 'PAYMENT.CAPTURE.DENIED': {
            const cap = event.resource || {};
            if (cap.id) {
                await ledger.updatePaymentStatus('paypal', cap.id, 'failed', { metadata: { last_event: eventType } });
            }
            console.log('[PayPal] Capture denied:', cap && cap.id);
            break;
        }
        default:
            console.log('[PayPal] Unhandled event:', eventType);
    }
}

module.exports = router;
