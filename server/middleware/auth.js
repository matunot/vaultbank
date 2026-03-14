const jwt = require('jsonwebtoken');
const { findUserById, demoStore } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'vaultbank-demo-secret-key-2025';

/**
 * Middleware: Verify JWT token and attach user to request
 */
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        // Handle demo token
        if (token === 'demo-token') {
            req.user = findUserById('demo-user-001') || {
                id: 'demo-user-001',
                email: 'demo@vaultbank.com',
                name: 'Demo User',
                role: 'user',
                subscription: 'trial'
            };
            return next();
        }

        // Verify real JWT
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = findUserById(decoded.id);

        if (!user) {
            // Try creating a minimal user from token data
            req.user = decoded;
        } else {
            req.user = user;
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please log in again.'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token.'
            });
        }
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error.'
        });
    }
};

/**
 * Middleware: Require admin role
 */
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    const adminRoles = ['admin', 'super_admin'];
    if (!adminRoles.includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin role required.'
        });
    }

    next();
};

/**
 * Middleware: Require premium subscription
 */
const requirePremium = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    const premiumSubs = ['premium', 'trial', 'business', 'admin'];
    if (!premiumSubs.includes(req.user.subscription)) {
        return res.status(403).json({
            success: false,
            message: 'This feature requires a Premium subscription.',
            upgradeRequired: true
        });
    }

    next();
};

/**
 * Generate JWT token for a user
 */
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            subscription: user.subscription
        },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

module.exports = {
    authenticateToken,
    requireAdmin,
    requirePremium,
    generateToken
};
