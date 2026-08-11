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
const { findUserByEmail } = require('../config/database');
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
router.post('/api/transfers', authenticateToken, transferLimiter, async (req, res) => {
    const { amount, recipient, method, reason: transferReason } = req.body;
    const userId = req.user.id;

    // Basic validation
    if (!amount || !recipient) {
        return res.status(400).json({
            success: false,
            message: 'Amount and recipient are required.'
        });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid transfer amount.'
        });
    }

    try {
        await db.ensureConnection();

        // Find sender and recipient
        const sender = await db.User.findById(userId);
        if (!sender) {
            return res.status(404).json({ success: false, message: 'Sender not found.' });
        }

        const recipientUser = await db.User.findById(recipient);
        if (!recipientUser) {
            return res.status(404).json({ success: false, message: 'Recipient not found.' });
        }

        // Check balance
        const senderAccount = await db.Account.findOne({ user_id: userId });
        if (!senderAccount) {
            return res.status(404).json({ success: false, message: 'Sender account not found.' });
        }
        if (parseFloat(senderAccount.balance) < transferAmount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance for this transfer.'
            });
        }

        // Debit sender account using PostgreSQL UPDATE with condition
        const debitResult = await db.query(
            `UPDATE accounts 
             SET balance = balance - $2, available_balance = available_balance - $2 
             WHERE id = $1 AND balance >= $2 
             RETURNING *`,
            [senderAccount.id, transferAmount]
        );

        if (debitResult.rowCount === 0) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance for this transfer.'
            });
        }

        const updatedSenderAccount = debitResult.rows[0];

        // Credit recipient
        const recipientAccount = await db.Account.findOne({ user_id: recipient });
        if (recipientAccount) {
            await db.query(
                `UPDATE accounts 
                 SET balance = balance + $2, available_balance = available_balance + $2 
                 WHERE id = $1`,
                [recipientAccount.id, transferAmount]
            );
        }

        // Create transfer record
        const transfer = await db.Transfer.create({
            from_account_id: senderAccount.id,
            to_account_id: recipientAccount ? recipientAccount.id : null,
            from_user_id: userId,
            to_user_id: recipient,
            amount: transferAmount,
            currency: 'USD',
            fee: 0,
            transfer_type: method || 'internal',
            status: 'completed',
            description: transferReason || '',
            reason: transferReason || '',
            metadata: { method: method || 'internal' },
        });

        // Create transaction records for both sides
        await db.Transaction.create({
            account_id: senderAccount.id,
            user_id: userId,
            type: 'transfer_out',
            status: 'completed',
            amount: -transferAmount,
            currency: 'USD',
            balance_before: senderAccount.balance,
            balance_after: updatedSenderAccount.balance,
            description: transferReason || 'Transfer',
            category: 'transfer',
            reference_id: transfer.id,
        });

        if (recipientAccount) {
            await db.Transaction.create({
                account_id: recipientAccount.id,
                user_id: recipient,
                type: 'transfer_in',
                status: 'completed',
                amount: transferAmount,
                currency: 'USD',
                balance_before: recipientAccount.balance,
                balance_after: parseFloat(recipientAccount.balance) + transferAmount,
                description: transferReason || 'Transfer received',
                category: 'transfer',
                reference_id: transfer.id,
            });
        }

        // Update Prometheus metrics
        totalTransfers.inc();
        totalTransferVolume.inc(transferAmount);

        // Run anomaly detection
        const { isAnomaly, reason } = checkAnomaly({
            userId,
            amount: transferAmount,
            method: method || 'internal',
            transactionId: transfer.id
        });

        if (isAnomaly) {
            anomalyTransfers.inc();
            logger.warn('Anomaly detected on transfer', {
                transferId: transfer.id,
                userId,
                amount: transferAmount,
                reason
            });
        }

        // Audit log
        await logAudit({
            userId,
            action: 'transfer_create',
            category: 'transfer',
            resourceId: transfer.id,
            details: { amount: transferAmount, recipient, method, anomaly: isAnomaly },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        return res.status(200).json({
            success: true,
            transfer: {
                id: transfer.id,
                amount: transferAmount,
                method: method || 'internal',
                reason: transferReason,
                status: 'completed',
                createdAt: transfer.created_at,
                recipientId: recipient,
                isAnomaly,
                anomalyReason: reason
            },
        });
    } catch (error) {
        console.error('Transfer error:', error);
        return res.status(500).json({
            success: false,
            message: 'Transfer failed. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/transfers
 * Retrieve transfers for the authenticated user.
 */
router.get('/api/transfers', authenticateToken, async (req, res) => {
    try {
        await db.ensureConnection();
        const userId = req.user.id;
        const { limit = 20, offset = 0 } = req.query;

        const transfers = await db.Transfer.find({
            $or: [{ from_user_id: userId }, { to_user_id: userId }]
        })
            .sort({ created_at: -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit));

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