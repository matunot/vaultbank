const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/db');

const router = express.Router();

/**
 * GET /api/aml/flags
 * Retrieve AML flagged transfers.
 * - Admin users see all flagged transfers.
 * - Investors see only their own flagged transfers.
 */
router.get('/api/aml/flags', authenticateToken, async (req, res) => {
    try {
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        let sql = `SELECT id, user_id, transfer_id, reason, flagged_at, reviewed_by, status FROM aml_flags`;
        const params = [];
        if (!isAdmin) {
            sql += ' WHERE user_id = $1';
            params.push(req.user.id);
        }
        const result = await query(sql, params);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('AML flags fetch error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch AML flags.' });
    }
});

/**
 * POST /api/aml/flags
 * Create a new AML flag for a transfer.
 * Accessible by authenticated users (investors) to manually flag a transfer.
 */
router.post('/api/aml/flags', authenticateToken, async (req, res) => {
    const { transferId, reason } = req.body;
    if (!transferId || !reason) {
        return res.status(400).json({ success: false, message: 'transferId and reason are required.' });
    }
    try {
        const result = await query(
            `INSERT INTO aml_flags (user_id, transfer_id, reason) VALUES ($1, $2, $3) RETURNING id, user_id, transfer_id, reason, flagged_at, status`,
            [req.user.id, transferId, reason]
        );
        const flag = result.rows[0];
        // Log audit entry for flag creation
        if (req.logAction) {
            await req.logAction({
                userId: req.user.id,
                action: 'create_aml_flag',
                category: 'aml',
                resourceId: flag.id,
                details: { transferId, reason },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        }
        return res.status(201).json({ success: true, data: flag });
    } catch (error) {
        console.error('AML flag creation error:', error);
        return res.status(500).json({ success: false, message: 'Failed to create AML flag.' });
    }
});

/**
 * Admin endpoint to approve a flagged transfer.
 */
router.put('/api/aml/:flagId/approve', authenticateToken, requireAdmin, async (req, res) => {
    const { flagId } = req.params;
    try {
        const result = await query(
            `UPDATE aml_flags SET status = 'approved', reviewed_by = $1 WHERE id = $2 RETURNING id, status, reviewed_by`,
            [req.user.id, flagId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'AML flag not found.' });
        }
        // Log audit entry for approval
        if (req.logAction) {
            await req.logAction({
                userId: req.user.id,
                action: 'approve_aml_flag',
                category: 'aml',
                resourceId: flagId,
                details: { status: 'approved' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        }
        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('AML approve error:', error);
        return res.status(500).json({ success: false, message: 'Failed to approve AML flag.' });
    }
});

/**
 * Admin endpoint to reject a flagged transfer.
 */
router.put('/api/aml/:flagId/reject', authenticateToken, requireAdmin, async (req, res) => {
    const { flagId } = req.params;
    try {
        const result = await query(
            `UPDATE aml_flags SET status = 'rejected', reviewed_by = $1 WHERE id = $2 RETURNING id, status, reviewed_by`,
            [req.user.id, flagId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'AML flag not found.' });
        }
        // Log audit entry for rejection
        if (req.logAction) {
            await req.logAction({
                userId: req.user.id,
                action: 'reject_aml_flag',
                category: 'aml',
                resourceId: flagId,
                details: { status: 'rejected' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        }
        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('AML reject error:', error);
        return res.status(500).json({ success: false, message: 'Failed to reject AML flag.' });
    }
});

module.exports = router;
