/**
 * Audit utility
 * Provides a simple helper to insert audit log entries into the `audit_logs`
 * table. This is used throughout the backend to record important actions
 * such as user login, transfers, etc.
 */

// Import the query helper from the DB configuration
const { query } = require('../config/db');
const fs = require('fs');
const path = require('path');
const { format } = require('@fast-csv/format');

/**
 * Log an audit event.
 *
 * @param {string} userId - UUID of the user performing the action.
 * @param {string} action - Action name (e.g., 'user_login', 'transfer').
 * @param {string} category - Category of the action (e.g., 'login', 'transfer').
 * @returns {Promise<Object|null>} The inserted row (containing the generated id) or null on error.
 */
/**
 * Log an audit event.
 *
 * @param {string} userId - UUID of the user performing the action.
 * @param {string} action - Action name (e.g., 'user_login', 'transfer').
 * @param {string} category - Category of the action (e.g., 'login', 'transfer').
 * @param {number} [amount] - Optional amount for transfer actions.
 * @returns {Promise<Object|null>} The inserted row (containing the generated id) or null on error.
 */
async function logAudit(userId, action, category, amount) {
    try {
        const result = await query(
            `INSERT INTO audit_logs (user_id, action, category)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [userId, action, category]
        );
        // Anomaly detection for user login failures
        if (action === 'user_login') {
            // Check for failed login attempts in the last 10 minutes
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const { rows: failedRows } = await query(
                `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1 AND action = $2 AND timestamp >= $3`,
                [userId, 'login_failed', tenMinutesAgo]
            );
            const failedCount = parseInt(failedRows[0].count, 10);
            if (failedCount > 5) {
                // Insert risk_score_high entry
                await query(
                    `INSERT INTO audit_logs (user_id, action, category, details) VALUES ($1, $2, $3, $4)`,
                    [userId, 'risk_score_high', 'security', JSON.stringify({ failedLogins: failedCount })]
                );
                // Send admin alert email if mailer is available
                try {
                    const mailer = require('../utils/mailer');
                    await mailer.sendAdminAlert(
                        'Risk Score High Detected',
                        `User ${userId} has ${failedCount} failed login attempts in the last 10 minutes.`
                    );
                } catch (mailErr) {
                    console.error('Failed to send admin alert for risk_score_high:', mailErr);
                }
            }
        }
        // Anomaly detection for large transfers
        if (action === 'transfer' && typeof amount === 'number' && amount > 10000) {
            // Insert large_transfer_flag entry
            await query(
                `INSERT INTO audit_logs (user_id, action, category, details) VALUES ($1, $2, $3, $4)`,
                [userId, 'large_transfer_flag', 'transfer', JSON.stringify({ amount })]
            );
            // Send admin alert email if mailer is available
            try {
                const mailer = require('../utils/mailer');
                await mailer.sendAdminAlert(
                    'Large Transfer Detected',
                    `User ${userId} performed a transfer of $${amount}, which exceeds the $10,000 threshold.`
                );
            } catch (mailErr) {
                console.error('Failed to send admin alert for large_transfer_flag:', mailErr);
            }
        }
        return result.rows[0];
    } catch (err) {
        // Log the error but do not disrupt the main flow of the request
        console.error('Audit log error:', err);
        return null;
    }
}

/**
 * Generate an audit report CSV file.
 * @param {Object} filters Optional filters: category, userId, startDate, endDate
 * @returns {Promise<string>} Path to the generated CSV file
 */
async function generateAuditReport(filters = {}) {
    const { category, userId, startDate, endDate } = filters;
    const whereClauses = [];
    const params = [];
    let idx = 1;
    if (category) {
        whereClauses.push(`category = $${idx++}`);
        params.push(category);
    }
    if (userId) {
        whereClauses.push(`user_id = $${idx++}`);
        params.push(userId);
    }
    if (startDate) {
        whereClauses.push(`timestamp >= $${idx++}`);
        params.push(startDate);
    }
    if (endDate) {
        whereClauses.push(`timestamp <= $${idx++}`);
        params.push(endDate);
    }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT 100`;
    const { rows } = await query(sql, params);

    // Ensure reports directory exists
    const reportsDir = path.resolve(__dirname, '..', '..', 'reports');
    await fs.promises.mkdir(reportsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(reportsDir, `audit_report_${timestamp}.csv`);

    const csvStream = format({ headers: true });
    const writable = fs.createWriteStream(filePath);
    csvStream.pipe(writable);
    rows.forEach(row => {
        csvStream.write(row);
    });
    csvStream.end();
    // Wait for the stream to finish
    await new Promise((resolve, reject) => {
        writable.on('finish', resolve);
        writable.on('error', reject);
    });
    return filePath;
}

module.exports = { logAudit, generateAuditReport };
