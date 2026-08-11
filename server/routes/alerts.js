const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore } = require('../config/database');

const router = express.Router();

/**
 * GET /api/alerts
 * Get user's alerts
 */
router.get('/api/alerts', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userAlerts = demoStore.alerts
            .filter(a => a.userId === userId || a.userId === 'all')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.status(200).json({
            success: true,
            data: { alerts: userAlerts },
            count: userAlerts.length
        });
    } catch (error) {
        console.error('Alerts get error:', error);
        return res.status(500).json({ success: false, message: 'Error fetching alerts.' });
    }
});

/**
 * GET /api/alerts/unread-count
 * Get count of unread alerts
 */
router.get('/api/alerts/unread-count', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const unreadCount = demoStore.alerts.filter(
            a => (a.userId === userId || a.userId === 'all') && !a.read
        ).length;

        return res.status(200).json({
            success: true,
            unreadCount
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching alert count.' });
    }
});

/**
 * POST /api/alerts/create
 * Create a new alert
 */
router.post('/api/alerts/create', authenticateToken, (req, res) => {
    try {
        const { type, message, severity } = req.body;
        const userId = req.user.id;

        if (!type || !message) {
            return res.status(400).json({
                success: false,
                message: 'Type and message are required.'
            });
        }

        const alert = {
            id: uuidv4(),
            userId,
            type,
            message,
            severity: severity || 'info',
            read: false,
            createdAt: new Date().toISOString()
        };

        demoStore.alerts.push(alert);

        return res.status(201).json({
            success: true,
            message: 'Alert created.',
            data: { alert }
        });
    } catch (error) {
        console.error('Create alert error:', error);
        return res.status(500).json({ success: false, message: 'Error creating alert.' });
    }
});

/**
 * PUT /api/alerts/:id/read
 * Mark alert as read
 */
router.put('/api/alerts/:id/read', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const alertIndex = demoStore.alerts.findIndex(a => a.id === id);

        if (alertIndex === -1) {
            return res.status(404).json({ success: false, message: 'Alert not found.' });
        }

        demoStore.alerts[alertIndex].read = true;

        return res.status(200).json({
            success: true,
            message: 'Alert marked as read.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error updating alert.' });
    }
});

/**
 * PUT /api/alerts/read-all
 * Mark all alerts as read
 */
router.put('/api/alerts/read-all', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        demoStore.alerts.forEach(a => {
            if (a.userId === userId || a.userId === 'all') {
                a.read = true;
            }
        });

        return res.status(200).json({
            success: true,
            message: 'All alerts marked as read.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error updating alerts.' });
    }
});

/**
 * DELETE /api/alerts/:id
 * Delete an alert
 */
router.delete('/api/alerts/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const index = demoStore.alerts.findIndex(a => a.id === id && a.userId === userId);

        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Alert not found.' });
        }

        demoStore.alerts.splice(index, 1);

        return res.status(200).json({
            success: true,
            message: 'Alert deleted.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error deleting alert.' });
    }
});

module.exports = router;
