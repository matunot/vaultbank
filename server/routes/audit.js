const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { demoStore } = require('../config/database');

const router = express.Router();

/**
 * GET /api/audit/logs
 * Get audit logs (admin: all logs, user: own logs)
 */
router.get('/api/audit/logs', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const { limit = 50, page = 1, category, action } = req.query;

        let logs = isAdmin
            ? demoStore.auditLogs
            : demoStore.auditLogs.filter(l => l.userId === userId);

        // Filter by category
        if (category) {
            logs = logs.filter(l => l.category === category);
        }

        // Filter by action
        if (action) {
            logs = logs.filter(l => l.action.includes(action));
        }

        // Sort by newest first
        logs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const startIndex = (pageNum - 1) * limitNum;
        const paginatedLogs = logs.slice(startIndex, startIndex + limitNum);

        return res.status(200).json({
            success: true,
            data: paginatedLogs,
            pagination: {
                total: logs.length,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(logs.length / limitNum)
            }
        });

    } catch (error) {
        console.error('Audit logs error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching audit logs.'
        });
    }
});

/**
 * POST /api/audit/log
 * Create an audit log entry
 */
router.post('/api/audit/log', authenticateToken, (req, res) => {
    try {
        const { action, category, resourceId, details } = req.body;
        const userId = req.user.id;

        if (!action) {
            return res.status(400).json({
                success: false,
                message: 'Action is required.'
            });
        }

        const logEntry = {
            id: uuidv4(),
            userId,
            action,
            category: category || 'general',
            resourceId: resourceId || null,
            details: typeof details === 'object' ? JSON.stringify(details) : details,
            ipAddress: req.ip || '127.0.0.1',
            userAgent: req.headers['user-agent'] || 'unknown',
            timestamp: new Date().toISOString()
        };

        demoStore.auditLogs.push(logEntry);

        return res.status(201).json({
            success: true,
            message: 'Audit log created.',
            data: { log: logEntry }
        });

    } catch (error) {
        console.error('Create audit log error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating audit log.'
        });
    }
});

/**
 * GET /api/audit/logs/compliance
 * Get compliance-related audit logs (admin only)
 */
router.get('/api/audit/logs/compliance', authenticateToken, requireAdmin, (req, res) => {
    try {
        const complianceLogs = demoStore.auditLogs
            .filter(l => l.category === 'compliance' || l.action.includes('aml'))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.status(200).json({
            success: true,
            data: complianceLogs,
            count: complianceLogs.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching compliance logs.' });
    }
});

/**
 * GET /api/audit/stats
 * Get audit statistics
 */
router.get('/api/audit/stats', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

        const logs = isAdmin
            ? demoStore.auditLogs
            : demoStore.auditLogs.filter(l => l.userId === userId);

        const stats = {
            total: logs.length,
            byCategory: {},
            byAction: {},
            recent: logs.slice(-5)
        };

        logs.forEach(l => {
            stats.byCategory[l.category] = (stats.byCategory[l.category] || 0) + 1;
            stats.byAction[l.action] = (stats.byAction[l.action] || 0) + 1;
        });

        return res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching audit stats.' });
    }
});

module.exports = router;
