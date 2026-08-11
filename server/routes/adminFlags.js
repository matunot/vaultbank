/**
 * Admin feature-flag endpoints (Sprint 2)
 * --------------------------------------
 *   GET    /api/admin/flags       list all flags
 *   GET    /api/admin/flags/:key  get one flag
 *   POST   /api/admin/flags       create or update a flag
 *   DELETE /api/admin/flags/:key  delete a flag
 *
 * All routes are admin-only and rate-limited.
 *
 * Example: set the live-providers canary to 5%
 *   curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
 *        -H "Content-Type: application/json" \
 *        -d '{"key":"payments.live_providers_percent","percentage":5}' \
 *        https://vaultbank.vercel.app/api/admin/flags
 */

const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const flags = require('../flags/flags');

const router = express.Router();

router.get('/api/admin/flags', authenticateToken, requireAdmin, adminLimiter, async (req, res) => {
    try {
        const list = await flags.refreshNow();
        return res.status(200).json({ success: true, flags: list });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error listing flags.' });
    }
});

router.get('/api/admin/flags/:key', authenticateToken, requireAdmin, adminLimiter, (req, res) => {
    const f = flags.getFlag(req.params.key);
    if (!f) {
        return res.status(404).json({ success: false, message: 'Flag not found.' });
    }
    return res.status(200).json({ success: true, flag: f });
});

router.post('/api/admin/flags', authenticateToken, requireAdmin, adminLimiter, async (req, res) => {
    try {
        const { key, percentage, enabled, description } = req.body || {};
        if (!key) {
            return res.status(400).json({ success: false, message: 'key is required.' });
        }
        if (typeof percentage !== 'number') {
            return res.status(400).json({ success: false, message: 'percentage must be a number 0..100.' });
        }
        const flag = await flags.setFlag({
            key,
            percentage,
            enabled,
            description,
            updatedBy: (req.user && (req.user.email || req.user.id)) || 'admin',
        });
        return res.status(200).json({ success: true, flag });
    } catch (err) {
        console.error('admin setFlag error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Error setting flag.' });
    }
});

router.delete('/api/admin/flags/:key', authenticateToken, requireAdmin, adminLimiter, async (req, res) => {
    try {
        const { FeatureFlag } = require('../config/db');
        await FeatureFlag.deleteOne({ key: req.params.key });
        return res.status(200).json({ success: true, deleted: req.params.key });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error deleting flag.' });
    }
});

module.exports = router;
