const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { transferLimiter } = require('../middleware/rateLimiter');
const { demoStore, findUserById } = require('../config/database');

const router = express.Router();

/**
 * POST /api/transfers
 * Create a new transfer
 */
router.post('/api/transfers', authenticateToken, transferLimiter, (req, res) => {
    try {
        const { amount, recipient, method, reason, accountNumber, ifscCode, iban, swiftCode, vaultbankId, walletAddress } = req.body;
        const userId = req.user.id;

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

        // AML check - flag large transfers
        const isHighRisk = transferAmount >= 10000;
        const isSuspicious = transferAmount >= 5000;

        if (isHighRisk) {
            // Log AML alert
            demoStore.auditLogs.push({
                id: uuidv4(),
                userId,
                action: 'aml_alert',
                category: 'compliance',
                details: JSON.stringify({
                    amount: transferAmount,
                    recipient,
                    method: method || 'domestic',
                    description: `Large transfer detected: $${transferAmount}`
                }),
                timestamp: new Date().toISOString()
            });

            // Create alert
            demoStore.alerts.push({
                id: uuidv4(),
                userId,
                type: 'aml',
                message: `🚨 Large transfer detected: $${transferAmount} to ${recipient}`,
                severity: 'critical',
                read: false,
                createdAt: new Date().toISOString()
            });
        }

        // Create transaction record
        const transaction = {
            id: uuidv4(),
            userId,
            label: `${(method || 'domestic').toUpperCase()} Transfer to ${recipient}`,
            amount: -transferAmount,
            date: new Date().toISOString().split('T')[0],
            category: 'transfer',
            method: method || 'domestic',
            recipient,
            status: 'completed',
            reference: `TXN-${Date.now()}`,
            amlFlagged: isHighRisk,
            createdAt: new Date().toISOString()
        };

        // Update user balance and transactions in demo store
        const userIndex = demoStore.users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            demoStore.users[userIndex].balance = (demoStore.users[userIndex].balance || 0) - transferAmount;
            demoStore.users[userIndex].transactions = [transaction, ...(demoStore.users[userIndex].transactions || [])];
        }

        // Audit log
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'transfer_created',
            category: 'financial',
            resourceId: transaction.id,
            details: JSON.stringify({
                amount: transferAmount,
                recipient,
                method: method || 'domestic'
            }),
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: 'Transfer initiated successfully.',
            data: {
                transaction,
                amlFlagged: isHighRisk,
                processingTime: method === 'vaultbank' ? 'Instant' : method === 'crypto' ? '1-3 hours' : '1-2 business days'
            }
        });

    } catch (error) {
        console.error('Transfer error:', error);
        return res.status(500).json({
            success: false,
            message: 'Transfer failed. Please try again.'
        });
    }
});

/**
 * GET /api/transfers/history
 * Get user's transfer history
 */
router.get('/api/transfers/history', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const user = findUserById(userId);
        const transactions = user?.transactions?.filter(t => t.category === 'transfer') || [];

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
router.get('/api/transfers', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const user = findUserById(userId);
        const transactions = user?.transactions || [];

        return res.status(200).json({
            success: true,
            data: { transactions },
            count: transactions.length
        });
    } catch (error) {
        console.error('Transactions error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching transactions.'
        });
    }
});

module.exports = router;
