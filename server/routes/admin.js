const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const { demoStore, findUserById } = require('../config/database');

const router = express.Router();

/**
 * GET /api/admin/stats
 * Get system-wide statistics
 */
router.get('/api/admin/stats', authenticateToken, requireAdmin, adminLimiter, (req, res) => {
    try {
        const stats = {
            users: {
                total: demoStore.users.length,
                premium: demoStore.users.filter(u => ['premium', 'trial'].includes(u.subscription)).length,
                free: demoStore.users.filter(u => u.subscription === 'free').length,
                admins: demoStore.users.filter(u => ['admin', 'super_admin'].includes(u.role)).length,
                newToday: demoStore.users.filter(u => {
                    const created = new Date(u.createdAt);
                    const today = new Date();
                    return created.toDateString() === today.toDateString();
                }).length
            },
            transactions: {
                total: demoStore.users.reduce((sum, u) => sum + (u.transactions?.length || 0), 0),
                transfers: demoStore.users.reduce((sum, u) => sum + (u.transactions?.filter(t => t.category === 'transfer').length || 0), 0)
            },
            businesses: {
                total: demoStore.businesses.length,
                active: demoStore.businesses.filter(b => b.status === 'active').length
            },
            investments: {
                total: demoStore.investments.length,
                totalValue: demoStore.investments.reduce((sum, i) => sum + (i.currentValue || 0), 0)
            },
            alerts: {
                total: demoStore.alerts.length,
                unread: demoStore.alerts.filter(a => !a.read).length,
                critical: demoStore.alerts.filter(a => a.severity === 'critical').length
            },
            auditLogs: {
                total: demoStore.auditLogs.length,
                today: demoStore.auditLogs.filter(l => {
                    const ts = new Date(l.timestamp);
                    const today = new Date();
                    return ts.toDateString() === today.toDateString();
                }).length
            },
            rewards: {
                totalPointsIssued: demoStore.rewards.reduce((sum, r) => sum + (r.points || 0), 0),
                totalTransactions: demoStore.rewards.length
            }
        };

        return res.status(200).json({
            success: true,
            data: stats,
            generatedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Admin stats error:', error);
        return res.status(500).json({ success: false, message: 'Error fetching admin stats.' });
    }
});

/**
 * GET /api/admin/users
 * Get all users
 */
router.get('/api/admin/users', authenticateToken, requireAdmin, adminLimiter, (req, res) => {
    try {
        const { page = 1, limit = 20, search, role, subscription } = req.query;

        let users = demoStore.users.map(u => {
            const { password, ...userWithoutPwd } = u;
            return userWithoutPwd;
        });

        // Filter
        if (search) {
            const searchLower = search.toLowerCase();
            users = users.filter(u =>
                u.email.toLowerCase().includes(searchLower) ||
                (u.name || '').toLowerCase().includes(searchLower)
            );
        }
        if (role) users = users.filter(u => u.role === role);
        if (subscription) users = users.filter(u => u.subscription === subscription);

        // Pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const startIndex = (pageNum - 1) * limitNum;
        const paginated = users.slice(startIndex, startIndex + limitNum);

        return res.status(200).json({
            success: true,
            data: { users: paginated },
            pagination: {
                total: users.length,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(users.length / limitNum)
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching users.' });
    }
});

/**
 * GET /api/admin/users/:id
 * Get a specific user (admin)
 */
router.get('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    try {
        const user = findUserById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        const { password, ...userWithoutPwd } = user;

        return res.status(200).json({
            success: true,
            data: { user: userWithoutPwd }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching user.' });
    }
});

/**
 * PUT /api/admin/users/:id/suspend
 * Suspend a user
 */
router.put('/api/admin/users/:id/suspend', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const userIndex = demoStore.users.findIndex(u => u.id === id);
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        demoStore.users[userIndex].status = 'suspended';
        demoStore.users[userIndex].suspendedAt = new Date().toISOString();
        demoStore.users[userIndex].suspendReason = reason || 'Admin action';

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: req.user.id,
            action: 'user_suspended',
            category: 'admin',
            resourceId: id,
            details: JSON.stringify({ targetUser: id, reason }),
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: 'User suspended successfully.'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error suspending user.' });
    }
});

/**
 * PUT /api/admin/users/:id/subscription
 * Update user subscription
 */
router.put('/api/admin/users/:id/subscription', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { subscription } = req.body;

        const validSubs = ['free', 'trial', 'premium', 'business', 'admin'];
        if (!validSubs.includes(subscription)) {
            return res.status(400).json({ success: false, message: 'Invalid subscription tier.' });
        }

        const userIndex = demoStore.users.findIndex(u => u.id === id);
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        demoStore.users[userIndex].subscription = subscription;

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: req.user.id,
            action: 'rule_change',
            category: 'admin',
            resourceId: id,
            details: JSON.stringify({ targetUser: id, subscription }),
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: `User subscription updated to ${subscription}.`
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error updating subscription.' });
    }
});

/**
 * GET /api/admin/transactions
 * Get all transactions across all users
 */
router.get('/api/admin/transactions', authenticateToken, requireAdmin, (req, res) => {
    try {
        const allTransactions = demoStore.users.flatMap(u =>
            (u.transactions || []).map(t => ({
                ...t,
                userEmail: u.email,
                userName: u.name
            }))
        ).sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({
            success: true,
            data: { transactions: allTransactions },
            count: allTransactions.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching transactions.' });
    }
});

/**
 * GET /api/admin/aml-alerts
 * Get AML/compliance alerts
 */
router.get('/api/admin/aml-alerts', authenticateToken, requireAdmin, (req, res) => {
    try {
        const amlAlerts = demoStore.alerts.filter(a => a.type === 'aml' || a.severity === 'critical');
        const amlLogs = demoStore.auditLogs.filter(l => l.action === 'aml_alert' || l.category === 'compliance');

        return res.status(200).json({
            success: true,
            data: {
                alerts: amlAlerts,
                logs: amlLogs,
                total: amlAlerts.length
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching AML alerts.' });
    }
});

/**
 * GET /api/admin/notifications
 * Get system notifications
 */
router.get('/api/admin/notifications', authenticateToken, requireAdmin, (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            data: {
                notifications: demoStore.notifications.slice(-50),
                count: demoStore.notifications.length
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching notifications.' });
    }
});

/**
 * POST /api/admin/broadcast
 * Broadcast notification to all users
 */
router.post('/api/admin/broadcast', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { message, type, severity } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: 'Message is required.' });
        }

        const notification = {
            id: uuidv4(),
            userId: 'all',
            type: type || 'broadcast',
            message,
            severity: severity || 'info',
            read: false,
            sentBy: req.user.id,
            createdAt: new Date().toISOString()
        };

        demoStore.alerts.push(notification);
        demoStore.notifications.push(notification);

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: req.user.id,
            action: 'broadcast_sent',
            category: 'admin',
            details: JSON.stringify({ message }),
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: 'Broadcast sent to all users.',
            data: { notification }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error broadcasting.' });
    }
});

module.exports = router;
