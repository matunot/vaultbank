/**
 * Compliance CSV export route
 * Generates a CSV file containing AML flags, anomaly detections, and audit logs.
 * Protected by the `requireInvestor` middleware – only users with the "investor" role can download.
 */

const express = require('express');
const { query } = require('../config/db');
const requireInvestor = require('../middleware/requireInvestor');
const { getFlaggedTransfers } = require('../anomaly');
const { format } = require('@fast-csv/format');

const router = express.Router();

/**
 * GET /api/reports/compliance
 * Returns a CSV file with the following sections (type column distinguishes rows):
 *   - aml_flag
 *   - anomaly
 *   - audit_log
 */
router.get('/api/reports/compliance', requireInvestor, async (req, res) => {
    try {
        // Fetch data from the database in parallel
        const [amlResult, auditResult] = await Promise.all([
            query(`SELECT id, user_id, transfer_id, reason, flagged_at, reviewed_by, status FROM aml_flags`, []),
            query(`SELECT id, user_id, action, category, resource_id, details, ip_address, user_agent, timestamp FROM audit_logs`, [])
        ]);

        // In‑memory anomalies
        const anomalies = getFlaggedTransfers();

        // Set CSV download headers
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="compliance_report.csv"');

        const csvStream = format({ headers: true });
        csvStream.pipe(res);

        // Write AML flags
        amlResult.rows.forEach(row => {
            csvStream.write({
                type: 'aml_flag',
                id: row.id,
                user_id: row.user_id,
                transfer_id: row.transfer_id,
                reason: row.reason,
                flagged_at: row.flagged_at,
                reviewed_by: row.reviewed_by,
                status: row.status
            });
        });

        // Write anomalies (in‑memory)
        anomalies.forEach(item => {
            csvStream.write({
                type: 'anomaly',
                user_id: item.userId,
                amount: item.amount,
                method: item.method,
                timestamp: new Date(item.timestamp).toISOString(),
                reason: item.reason
            });
        });

        // Write audit logs
        auditResult.rows.forEach(row => {
            csvStream.write({
                type: 'audit_log',
                id: row.id,
                user_id: row.user_id,
                action: row.action,
                category: row.category,
                resource_id: row.resource_id,
                details: row.details ? JSON.stringify(row.details) : '',
                ip_address: row.ip_address,
                user_agent: row.user_agent,
                timestamp: row.timestamp
            });
        });

        csvStream.end();
    } catch (error) {
        console.error('Compliance report generation error:', error);
        return res.status(500).json({ success: false, message: 'Failed to generate compliance report.' });
    }
});

module.exports = router;
