/**
 * Metrics endpoint for Prometheus.
 * Exposes all registered metrics in a format suitable for scraping.
 * Secured with the `requireInvestor` middleware to restrict access to users with the "investor" role.
 */
const express = require('express');
const { client } = require('../metrics');
const requireInvestor = require('../middleware/requireInvestor');

const router = express.Router();

// GET /api/metrics - returns Prometheus metrics
router.get('/api/metrics', requireInvestor, (req, res) => {
    // Set the appropriate content type for Prometheus exposition format
    res.set('Content-Type', client.register.contentType);
    // Send the metrics string
    res.end(client.register.metrics());
});

module.exports = router;