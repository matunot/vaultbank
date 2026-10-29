/**
 * VaultBank Transfer Routes
 * 
 * MongoDB-native transfer processing with:
 * - Mongoose sessions for atomic transfers
 * - Balance validation and updates
 * - Anomaly detection
 * - Audit logging
 */

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { transferLimiter } = require('../middleware/rateLimiter');
const { query, getClient, models } = require('../config/db');
const db = require('../config/db');
const { findUserByEmail, findUserById, findAccountByUserIdAndCurrency } = require('../config/database');
const logger = require('../logger');
const { totalTransfers, totalTransferVolume, setActiveUsers, setTotalBalance, anomalyTransfers } = require('../metrics');
const { checkAnomaly } = require('../anomaly');
const { generateTransferToken, verifyTransferToken } = require('../transfers/token');
const auditLogger = require('../middleware/auditLogger');
const { logAudit } = require('../utils/audit');

const router = express.Router();

/**
 * POST /api/transfers
 * Create a new transfer with atomic MongoDB operations
 */
/**
 * POST /api/transfers
 * VaultBank-native internal transfer. All balance changes are delegated to
 * the shared atomic ledger service; this route must never debit or credit
 * balances with independent SQL statements.
 */
router.post('/api/transfers', authenticateToken, transferLimiter, async (req, res) => {
    const { amount, recipient, method, reason: transferReason, currency = 'USD' } = req.body || {};
    const userId = req.user.id;
    const requestedCurrency = String(currency || 'USD').trim().toUpperCase();
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();

    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
        return res.status(400).json({
            success: false,
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Provide an Idempotency-Key (8–100 characters) and reuse it for retries of this transfer attempt.',
        });
    }
    if (recipient == null || String(recipient).trim() === '') {
        return res.status(400).json({ success: false, message: 'A VaultBank recipient is required.' });
    }
    if (String(recipient) === String(userId)) {
        return res.status(400).json({ success: false, code: 'SELF_TRANSFER_NOT_ALLOWED', message: 'Cannot transfer to your own account.' });
    }
    if (method && !['internal', 'vaultbank', 'vaultbank-internal'].includes(String(method).trim().toLowerCase())) {
        return res.status(400).json({
            success: false,
            code: 'NATIVE_INTERNAL_ONLY',
            message: 'This endpoint supports VaultBank-to-VaultBank internal transfers only. External bank transfers use a separate settlement rail.',
        });
    }
    if (!['INR', 'USD'].includes(requestedCurrency)) {
        return res.status(400).json({ success: false, code: 'UNSUPPORTED_CURRENCY', message: 'Use INR or USD for internal transfers.' });
    }

    // Parse the amount without binary floating-point rounding.
    const rawAmount = typeof amount === 'number' ? String(amount) : String(amount == null ? '' : amount).trim();
    if (!/^\\d+(?:\\.\\d{1,2})?$/.test(rawAmount)) {
        return res.status(400).json({ success: false, message: 'Amount must be positive and have at most two decimal places.' });
    }
    const [rawWhole, rawFraction = ''] = rawAmount.split('.');
    const whole = BigInt(rawWhole);
    const minor = whole * 100n + BigInt(rawFraction.padEnd(2, '0') || '0');
    if (minor <= 0n) {
        return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    }
    if (minor > 10000000n) {
        return res.status(400).json({ success: false, message: 'Maximum single internal transfer is 100,000.00.' });
    }
    const normalizedAmount = ${whole.toString()}`.${rawFraction.padEnd(2, '0') || '00'}`;

    try {
        const recipientUser = await findUserById(String(recipient));
        if (!recipientUser) {
            return res.status(404).json({ success: false, code: 'RECIPIENT_NOT_FOUND', message: 'VaultBank recipient not found.' });
        }

        const senderAccount = await findAccountByUserIdAndCurrency(userId, requestedCurrency);
        if (!senderAccount) {
            return res.status(404).json({ success: false, code: 'SENDER_ACCOUNT_NOT_FOUND', message: `You do not have an active ${requestedCurrency} account.` });
        }
        const recipientAccount = await findAccountByUserIdAndCurrency(recipientUser.id, requestedCurrency);
        if (!recipientAccount) {
            return res.status(404).json({ success: false, code: 'RECIPIENT_NOT_FOUND', message: `Recipient does not have an ${requestedCurrency} account.` });
        }
        if (String(senderAccount.id) === String(recipientAccount.id)) {
            return res.status(400).json({ success: false, code: 'SELF_TRANSFER_NOT_ALLOWED', message: 'Cannot transfer to your own account.' });
        }

        const { executeAtomicTransfer, notifyTransferCompletion } = require('../services/transferService');
        const result = await executeAtomicTransfer({
            userId,
            senderAccount,
            recipientAccount,
            amount: normalizedAmount,
            currency: requestedCurrency,
            description: String(transferReason || 'Internal transfer').slice(0, 250),
            idempotencyKey,
            senderName: req.user.full_name,
        });

        if (result.replay) {
            res.setHeader('Idempotent-Replay', 'true');
            return res.status(200).json({
                success: true,
                replay: true,
                transfer: { id: result.transferId, status: 'completed', currency: requestedCurrency },
                message: 'Transfer already processed; returned the original result.',
            });
        }
        if (result.ambiguous || result.code === 'TRANSFER_OUTCOME_UNKNOWN') {
            return res.status(409).json({
                success: false,
                code: 'TRANSFER_OUTCOME_UNKNOWN',
                message: 'Transfer outcome is not yet confirmed. Retry using the SAME Idempotency-Key; do not create a new key.',
            });
        }
        if (result.error) {
            const code = result.code || 'TRANSFER_FAILED';
            const status = code === 'INSUFFICIENT_FUNDS' || code === 'UNVERIFIED_FUNDS' ||
                code === 'SENDER_ACCOUNT_INACTIVE' || code === 'RECIPIENT_ACCOUNT_INACTIVE' ||
                code === 'CURRENCY_MISMATCH' ? 400 :
                code === 'SENDER_ACCOUNT_NOT_FOUND' || code === 'RECIPIENT_NOT_FOUND' ? 404 :
                code === 'TRANSFER_IN_PROGRESS' || code === 'IDEMPOTENCY_CONFLICT' ? 409 :
                code === 'COMMIT_FAILED' ? 500 : 400;
            return res.status(status).json({ success: false, code, message: result.message || 'Transfer was not completed.' });
        }

        // Post-commit effects never make a committed transfer appear to fail.
        let isAnomaly = false;
        try {
            totalTransfers.inc();
            totalTransferVolume.inc(Number(normalizedAmount));
            const anomaly = checkAnomaly({
                userId,
                amount: Number(normalizedAmount),
                method: 'internal',
                transactionId: result.transferId,
            });
            isAnomaly = !!(anomaly && anomaly.isAnomaly);
            if (isAnomaly) {
                anomalyTransfers.inc();
                logger.warn('Anomaly detected on native transfer', {
                    transferId: result.transferId,
                    userId,
                    reason: anomaly.reason,
                });
            }
        } catch (sideEffectError) {
            logger.warn('Native transfer monitoring side effect failed after commit.', { code: sideEffectError.code || 'monitoring_error' });
        }

        try {
            await notifyTransferCompletion({
                userId,
                recipientAccount,
                senderAccount,
                amount: Number(normalizedAmount),
                currency: requestedCurrency,
                newSenderBalance: Number(result.newSenderBalance),
                recipientBalance: Number(result.recipientBalance),
            });
        } catch (_) { /* transfer is already committed */ }

        try {
            await logAudit({
                userId,
                action: 'transfer_create',
                category: 'transfer',
                resourceId: result.transferId,
                details: { currency: requestedCurrency, method: 'internal', isAnomaly },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
            });
        } catch (_) { /* audit outage must not turn a committed transfer into a reported failure */ }

        return res.status(200).json({
            success: true,
            transfer: {
                id: result.transferId,
                amount: Number(normalizedAmount),
                currency: requestedCurrency,
                method: 'internal',
                reason: transferReason || 'Internal transfer',
                status: 'completed',
                recipientId: recipientUser.id,
                isAnomaly,
            },
            newSenderBalance: result.newSenderBalance,
            recipientBalance: result.recipientBalance,
        });
    } catch (error) {
        logger.error('Native internal transfer request failed.', { code: error && error.code ? String(error.code) : 'internal_error' });
        return res.status(500).json({
            success: false,
            code: 'TRANSFER_REQUEST_FAILED',
            message: 'Transfer request could not be completed. Retry with the SAME Idempotency-Key or check transfer history before trying again.',
        });
    }
});

