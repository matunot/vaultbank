const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { findUserByEmail, findUserById, demoStore } = require('../config/database');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { authLimiter, signupLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * POST /signup
 * Register a new user
 */
router.post('/signup', signupLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long.'
            });
        }

        // Check if user already exists
        const existingUser = findUserByEmail(email);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        // Hash password
        // Use stronger salt rounds for better security (12 rounds)
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create new user
        const newUser = {
            id: uuidv4(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            name: name || email.split('@')[0],
            role: 'user',
            balance: 0,
            subscription: 'free',
            transactions: [],
            summary: { totalIncome: 0, totalExpenses: 0, netSavings: 0 },
            goals: [],
            createdAt: new Date().toISOString()
        };

        // Save to demo store
        demoStore.users.push(newUser);

        // Generate token
        const token = generateToken(newUser);

        // Add audit log
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: newUser.id,
            action: 'user_registered',
            category: 'auth',
            details: JSON.stringify({ email: newUser.email }),
            timestamp: new Date().toISOString()
        });

        const { password: _, ...userWithoutPassword } = newUser;

        return res.status(201).json({
            success: true,
            message: 'Account created successfully!',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during registration.'
        });
    }
});

/**
 * POST /login
 * Authenticate user and return token
 */
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        // Find user
        const user = findUserByEmail(email);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Verify password
        let passwordValid = false;

        // Allow demo passwords
        if (password === 'password' || password === 'demo' || password === 'admin123') {
            passwordValid = true;
        } else {
            passwordValid = await bcrypt.compare(password, user.password);
        }

        if (!passwordValid) {
            // Log failed attempt
            demoStore.auditLogs.push({
                id: uuidv4(),
                userId: user.id,
                action: 'login_failed',
                category: 'auth',
                details: JSON.stringify({ email }),
                timestamp: new Date().toISOString()
            });

            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Generate token or require 2FA verification
        if (user.twoFAEnabled) {
            // 2FA is enabled for this user. Respond indicating that a second factor is required.
            // The client should prompt the user for a TOTP code and then call the verification endpoint.
            return res.status(200).json({
                success: true,
                message: '2FA required',
                twoFARequired: true,
                userId: user.id
            });
        }

        // No 2FA required – issue JWT token immediately.
        const token = generateToken(user);

        // Log successful login
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: user.id,
            action: 'user_login',
            category: 'auth',
            details: JSON.stringify({ email }),
            timestamp: new Date().toISOString()
        });

        const { password: _, ...userWithoutPassword } = user;

        return res.status(200).json({
            success: true,
            message: 'Login successful!',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during login.'
        });
    }
});

/**
 * POST /api/auth/register
 * Register a new user (alias for /signup for API consumers)
 */
router.post('/api/auth/register', signupLimiter, async (req, res) => {
    // Reuse the signup logic by delegating to the existing handler
    // This keeps validation and audit logging consistent.
    // Create a mock request/response flow by calling the same code path.
    // For simplicity, we duplicate the essential logic here.
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
        }
        const existingUser = findUserByEmail(email);
        if (existingUser) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
        }
        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = {
            id: uuidv4(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            name: name || email.split('@')[0],
            role: 'user',
            balance: 0,
            subscription: 'free',
            transactions: [],
            summary: { totalIncome: 0, totalExpenses: 0, netSavings: 0 },
            goals: [],
            createdAt: new Date().toISOString(),
            // 2FA defaults (already present in demoStore schema)
            twoFAEnabled: false,
            twoFASecret: null,
            backupCodes: []
        };
        demoStore.users.push(newUser);
        const token = generateToken(newUser);
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: newUser.id,
            action: 'user_registered',
            category: 'auth',
            details: JSON.stringify({ email: newUser.email }),
            timestamp: new Date().toISOString()
        });
        const { password: _, ...userWithoutPassword } = newUser;
        return res.status(201).json({ success: true, message: 'Account created successfully!', token, user: userWithoutPassword });
    } catch (error) {
        console.error('Register error:', error);
        return res.status(500).json({ success: false, message: 'An error occurred during registration.' });
    }
});

/**
 * POST /api/auth/login
 * User login endpoint that supports optional 2FA.
 * If the user has 2FA enabled, the response will indicate that a second factor is required.
 */
router.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }
        const user = findUserByEmail(email);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
        // Verify password (allow demo shortcuts)
        let passwordValid = false;
        if (password === 'password' || password === 'demo' || password === 'admin123') {
            passwordValid = true;
        } else {
            passwordValid = await bcrypt.compare(password, user.password);
        }
        if (!passwordValid) {
            demoStore.auditLogs.push({
                id: uuidv4(),
                userId: user.id,
                action: 'login_failed',
                category: 'auth',
                details: JSON.stringify({ email }),
                timestamp: new Date().toISOString()
            });
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
        // If 2FA is enabled, require verification step
        if (user.twoFAEnabled) {
            return res.status(200).json({ success: true, message: '2FA required', twoFARequired: true, userId: user.id });
        }
        // No 2FA – issue token
        const token = generateToken(user);
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: user.id,
            action: 'user_login',
            category: 'auth',
            details: JSON.stringify({ email }),
            timestamp: new Date().toISOString()
        });
        const { password: _, ...userWithoutPassword } = user;
        return res.status(200).json({ success: true, message: 'Login successful!', token, user: userWithoutPassword });
    } catch (error) {
        console.error('API login error:', error);
        return res.status(500).json({ success: false, message: 'An error occurred during login.' });
    }
});

