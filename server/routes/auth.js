/**
 * VaultBank Authentication Routes
 * 
 * Real banking authentication with PostgreSQL storage.
 * Supports: Email/Password signup & login, JWT tokens, 2FA, profile management.
 */

const express = require('express');
let bcrypt;
try { bcrypt = require('bcrypt'); } catch (e) { bcrypt = require('bcryptjs'); }
const jwt = require('jsonwebtoken');
const router = express.Router();

const {
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    updateLastLogin,
    findAccountByUserId,
    createAuditLog,
    createNotification,
    getRewards,
    addRewardPoints,
} = require('../config/database');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { authLimiter, signupLimiter } = require('../middleware/rateLimiter');
const { sendVerificationForUser } = require('../services/emailVerificationService');

// Fail closed in production - see middleware/auth.js for the rationale.
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
    ? (() => { console.error('[auth] FATAL: JWT_SECRET is not set - refusing to start in production.'); process.exit(1); })()
    : 'vaultbank-jwt-secret-2025-development');

// ============================================================
// VALIDATION HELPERS
// ============================================================

const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePassword = (password) => {
    return password && password.length >= 8;
};

// ============================================================
// POST /api/auth/signup — Register new user
// ============================================================
const handleSignup = async (req, res) => {
    try {
        const { email, password, fullName, phone } = req.body;

        // Validation
        if (!email || !password || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Email, password, and full name are required.'
            });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address.'
            });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters long.'
            });
        }

        if (fullName.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Full name must be at least 2 characters.'
            });
        }

        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        // Create user (this also auto-creates a bank account)
        const user = await createUser({ email, password, fullName, phone });

        // Send a one-time, 30-minute email verification link when SMTP is
        // configured. Signup remains available if delivery is not configured,
        // but customer fiat rails stay gated on the persisted verification flag.
        let verificationEmailSent = false;
        try {
            const verification = await sendVerificationForUser({
                userId: user.id,
                email: user.email,
                requestIp: req.ip,
            });
            verificationEmailSent = verification.sent === true;
        } catch (verificationError) {
            console.warn('Signup email verification unavailable:', verificationError && verificationError.code ? verificationError.code : 'verification-error');
        }

        // Generate JWT token
        const token = generateToken(user);

        // Get the user's new account
        const account = await findAccountByUserId(user.id);

        // Log the registration
        await createAuditLog({
            userId: user.id,
            action: 'user_registered',
            resourceType: 'user',
            resourceId: user.id,
            details: { email: user.email, method: 'email_password' },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        // Welcome notification
        await createNotification(user.id, {
            type: 'success',
            title: 'Welcome to VaultBank!',
            message: `Hi ${fullName}, your account has been created successfully. Your account number is ${account ? account.account_number : 'pending'}.`
        });

        // Give signup bonus reward points
        await addRewardPoints(user.id, 100, 'Welcome bonus for signing up');

        res.status(201).json({
            success: true,
            message: verificationEmailSent
                ? 'Account created. Check your email to verify your address before using customer fiat rails.'
                : 'Account created. Email verification is required before customer fiat rails can be used; request a verification link from your account when email delivery is configured.',
            verificationEmailSent,
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                phone: user.phone,
                role: user.role,
                subscription: user.subscription,
                kycStatus: user.kyc_status,
                emailVerified: user.email_verified === true,
                createdAt: user.created_at
            },
            account: account ? {
                id: account.id,
                accountNumber: account.account_number,
                accountType: account.account_type,
                balance: parseFloat(account.balance),
                currency: account.currency
            } : null
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed. Please try again.'
        });
    }
};

// Register both the canonical and legacy (no /api/auth prefix) signup routes
router.post('/api/auth/signup', signupLimiter, handleSignup);
router.post('/signup', signupLimiter, handleSignup);

// ============================================================
// POST /api/auth/login — Sign in
// ============================================================
const handleLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        // Find user
        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Check account status
        if (user.status === 'suspended') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been suspended. Please contact support.'
            });
        }

        if (user.status === 'closed') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been closed.'
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            await createAuditLog({
                userId: user.id,
                action: 'login_failed',
                details: { reason: 'invalid_password' },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Check if 2FA is enabled
        if (user.two_fa_enabled) {
            // Return a temporary token that requires 2FA verification
            const tempToken = jwt.sign(
                { id: user.id, requires2FA: true },
                JWT_SECRET,
                { expiresIn: '5m' }
            );
            return res.json({
                success: true,
                requires2FA: true,
                tempToken,
                message: 'Please enter your 2FA code.'
            });
        }

        // Generate full access token
        const token = generateToken(user);

        // Update last login (non-critical — don't fail login if DB write fails)
        try {
            await updateLastLogin(user.id, req.ip);
        } catch (err) {
            console.error('updateLastLogin failed (non-fatal):', err.message);
        }

        // Get account info
        const account = await findAccountByUserId(user.id);

        // Log successful login (non-critical — don't fail login if DB write fails)
        try {
            await createAuditLog({
                userId: user.id,
                action: 'login_success',
                details: { method: 'email_password' },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            });
        } catch (err) {
            console.error('createAuditLog failed (non-fatal):', err.message);
        }

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                phone: user.phone,
                role: user.role,
                subscription: user.subscription,
                kycStatus: user.kyc_status,
                twoFAEnabled: user.two_fa_enabled,
                createdAt: user.created_at
            },
            account: account ? {
                id: account.id,
                accountNumber: account.account_number,
                accountType: account.account_type,
                balance: parseFloat(account.balance),
                availableBalance: parseFloat(account.available_balance),
                currency: account.currency,
                status: account.status
            } : null
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed. Please try again.'
        });
    }
};

