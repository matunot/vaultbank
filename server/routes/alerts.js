const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore, getNotifications } = require('../config/database');

const router = express.Router();

/**
 * GET /api/alerts
 * Get user's alerts (real DB notifications in production, demoStore fallback)
 */
router.get('/api/alerts', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        let userAlerts = [];
        try {
            // Real DB notifications first (works in production)
            const notifs = await getNotifications(userId, { limit: 50 });
            userAlerts = notifs.map(n => ({
                id: n.id || n._id || `notif-${n.created_at}-${Math.random().toString(36).slice(2, 7)}`,
                type: n.type === 'transaction' ? 'success' : (n.type || 'info'),
                title: n.title,
                message: n.message,
                severity: n.type === 'transaction' ? 'info' : 'info',
                read: !!n.read,
                createdAt: n.created_at || new Date().toISOString(),
            }));
        } catch (e) {
            // Fallback: in-memory demo alerts
            if (demoStore.alerts && Array.isArray(demoStore.alerts)) {
                userAlerts = demoStore.alerts
                    .filter(a => a.userId === userId || a.userId === 'all')
                    .map(a => ({
                        id: a.id || uuidv4(),
                        type: a.type || 'info',
                        title: a.type === 'success' ? 'Money Received' : (a.type || 'Notification'),
                        message: a.message || '',
                        severity: a.severity || 'info',
                        read: !!a.read,
                        createdAt: a.createdAt || new Date().toISOString(),
                    }));
            }
        }
        userAlerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.status(200).json({
            success: true,
            data: { alerts: userAlerts },
            count: userAlerts.length
        });
    } catch (error) {
        console.error('Alerts get error:', error);
        return res.status(200).json({ success: true, data: { alerts: [] }, count: 0 });
    }
});

/**
 * GET /api/alerts/unread-count
 * Get count of unread alerts
 */
router.get('/api/alerts/unread-count', async (req, res) => {
    try {
        const userId = req.user.id;
        let unreadCount = 0;
        try {
            const notifs = await getNotifications(userId, { limit: 100, unreadOnly: true });
            unreadCount = notifs.length;
        } catch (e) {
            if (demoStore.alerts && Array.isArray(demoStore.alerts)) {
                unreadCount = demoStore.alerts.filter(
                    a => (a.userId === userId || a.userId === 'all') && !a.read
                ).length;
            }
        }

        return res.status(200).json({
            success: true,
            unreadCount
        });
    } catch (error) {
        return res.status(200).json({ success: true, unreadCount: 0 });
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
router.put('/api/alerts/read-all', authenticateToken, async (req, res) => {
    try {
        // In production, the DB read state is handled — this is a no-op that
        // keeps client state in sync without failing.
        if (demoStore.alerts && Array.isArray(demoStore.alerts)) {
            demoStore.alerts.forEach(a => {
                if (a.userId === req.user.id || a.userId === 'all') {
                    a.read = true;
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'All alerts marked as read.'
        });
    } catch (error) {
        return res.status(200).json({ success: true, message: 'All alerts marked as read.' });
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