router.get('/api/transfers', authenticateToken, async (req, res) => {
    try {
        await db.ensureConnection();
        const userId = req.user.id;
        const { limit = 20, offset = 0 } = req.query;
        // ponytail: clamp pagination (DoS cap); pg compat takes options, not Mongoose chain
        const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const off = Math.max(parseInt(offset, 10) || 0, 0);

        const transfers = await db.Transfer.find({
            $or: [{ from_user_id: userId }, { to_user_id: userId }]
        }, { limit: lim, skip: off });

        // Enrich with user names
        const enriched = await Promise.all(transfers.map(async (t) => {
            const result = { ...t, id: t.id };
            try {
                if (t.from_user_id) {
                    const fromUser = await db.User.findById(t.from_user_id);
                    if (fromUser) {
                        result.from_user_name = fromUser.full_name;
                        result.from_user_email = fromUser.email;
                    }
                }
                if (t.to_user_id) {
                    const toUser = await db.User.findById(t.to_user_id);
                    if (toUser) {
                        result.to_user_name = toUser.full_name;
                        result.to_user_email = toUser.email;
                    }
                }
            } catch (e) { /* ignore */ }
            return result;
        }));

        return res.status(200).json({ success: true, transfers: enriched });
    } catch (error) {
        console.error('Fetch transfers error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch transfers.' });
    }
});

/**
 * GET /api/transfers/history
 * Aliased route for transfer history
 */
router.get('/api/transfers/history', authenticateToken, async (req, res) => {
    return router.handle(req, res, 'GET /api/transfers');
});

/**
 * POST /api/transfers/token
 * Generate a transfer token for secure transfers
 */
router.post('/api/transfers/token', authenticateToken, async (req, res) => {
    try {
        const { amount, recipient, method } = req.body;
        if (!amount || !recipient) {
            return res.status(400).json({ success: false, message: 'Amount and recipient required.' });
        }

        const token = await generateTransferToken({
            userId: req.user.id,
            amount: parseFloat(amount),
            recipient,
            method: method || 'internal'
        });

        return res.status(200).json({ success: true, token });
    } catch (error) {
        console.error('Token generation error:', error);
        return res.status(500).json({ success: false, message: 'Failed to generate token.' });
    }
});

module.exports = router;