/**
 * POST /api/auth/setup-2fa
 * Generate a TOTP secret, QR code and backup codes for the authenticated user.
 * The user must be logged in (authenticateToken middleware).
 */
router.post('/api/auth/setup-2fa', authenticateToken, async (req, res) => {
    try {
        const user = demoStore.users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        // Generate secret
        const secret = speakeasy.generateSecret({ name: `VaultBank (${user.email})` });
        // Generate QR code data URL
        const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
        // Generate simple numeric backup codes (5 codes)
        const backupCodes = Array.from({ length: 5 }, () => Math.floor(10000000 + Math.random() * 90000000).toString());
        // Store secret and backup codes (2FA not yet enabled until verification)
        user.twoFASecret = secret.base32;
        user.backupCodes = backupCodes;
        // Respond with QR code and backup codes
        return res.status(200).json({ success: true, qrCode: qrDataUrl, backupCodes });
    } catch (error) {
        console.error('Setup 2FA error:', error);
        return res.status(500).json({ success: false, message: 'Failed to set up 2FA.' });
    }
});

/**
 * POST /api/auth/verify-2fa
 * Verify a TOTP code (or backup code) for a user during login or setup.
 * Expected payload: { userId, code }
 */
router.post('/api/auth/verify-2fa', async (req, res) => {
    try {
        const { userId, code } = req.body;
        if (!userId || !code) {
            return res.status(400).json({ success: false, message: 'userId and code are required.' });
        }
        const user = demoStore.users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        // First try TOTP verification
        const verified = speakeasy.totp.verify({
            secret: user.twoFASecret,
            encoding: 'base32',
            token: code,
            window: 1
        });
        if (verified) {
            // Enable 2FA if not already enabled
            if (!user.twoFAEnabled) user.twoFAEnabled = true;
            const token = generateToken(user);
            return res.status(200).json({ success: true, token, message: '2FA verification successful.' });
        }
        // If not verified, check backup codes
        const backupIndex = user.backupCodes.findIndex(b => b === code);
        if (backupIndex !== -1) {
            // Invalidate used backup code
            user.backupCodes.splice(backupIndex, 1);
            if (!user.twoFAEnabled) user.twoFAEnabled = true;
            const token = generateToken(user);
            return res.status(200).json({ success: true, token, message: 'Backup code accepted.' });
        }
        return res.status(401).json({ success: false, message: 'Invalid verification code.' });
    } catch (error) {
        console.error('Verify 2FA error:', error);
        return res.status(500).json({ success: false, message: 'Failed to verify 2FA.' });
    }
});

/**
 * POST /api/auth/disable-2fa
 * Disable 2FA for the authenticated user after verifying a code.
 */
router.post('/api/auth/disable-2fa', authenticateToken, async (req, res) => {
    try {
        const { code } = req.body;
        const user = demoStore.users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        // Verify using TOTP or backup code (same logic as verify)
        const verified = speakeasy.totp.verify({
            secret: user.twoFASecret,
            encoding: 'base32',
            token: code,
            window: 1
        });
        const backupIndex = user.backupCodes.findIndex(b => b === code);
        if (verified || backupIndex !== -1) {
            if (backupIndex !== -1) user.backupCodes.splice(backupIndex, 1);
            user.twoFAEnabled = false;
            user.twoFASecret = null;
            user.backupCodes = [];
            return res.status(200).json({ success: true, message: '2FA disabled.' });
        }
        return res.status(401).json({ success: false, message: 'Invalid verification code.' });
    } catch (error) {
        console.error('Disable 2FA error:', error);
        return res.status(500).json({ success: false, message: 'Failed to disable 2FA.' });
    }
});

/**
 * POST /api/auth/login
 * Admin login endpoint
 */
router.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        const user = findUserByEmail(email);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        // Check admin role
        if (!['admin', 'super_admin'].includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin credentials required.'
            });
        }

        let passwordValid = false;
        if (password === 'admin123' || password === 'password') {
            passwordValid = true;
        } else {
            passwordValid = await bcrypt.compare(password, user.password);
        }

        if (!passwordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        const token = generateToken(user);

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: user.id,
            action: 'admin_login',
            category: 'auth',
            details: JSON.stringify({ email }),
            timestamp: new Date().toISOString()
        });

        const { password: _, ...userWithoutPassword } = user;

        return res.status(200).json({
            success: true,
            message: 'Admin login successful!',
            token,
            user: userWithoutPassword
        });

    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Login error.'
        });
    }
});

/**
 * GET /auth/me
 * Get current authenticated user (legacy endpoint)
 */
router.get('/auth/me', authenticateToken, (req, res) => {
    try {
        const user = findUserById(req.user.id) || req.user;
        const { password: _, ...userWithoutPassword } = user;

        return res.status(200).json({
            success: true,
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Get user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching user data.'
        });
    }
});

/**
 * GET /api/profile
 * Get current user profile (new endpoint)
 */
router.get('/api/profile', authenticateToken, (req, res) => {
    try {
        const user = findUserById(req.user.id) || req.user;
        const { password: _, ...userWithoutPassword } = user;

        return res.status(200).json({
            success: true,
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching profile.'
        });
    }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token invalidation)
 */
router.post('/api/auth/logout', authenticateToken, (req, res) => {
    demoStore.auditLogs.push({
        id: uuidv4(),
        userId: req.user.id,
        action: 'user_logout',
        category: 'auth',
        details: JSON.stringify({ email: req.user.email }),
        timestamp: new Date().toISOString()
    });

    return res.status(200).json({
        success: true,
        message: 'Logged out successfully.'
    });
});

module.exports = router;
