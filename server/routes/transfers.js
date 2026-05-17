const express = require('express');
// Removed unused uuidv4 import to satisfy ESLint no-unused-vars rule
const { authenticateToken } = require('../middleware/auth');
const { transferLimiter } = require('../middleware/rateLimiter');
// PostgreSQL connection utilities
const { query, getClient } = require('../config/db');
// Helper for demo mode fallback (used in GET routes for now)
const { demoStore, findUserByEmail } = require('../config/database'); // Retained demoStore for active user metrics
// Logger and metrics
const logger = require('../logger');
const { totalTransfers, totalTransferVolume, setActiveUsers, setTotalBalance, anomalyTransfers } = require('../metrics'); // Removed unused tokenized metrics
const { checkAnomaly } = require('../anomaly');
const { generateTransferToken, verifyTransferToken } = require('../transfers/token');
const auditLogger = require('../middleware/auditLogger');
// Import the new audit utility for generic audit logging
const { logAudit } = require('../utils/audit');

const router = express.Router();

/**
 * POST /api/transfers
 * Create a new transfer
 */
router.post('/api/transfers', authenticateToken, transferLimiter, async (req, res) => {
    const client = await getClient();
    try {
        // Extract request body fields. Rename `reason` to `transferReason` to avoid conflict with anomaly detection variable.
        const { amount, recipient, method, reason: transferReason } = req.body;
        const userId = req.user.id; // sender's UUID

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

        // Begin transaction
        await client.query('BEGIN');

        // Lock sender row for update
        const senderResult = await client.query(
            'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        if (senderResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Sender not found.' });
        }
        const sender = senderResult.rows[0];

        // Ensure sufficient balance
        if (parseFloat(sender.balance) < transferAmount) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance for this transfer.'
            });
        }

        // Lock recipient row for update
        const recipientResult = await client.query(
            'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
            [recipient]
        );
        if (recipientResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Recipient not found.' });
        }
        const recipientUser = recipientResult.rows[0];

        // Insert transfer record
        const transferInsert = await client.query(
            `INSERT INTO transfers (from_user, to_user, amount, method, reason)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, created_at`,
            [userId, recipient, transferAmount, method || 'domestic', transferReason]
        );
        const transfer = transferInsert.rows[0];

        // Insert ledger entries (debit for sender, credit for recipient)
        const ledgerDebit = await client.query(
            `INSERT INTO ledger (entry_type, user_id, amount, reference_id)
             VALUES ('debit', $1, $2, $3) RETURNING id`,
            [userId, transferAmount, transfer.id]
        );
        const ledgerCredit = await client.query(
            `INSERT INTO ledger (entry_type, user_id, amount, reference_id)
             VALUES ('credit', $1, $2, $3) RETURNING id`,
            [recipient, transferAmount, transfer.id]
        );

        // Update balances atomically
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [transferAmount, userId]
        );
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [transferAmount, recipient]
        );

        // Commit transaction
        await client.query('COMMIT');
        // Update Prometheus metrics
        totalTransfers.inc();
        totalTransferVolume.inc(transferAmount);
        // Run anomaly detection
        const { isAnomaly, reason } = checkAnomaly({ userId, amount: transferAmount, method, transactionId: transfer.id });
        if (isAnomaly) {
            // Log anomaly
            logger.warn('ANOMALY DETECTED', { userId, amount: transferAmount, method, reason, transactionId: transfer.id });
            // Increment anomaly counter
            anomalyTransfers.inc();
            // Insert audit log entry for anomaly detection
            if (req.logAction) {
                await req.logAction({
                    userId,
                    action: 'anomaly_detected',
                    category: 'anomaly',
                    resourceId: transfer.id,
                    details: { amount: transferAmount, method, reason },
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                });
            }
        }
        // Update active users gauge based on demo store length
        setActiveUsers(demoStore.users.length);
        // Update total balance gauge (sum of all user balances in demo store)
        const totalBal = demoStore.users.reduce((sum, u) => sum + parseFloat(u.balance), 0);
        setTotalBalance(totalBal);

        // Build response payload without exposing sender identifier
        const transaction = {
            id: transfer.id,
            // fromUser omitted for privacy‑by‑default
            toUser: recipient,
            amount: transferAmount,
            method: method || 'domestic',
            reason: transferReason || null,
            createdAt: transfer.created_at,
            ledgerEntries: {
                debitId: ledgerDebit.rows[0].id,
                creditId: ledgerCredit.rows[0].id
            }
        };

        // Return updated balances for both parties
        const updatedSenderBalance = parseFloat(sender.balance) - transferAmount;
        const updatedRecipientBalance = parseFloat(recipientUser.balance) + transferAmount;

        // Log audit entry for standard transfer (no token) using the existing auditLogger middleware
        try {
            await auditLogger({
                senderId: userId,
                receiverId: recipient,
                token: null,
                amount: transferAmount,
            });
        } catch (auditErr) {
            console.error('Audit logging failed for standard transfer:', auditErr);
        }
        // Additionally, persist a generic audit log entry using the new utility
        try {
            await logAudit(userId, 'transfer', 'transfer');
        } catch (logErr) {
            console.error('Generic audit log error for transfer:', logErr);
        }

        // Return transaction and updated balances at top level for client compatibility
        return res.status(201).json({
            success: true,
            message: 'Transfer completed successfully.',
            transaction,
            balances: {
                sender: { userId, balance: updatedSenderBalance },
                recipient: { userId: recipient, balance: updatedRecipientBalance }
            }
        });
    } catch (error) {
        console.error('Transfer error:', error);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback error:', rollbackError);
        }
        return res.status(500).json({
            success: false,
            message: 'Transfer failed. Please try again.'
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/transfers/history
 * Get user's transfer history
 */
router.get('/api/transfers/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        // Fetch transfers initiated by the user (sent transfers)
        const result = await query(
            `SELECT id, from_user, to_user, amount, method, reason, created_at
             FROM transfers
             WHERE from_user = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        // Map to client-friendly shape
        const transactions = result.rows.map(row => ({
            id: row.id,
            date: row.created_at,
            recipient: row.to_user,
            amount: -parseFloat(row.amount), // outgoing transfers are negative
            method: row.method,
            reason: row.reason
        }));

        return res.status(200).json({
            success: true,
            data: { transactions },
            count: transactions.length
        });
    } catch (error) {
        console.error('Transfer history error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching transfer history.'
        });
    }
});

/**
 * GET /api/transfers
 * Get all user transactions (including transfers)
 */
router.get('/api/transfers', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        // Fetch all transfers where the user is either sender or recipient
        const result = await query(
            `SELECT id, from_user, to_user, amount, method, reason, created_at, status
            FROM transfers
            WHERE from_user = $1 OR to_user = $1
            ORDER BY created_at DESC`,
            [userId]
        );
        // Map to a unified shape: for inbound transfers, amount is positive; for outbound, negative
        const transactions = result.rows.map(row => {
            const isOutgoing = row.from_user === userId;
            return {
                id: row.id,
                date: row.created_at,
                recipient: isOutgoing ? row.to_user : row.from_user,
                amount: isOutgoing ? -parseFloat(row.amount) : parseFloat(row.amount),
                method: row.method,
                reason: row.reason,
                status: row.status,
            };
        });
        return res.status(200).json({
            success: true,
            data: { transactions },
            count: transactions.length,
        });
    } catch (error) {
        console.error('Transactions error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching transactions.',
        });
    }
});

/**
 * GET /api/transfers/list
 * Returns a privacy‑by‑default list of tokenized transfers for the authenticated user.
 * Only token, amount, and status fields are returned; sender/receiver IDs are omitted.
 */
router.get('/api/transfers/list', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await query(
            `SELECT token, amount, status FROM transfers WHERE from_user = $1 OR to_user = $1 ORDER BY created_at DESC`,
            [userId]
        );
        const transfers = result.rows;
        return res.status(200).json({
            success: true,
            data: transfers,
            count: transfers.length,
        });
    } catch (error) {
        console.error('Tokenized transfer list error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching tokenized transfers.',
        });
    }
});

/**
 * POST /api/transfer/initiate
 * Generate a token for a pending transfer without debiting the sender.
 */
router.post('/api/transfer/initiate', authenticateToken, transferLimiter, async (req, res) => {
    const client = await getClient();
    try {
        const { amount, recipientEmail, method, reason: transferReason } = req.body;
        const senderId = req.user.id;

        // Basic validation
        if (!amount || !recipientEmail) {
            return res.status(400).json({ success: false, message: 'Amount and recipient email are required.' });
        }
        const transferAmount = parseFloat(amount);
        if (isNaN(transferAmount) || transferAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid transfer amount.' });
        }

        // Find recipient (demo mode helper)
        const recipientUser = findUserByEmail(recipientEmail);
        if (!recipientUser) {
            return res.status(404).json({ success: false, message: 'Recipient not found.' });
        }

        // Generate a secure token
        const token = generateTransferToken(senderId, transferAmount);

        // Insert a pending transfer record (no need to capture result)
        await client.query(
            `INSERT INTO transfers (from_user, to_user, amount, method, reason, token, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, created_at`,
            [senderId, recipientUser.id, transferAmount, method || 'domestic', transferReason, token, 'pending']
        );

        // Log audit entry for tokenized transfer initiation
        try {
            await auditLogger({
                senderId,
                receiverId: recipientUser.id,
                token,
                amount: transferAmount,
            });
        } catch (auditErr) {
            console.error('Audit logging failed for initiate transfer:', auditErr);
        }

        // Return only token, amount, and status as per privacy‑by‑default requirement
        return res.status(201).json({
            token,
            amount: transferAmount,
            status: 'pending',
        });
    } catch (error) {
        console.error('Initiate transfer error:', error);
        try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('Rollback error:', rollbackError); }
        return res.status(500).json({ success: false, message: 'Failed to initiate transfer.' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/transfer/claim
 * Claim a pending transfer using the token. This debits the sender and credits the recipient.
 */
router.post('/api/transfer/claim', async (req, res) => {
    const client = await getClient();
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ success: false, message: 'Token is required.' });
        }
        // Verify token integrity
        if (!verifyTransferToken(token)) {
            return res.status(400).json({ success: false, message: 'Invalid or tampered token.' });
        }

        // Begin transaction to safely update balances and transfer status
        await client.query('BEGIN');

        // Lock the transfer row
        const transferResult = await client.query(
            'SELECT * FROM transfers WHERE token = $1 FOR UPDATE',
            [token]
        );
        if (transferResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Transfer not found.' });
        }
        const transfer = transferResult.rows[0];
        if (transfer.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Transfer is already ${transfer.status}.` });
        }

        const { from_user: senderId, to_user: recipientId, amount } = transfer;
        const transferAmount = parseFloat(amount);

        // Lock sender and recipient rows for update
        const senderResult = await client.query(
            'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
            [senderId]
        );
        if (senderResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Sender not found.' });
        }
        const sender = senderResult.rows[0];

        const recipientResult = await client.query(
            'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
            [recipientId]
        );
        if (recipientResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Recipient not found.' });
        }
        // const recipient = recipientResult.rows[0]; // Unused variable removed

        // Ensure sender has sufficient balance
        if (parseFloat(sender.balance) < transferAmount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Insufficient balance.' });
        }

        // Insert ledger entries
        await client.query(
            `INSERT INTO ledger (entry_type, user_id, amount, reference_id)
             VALUES ('debit', $1, $2, $3)`,
            [senderId, transferAmount, transfer.id]
        );
        await client.query(
            `INSERT INTO ledger (entry_type, user_id, amount, reference_id)
             VALUES ('credit', $1, $2, $3)`,
            [recipientId, transferAmount, transfer.id]
        );

        // Update balances
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [transferAmount, senderId]);
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [transferAmount, recipientId]);

        // Mark transfer as completed
        await client.query('UPDATE transfers SET status = $1 WHERE id = $2', ['completed', transfer.id]);

        // Log audit entry for tokenized transfer claim
        try {
            await auditLogger({
                senderId,
                receiverId: recipientId,
                token,
                amount: transferAmount,
            });
        } catch (auditErr) {
            console.error('Audit logging failed for claim transfer:', auditErr);
        }

        await client.query('COMMIT');

        // Return only token, amount, and status as per privacy‑by‑default requirement
        return res.status(200).json({
            token,
            amount: transferAmount,
            status: 'claimed',
        });
    } catch (error) {
        console.error('Claim transfer error:', error);
        try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('Rollback error:', rollbackError); }
        return res.status(500).json({ success: false, message: 'Failed to claim transfer.' });
    } finally {
        client.release();
    }
});

module.exports = router;
