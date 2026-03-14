const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore } = require('../config/database');

const router = express.Router();

/**
 * POST /api/payments/upi/initiate
 * Initiate a UPI payment
 */
router.post('/api/payments/upi/initiate', authenticateToken, (req, res) => {
    try {
        const { amount, upiId, description, currency } = req.body;
        const userId = req.user.id;

        if (!amount || !upiId) {
            return res.status(400).json({
                success: false,
                message: 'Amount and UPI ID are required.'
            });
        }

        const paymentRef = `VB-UPI-${Date.now()}`;
        const upiDeepLink = `upi://pay?pa=${upiId}&pn=VaultBank&am=${amount}&cu=${currency || 'INR'}&tn=${description || 'Payment'}&tr=${paymentRef}`;

        // Create pending payment record
        const payment = {
            id: uuidv4(),
            userId,
            type: 'upi',
            amount: parseFloat(amount),
            currency: currency || 'INR',
            upiId,
            reference: paymentRef,
            description: description || 'UPI Payment',
            status: 'pending',
            upiDeepLink,
            createdAt: new Date().toISOString()
        };

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'upi_payment_initiated',
            category: 'financial',
            resourceId: payment.id,
            details: JSON.stringify({ amount, upiId, reference: paymentRef }),
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: 'UPI payment initiated. Opening UPI app...',
            data: {
                payment,
                upiDeepLink,
                reference: paymentRef
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
 * Initiate a PayPal payment
 */
router.post('/api/payments/paypal/initiate', authenticateToken, (req, res) => {
    try {
        const { amount, currency, description } = req.body;
        const userId = req.user.id;

        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Amount is required.'
            });
        }

        const paymentRef = `VB-PP-${Date.now()}`;

        // In production, this would create a real PayPal order
        // For demo, return a mock approval URL
        const approvalUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${paymentRef}`;

        const payment = {
            id: uuidv4(),
            userId,
            type: 'paypal',
            amount: parseFloat(amount),
            currency: currency || 'USD',
            reference: paymentRef,
            description: description || 'PayPal Payment',
            status: 'pending',
            approvalUrl,
            createdAt: new Date().toISOString()
        };

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'paypal_payment_initiated',
            category: 'financial',
            resourceId: payment.id,
            details: JSON.stringify({ amount, currency, reference: paymentRef }),
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: 'PayPal payment initiated. Redirecting...',
            data: {
                payment,
                approvalUrl,
                reference: paymentRef
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
 * POST /api/payments/paypal/success
 * Handle PayPal payment success callback
 */
router.post('/api/payments/paypal/success', authenticateToken, (req, res) => {
    try {
        const { paymentId, payerId, token } = req.body;

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
 * Get payment history
 */
router.get('/api/payments/history', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        // Get payment-related audit logs
        const paymentLogs = demoStore.auditLogs.filter(l =>
            l.userId === userId &&
            (l.action.includes('payment') || l.action.includes('transfer'))
        );

        return res.status(200).json({
            success: true,
            data: { payments: paymentLogs },
            count: paymentLogs.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching payment history.' });
    }
});

module.exports = router;
