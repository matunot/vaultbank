/**
 * Anomalies route – returns a list of flagged transfers detected by the
 * simple in‑memory anomaly detection module.
 *
 * The route is protected with the `requireInvestor` middleware so that only
 * users with the "investor" role can view the data (as per the existing
 * metrics endpoint).
 */

const express = require('express');
const { getFlaggedTransfers } = require('../anomaly');
const requireInvestor = require('../middleware/requireInvestor');

const router = express.Router();

/**
 * GET /api/anomalies
 * Returns an array of flagged transfer objects. Each object contains:
 *   - userId
 *   - amount
 *   - method
 *   - timestamp (ms since epoch)
 *   - reason (string describing why it was flagged)
 */
router.get('/api/anomalies', requireInvestor, (req, res) => {
    try {
        const flagged = getFlaggedTransfers();
        return res.status(200).json({
            success: true,
            data: { anomalies: flagged },
        });
    } catch (err) {
        console.error('Anomalies fetch error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch anomalies' });
    }
});

module.exports = router;
