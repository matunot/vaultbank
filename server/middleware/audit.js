/**
 * Audit middleware utilities
 * Provides a helper to log actions to the audit_logs table.
 * This can be used in any route handler to record an audit entry.
 */

const { query } = require('../config/db');

/**
 * Log an audit action.
 * @param {Object} params
 * @param {string} params.userId - ID of the user performing the action
 * @param {string} params.action - Action name (e.g., 'create_flag')
 @param {string} params.category - Category of the action (e.g., 'aml', 'anomaly')
 * @param {string} [params.resourceId] - Optional related resource ID (e.g., flag ID)
 * @param {Object|string} [params.details] - Additional details (will be stored as JSON)
 * @param {string} [params.ip] - IP address of the request
 * @param {string} [params.userAgent] - User-Agent header
 */
async function logAction({ userId, action, category, resourceId, details, ip, userAgent }) {
    try {
        const result = await query(
            `INSERT INTO audit_logs (user_id, action, category, resource_id, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
                userId,
                action,
                category,
                resourceId || null,
                details ? JSON.stringify(details) : null,
                ip || null,
                userAgent || null,
            ]
        );
        return result.rows[0];
    } catch (err) {
        console.error('Failed to insert audit log:', err);
        // Swallow error to avoid breaking main flow
        return null;
    }
}

module.exports = {
    logAction,
};
