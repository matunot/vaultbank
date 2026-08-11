/**
 * Simple in‑memory anomaly detection module.
 * Uses `simple-statistics` to compute basic statistical thresholds on recent
 * transfer amounts per user and also checks for unusually high transfer
 * frequency (e.g., many transfers within a short time window).
 *
 * This is a lightweight implementation suitable for a demo environment.
 * In production you would likely replace this with a proper ML model (e.g.,
 * TensorFlow.js) and persistent storage.
 */

const ss = require('simple-statistics');

// Configuration – can be tuned as needed
const MAX_HISTORY = 50; // number of recent transfers to keep per user
const Z_SCORE_THRESHOLD = 3; // flag if amount is > 3 standard deviations from mean
const FREQUENCY_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_TRANSFERS_PER_WINDOW = 5; // flag if more than 5 transfers in the window

// In‑memory store: userId => { transfers: [{ amount, timestamp }], flagged: [] }
const store = {};

/**
 * Record a transfer for a user.
 * @param {string} userId
 * @param {number} amount
 * @param {string} method
 * @returns {object} { isAnomaly: boolean, reason?: string }
 */
function checkAnomaly({ userId, amount, method }) {
    const now = Date.now();
    if (!store[userId]) {
        store[userId] = { transfers: [], flagged: [] };
    }
    const userData = store[userId];

    // Add current transfer to history
    userData.transfers.push({ amount, timestamp: now, method });
    // Trim history to MAX_HISTORY entries
    if (userData.transfers.length > MAX_HISTORY) {
        userData.transfers.shift();
    }

    // Frequency check: count transfers in the last FREQUENCY_WINDOW_MS
    const recentTransfers = userData.transfers.filter(
        (t) => now - t.timestamp <= FREQUENCY_WINDOW_MS
    );
    if (recentTransfers.length > MAX_TRANSFERS_PER_WINDOW) {
        const reason = `High transfer frequency: ${recentTransfers.length} transfers in the last minute`;
        userData.flagged.push({ userId, amount, method, timestamp: now, reason });
        return { isAnomaly: true, reason };
    }

    // Amount statistical check – need at least 5 data points for meaningful stats
    if (userData.transfers.length >= 5) {
        const amounts = userData.transfers.map((t) => t.amount);
        const mean = ss.mean(amounts);
        const std = ss.standardDeviation(amounts);
        if (std > 0) {
            const z = Math.abs((amount - mean) / std);
            if (z > Z_SCORE_THRESHOLD) {
                const reason = `Amount outlier (z‑score ${z.toFixed(2)})`;
                userData.flagged.push({ userId, amount, method, timestamp: now, reason });
                return { isAnomaly: true, reason };
            }
        }
    }

    return { isAnomaly: false };
}

/**
 * Retrieve all flagged transfers.
 * @returns {Array} List of flagged transfer objects.
 */
function getFlaggedTransfers() {
    const all = [];
    for (const userId of Object.keys(store)) {
        const { flagged } = store[userId];
        if (flagged && flagged.length) {
            all.push(...flagged);
        }
    }
    // Sort by timestamp descending (most recent first)
    return all.sort((a, b) => b.timestamp - a.timestamp);
}

module.exports = {
    checkAnomaly,
    getFlaggedTransfers,
};
