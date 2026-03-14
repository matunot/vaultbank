const express = require('express');
const bcrypt = require('bcryptjs');
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
        const hashedPassword = await bcrypt.hash(password, 10);

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

        // Generate token
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
