/**
 * Audit logger middleware for tokenized transfers.
 * Inserts a record into the audit_logs table with details about the transfer.
 * Expected fields: senderId, receiverId, token, amount.
 */
const { query } = require('../config/db');

/**
 * Logs a tokenized transfer audit entry.
 * @param {Object} params
 * @param {string} params.senderId - UUID of the sender (user_id).
 * @param {string} params.receiverId - UUID of the receiver (resource_id).
 * @param {string} params.token - Transfer token (resource_id).
 * @param {number} params.amount - Transfer amount.
 */
async function auditLogger({ senderId, receiverId, token, amount }) {
    try {
        await query(
            `INSERT INTO audit_logs (user_id, action, category, resource_id, details, ip_address, user_agent, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
            [
                senderId,
                'transfer', // action
                'tokenized_transfer', // category
                token, // resource_id stores the token for reference
                JSON.stringify({ receiverId, amount }), // details as JSON
                null, // ip_address (not captured here)
                null, // user_agent (not captured here)
            ]
        );
    } catch (err) {
        console.error('Audit logger error:', err);
        // Swallow error to avoid breaking main flow
    }
}

module.exports = auditLogger;