// Register both the canonical and legacy (no /api/auth prefix) login routes
router.post('/api/auth/login', authLimiter, handleLogin);
router.post('/login', authLimiter, handleLogin);

// ============================================================
// POST /api/auth/admin/login — Admin login
// ============================================================
router.post('/api/auth/admin/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        if (!['admin', 'super_admin'].includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Admin access required.'
            });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const token = generateToken(user);
        await updateLastLogin(user.id, req.ip);

        res.json({
            success: true,
            message: 'Admin login successful!',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                role: user.role,
                subscription: user.subscription
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed.'
        });
    }
});

// ============================================================
// GET /api/auth/me — Get current user profile
// ============================================================
router.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await findUserById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        const account = await findAccountByUserId(user.id);
        const rewards = await getRewards(user.id);

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                phone: user.phone,
                dateOfBirth: user.date_of_birth,
                address: user.address,
                role: user.role,
                subscription: user.subscription,
                kycStatus: user.kyc_status,
                emailVerified: user.email_verified,
                phoneVerified: user.phone_verified,
                twoFAEnabled: user.two_fa_enabled,
                stripeCustomerId: user.stripe_customer_id,
                createdAt: user.created_at,
                lastLoginAt: user.last_login_at
            },
            account: account ? {
                id: account.id,
                accountNumber: account.account_number,
                accountType: account.account_type,
                accountName: account.account_name,
                balance: parseFloat(account.balance),
                availableBalance: parseFloat(account.available_balance),
                heldBalance: parseFloat(account.held_balance),
                currency: account.currency,
                status: account.status,
                dailyTransferLimit: parseFloat(account.daily_transfer_limit),
                monthlyTransferLimit: parseFloat(account.monthly_transfer_limit),
                openedAt: account.opened_at
            } : null,
            rewards: {
                points: rewards.points,
                tier: rewards.tier,
                lifetimePoints: rewards.lifetime_points
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile.'
        });
    }
});

// ============================================================
// PUT /api/auth/profile — Update profile
// ============================================================
router.put('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        const { fullName, phone, dateOfBirth, address } = req.body;
        const updates = {};

        if (fullName) updates.full_name = fullName;
        if (phone) updates.phone = phone;
        if (dateOfBirth) updates.date_of_birth = dateOfBirth;
        if (address) updates.address = JSON.stringify(address);

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No updates provided.'
            });
        }

        const updatedUser = await updateUser(req.user.id, updates);

        await createAuditLog({
            userId: req.user.id,
            action: 'profile_updated',
            resourceType: 'user',
            resourceId: req.user.id,
            details: { updatedFields: Object.keys(updates) },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            user: {
                id: updatedUser.id,
                email: updatedUser.email,
                fullName: updatedUser.full_name,
                phone: updatedUser.phone
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile.'
        });
    }
});

// ============================================================
// POST /api/auth/change-password — Change password
// ============================================================
router.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current and new passwords are required.'
            });
        }

        if (!validatePassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 8 characters long.'
            });
        }

        const user = await findUserById(req.user.id);
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect.'
            });
        }

        const newHash = await bcrypt.hash(newPassword, 12);
        await updateUser(req.user.id, { password_hash: newHash });

        await createAuditLog({
            userId: req.user.id,
            action: 'password_changed',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        await createNotification(req.user.id, {
            type: 'security',
            title: 'Password Changed',
            message: 'Your password was changed successfully. If you did not make this change, contact support immediately.'
        });

        res.json({
            success: true,
            message: 'Password changed successfully.'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password.'
        });
    }
});

// ============================================================
// POST /api/auth/logout — Client-side logout
// ============================================================
router.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        await createAuditLog({
            userId: req.user.id,
            action: 'logout',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            message: 'Logged out successfully.'
        });
    } catch (error) {
        res.json({ success: true, message: 'Logged out.' });
    }
});

// ============================================================
// Legacy route aliases (backward compatibility)
// ============================================================
// GET /auth/me and GET /api/profile forward to the profile handler.
// These use a direct handler reference (not router.handle) to avoid
// the "argument callback is required" error from re-dispatching.
const handleMe = async (req, res) => {
    try {
        const user = await findUserById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        const account = await findAccountByUserId(user.id);
        const rewards = await getRewards(user.id);

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                phone: user.phone,
                dateOfBirth: user.date_of_birth,
                address: user.address,
                role: user.role,
                subscription: user.subscription,
                kycStatus: user.kyc_status,
                emailVerified: user.email_verified,
                phoneVerified: user.phone_verified,
                twoFAEnabled: user.two_fa_enabled,
                stripeCustomerId: user.stripe_customer_id,
                createdAt: user.created_at,
                lastLoginAt: user.last_login_at
            },
            account: account ? {
                id: account.id,
                accountNumber: account.account_number,
                accountType: account.account_type,
                accountName: account.account_name,
                balance: parseFloat(account.balance),
                availableBalance: parseFloat(account.available_balance),
                heldBalance: parseFloat(account.held_balance),
                currency: account.currency,
                status: account.status,
                dailyTransferLimit: parseFloat(account.daily_transfer_limit),
                monthlyTransferLimit: parseFloat(account.monthly_transfer_limit),
                openedAt: account.opened_at
            } : null,
            rewards: {
                points: rewards.points,
                tier: rewards.tier,
                lifetimePoints: rewards.lifetime_points
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile.'
        });
    }
};

router.get('/auth/me', authenticateToken, handleMe);
router.get('/api/profile', authenticateToken, handleMe);

module.exports = router;
