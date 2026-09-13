/**
 * VaultBank PayPal Deposit Routes — REAL money in via PayPal Checkout.
 *
 * - POST /api/paypal/deposit — create a PayPal order, return approvalUrl
 * - POST /api/paypal/capture — capture an approved order, credit balance
 * - Webhook PAYMENT.CAPTURE.COMPLETED (routes/payments.js) credits too.
 *
 * Fail-closed: without real PayPal keys every money path 503s. No mock money.
 * Credits are idempotent on the PayPal capture id and use atomic balance
 * increments so retries and double-delivery can never double-credit.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    findAccountByUserId,
    createTransaction,
    createNotification,
    db,
} = require('../config/database');
const ledger = require('../payments/ledger');
const paypalAdapter = require('../payments/paypal');

const BASE_URL = (process.env.CLIENT_URL || 'https://vaultbank-md20.onrender.com').replace(/\/+$/, '');

const hasPayPalKeys = () => {
    const id = process.env.PAYMENT_PROVIDER_PAYPAL_CLIENT_ID;
    const secret = process.env.PAYMENT_PROVIDER_PAYPAL_SECRET;
    return !!(id && !id.startsWith('your_paypal') && secret);
};

// ============================================================================
// Shared idempotent credit — single place money enters from PayPal
// ============================================================================
async function creditPayPalDeposit({ userId, accountId, amount, currency, captureId, orderId }) {
    const amt = parseFloat(amount);
    if (!userId || !accountId || !(amt > 0) || !captureId) return { credited: false, reason: 'invalid' };
    // Idempotency: a capture credits exactly once, even on retry/double webhook.
    const dup = await db.query('SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1', [captureId]);
    if (dup.rows.length > 0) {
        await ledger.updatePaymentStatus('paypal', orderId || captureId, 'succeeded', { metadata: { duplicate: true, capture_id: captureId } });
        return { credited: false, reason: 'duplicate' };
    }
    // ponytail: atomic increment — concurrent credits can't lose updates
    const { rows } = await db.query(
        'UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1 RETURNING balance',
        [accountId, amt]
    );
    if (rows.length === 0) return { credited: false, reason: 'no-account' };
    const newBalance = parseFloat(rows[0].balance);
    await createTransaction({
        account_id: accountId,
        user_id: userId,
        type: 'deposit',
        status: 'completed',
        amount: amt,
        currency: (currency || 'USD').toUpperCase(),
        balance_before: newBalance - amt,
        balance_after: newBalance,
        description: `PayPal deposit - $${amt.toFixed(2)}`,
        category: 'income',
        external_reference: captureId,
        metadata: { provider: 'paypal', order_id: orderId || null },
    });
    await createNotification(userId, {
        type: 'transaction',
        title: 'Deposit Confirmed',
        message: `$${amt.toFixed(2)} deposit confirmed via PayPal. New balance: $${newBalance.toFixed(2)}`,
    });
    await ledger.updatePaymentStatus('paypal', orderId || captureId, 'succeeded', { metadata: { capture_id: captureId, amount: amt } });
    return { credited: true, newBalance };
}

// ============================================================================
// POST /api/paypal/deposit — start a PayPal Checkout deposit
// ============================================================================
router.post('/api/paypal/deposit', authenticateToken, async (req, res) => {
    try {
        const amount = parseFloat(req.body && req.body.amount);
        const currency = ((req.body && req.body.currency) || 'USD').toUpperCase();
        if (!(amount >= 1)) {
            return res.status(400).json({ success: false, message: 'Minimum deposit is $1.00.' });
        }
        if (amount > 100000) {
            return res.status(400).json({ success: false, message: 'Maximum single deposit is $100,000.' });
        }
        if (!hasPayPalKeys()) {
            return res.status(503).json({ success: false, code: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal deposits are not enabled yet.' });
        }
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }
        const result = await paypalAdapter.createPaymentIntent({
            amount,
            currency,
            description: `VaultBank deposit $${amount.toFixed(2)}`,
            userId: req.user.id,
            customId: `${req.user.id}:${account.id}`,
            returnUrl: `${BASE_URL}/?deposit=paypal-success`,
            cancelUrl: `${BASE_URL}/?deposit=cancelled`,
        });
        if (!result || result.mock || !result.approvalUrl) {
            return res.status(503).json({ success: false, code: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal deposits are not enabled yet.' });
        }
        await ledger.upsertPayment({
            provider: 'paypal',
            provider_id: result.providerId,
            user_id: req.user.id,
            amount,
            currency,
            status: result.status || 'CREATED',
            method: 'paypal',
            metadata: { kind: 'deposit', account_id: account.id },
        });
        return res.status(200).json({ success: true, approvalUrl: result.approvalUrl, orderId: result.providerId });
    } catch (error) {
        console.error('PayPal deposit error:', error.message);
        // TEMP-DIAG (revert before final): surface sanitized PayPal reason to authed caller for live diagnosis
        const detail = String((error && error.message) || error || 'unknown').replace(/['"][A-Za-z0-9_\-]{20,}['"]/g, '[redacted]').slice(0, 300);
        return res.status(500).json({ success: false, message: 'Failed to start PayPal deposit.', detail });
    }
});

// ============================================================================
// POST /api/paypal/capture — capture an approved order, credit the account
// ============================================================================
router.post('/api/paypal/capture', authenticateToken, async (req, res) => {
    try {
        const orderId = req.body && req.body.orderId;
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'orderId is required.' });
        }
        if (!hasPayPalKeys()) {
            return res.status(503).json({ success: false, code: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal deposits are not enabled yet.' });
        }
        const status = await paypalAdapter.getStatus(orderId);
        let capture = null;
        let orderAmount = null;
        let orderCurrency = 'USD';
        if (status.status === 'APPROVED') {
            capture = await paypalAdapter.capturePayment(orderId);
            if (!capture || (capture.status !== 'COMPLETED' && capture.status !== 'completed')) {
                return res.status(400).json({ success: false, message: 'PayPal capture was not completed.' });
            }
            orderAmount = parseFloat(capture.amount && capture.amount.value);
            orderCurrency = (capture.amount && capture.amount.currency_code) || 'USD';
        } else if (status.status === 'COMPLETED') {
            const pu = status.details && status.details.purchaseUnits && status.details.purchaseUnits[0];
            orderAmount = pu && pu.amount ? parseFloat(pu.amount.value) : NaN;
            orderCurrency = (pu && pu.amount && pu.amount.currency_code) || 'USD';
        } else {
            return res.status(400).json({ success: false, message: `Order is ${status.status}. Approve it in PayPal first.` });
        }
        if (!(orderAmount > 0)) {
            return res.status(400).json({ success: false, message: 'Could not determine the captured amount.' });
        }
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }
        const captureId = (capture && capture.captureId) || orderId;
        const out = await creditPayPalDeposit({
            userId: req.user.id,
            accountId: account.id,
            amount: orderAmount,
            currency: orderCurrency,
            captureId,
            orderId,
        });
        if (!out.credited && out.reason !== 'duplicate') {
            return res.status(400).json({ success: false, message: 'Deposit could not be credited.' });
        }
        return res.status(200).json({ success: true, credited: out.credited, duplicate: out.reason === 'duplicate', newBalance: out.newBalance });
    } catch (error) {
        console.error('PayPal capture error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to capture PayPal deposit.' });
    }
});

module.exports = router;
module.exports.creditPayPalDeposit = creditPayPalDeposit;
