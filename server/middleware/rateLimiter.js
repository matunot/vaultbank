const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter
 */
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests. Please try again in 15 minutes.',
        retryAfter: 900
    },
    skip: (req) => {
        // Skip rate limiting for health check
        return req.path === '/health';
    }
});

/**
 * Strict rate limiter for auth endpoints
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many login attempts. Please wait 15 minutes before trying again.',
        retryAfter: 900
    }
});

/**
 * Transfer rate limiter
 */
const transferLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many transfer requests. Please wait 1 minute.',
        retryAfter: 60
    }
});

/**
 * Signup rate limiter
 */
const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many signup attempts. Please wait 1 hour.',
        retryAfter: 3600
    }
});

/**
 * Admin action rate limiter
 */
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many admin requests. Please slow down.',
        retryAfter: 900
    }
});

module.exports = {
    generalLimiter,
    authLimiter,
    transferLimiter,
    signupLimiter,
    adminLimiter
};
