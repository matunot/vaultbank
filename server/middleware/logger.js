const logger = require('../logger');

/**
 * Middleware to log each incoming request and its response status.
 * Logs method, URL, status code, duration, request ID (if provided), and user ID (if authenticated).
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    // When response finishes, log details
    res.on('finish', () => {
        const duration = Date.now() - start;
        const requestId = req.headers['x-request-id'] || '';
        const userId = req.user ? req.user.id : '';
        logger.info('HTTP %s %s %d %dms', req.method, req.originalUrl, res.statusCode, duration, {
            requestId,
            userId,
        });
    });
    next();
}

module.exports = requestLogger;