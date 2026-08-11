const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore, findUserById } = require('../config/database');

const router = express.Router();

// Rewards tier thresholds
const REWARD_TIERS = {
    bronze: { min: 0, max: 999, multiplier: 1 },
    silver: { min: 1000, max: 4999, multiplier: 1.5 },
    gold: { min: 5000, max: 9999, multiplier: 2 },
    platinum: { min: 10000, max: Infinity, multiplier: 3 }
};

const getTier = (points) => {
    if (points >= 10000) return 'platinum';
    if (points >= 5000) return 'gold';
    if (points >= 1000) return 'silver';
    return 'bronze';
};

/**
 * POST /api/rewards/earn
 * Earn rewards points for an action
 */
router.post('/api/rewards/earn', authenticateToken, async (req, res) => {
    try {
        const { userId, action, actionId, points, description, metadata, idempotencyKey } = req.body;
        const reqUserId = userId || req.user.id;

        if (!action || !points) {
            return res.status(400).json({
                success: false,
                message: 'Action and points are required.'
            });
        }

        // Check idempotency - prevent duplicate reward
        if (idempotencyKey) {
            const existing = demoStore.rewards.find(r => r.idempotencyKey === idempotencyKey);
            if (existing) {
                return res.status(200).json({
                    success: true,
                    message: 'Reward already processed.',
                    data: { reward: existing, duplicate: true }
                });
            }
        }

        // Get user's current total points
        const userRewards = demoStore.rewards.filter(r => r.userId === reqUserId);
        const currentPoints = userRewards.reduce((sum, r) => sum + (r.points || 0), 0);

        const reward = {
            id: uuidv4(),
            userId: reqUserId,
            action,
            actionId: actionId || uuidv4(),
            points: parseInt(points),
            description: description || `Earned ${points} points for ${action}`,
            metadata: metadata || {},
            idempotencyKey: idempotencyKey || null,
            tier: getTier(currentPoints + parseInt(points)),
            createdAt: new Date().toISOString()
        };

        demoStore.rewards.push(reward);

        // Audit log
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId: reqUserId,
            action: 'rewards_earned',
            category: 'rewards',
            resourceId: reward.id,
            details: JSON.stringify({ points, action }),
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: `Earned ${points} points!`,
            data: {
                reward,
                totalPoints: currentPoints + parseInt(points),
                tier: getTier(currentPoints + parseInt(points))
            }
        });

    } catch (error) {
        console.error('Rewards earn error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing rewards.'
        });
    }
});

/**
 * GET /api/rewards
 * Get user's rewards summary
 */
router.get('/api/rewards', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userRewards = demoStore.rewards.filter(r => r.userId === userId);
        const totalPoints = userRewards.reduce((sum, r) => sum + (r.points || 0), 0);
        const tier = getTier(totalPoints);

        return res.status(200).json({
            success: true,
            data: {
                points: totalPoints,
                tier,
                rewards: userRewards.slice(-20), // Last 20 rewards
                history: userRewards,
                tierProgress: {
                    current: tier,
                    points: totalPoints,
                    nextTier: tier === 'bronze' ? 'silver' : tier === 'silver' ? 'gold' : tier === 'gold' ? 'platinum' : null,
                    pointsToNext: tier === 'bronze' ? 1000 - totalPoints : tier === 'silver' ? 5000 - totalPoints : tier === 'gold' ? 10000 - totalPoints : 0
                }
            }
        });

    } catch (error) {
        console.error('Rewards get error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching rewards.'
        });
    }
});

/**
 * GET /api/rewards/me
 * Get current user's rewards (alias)
 */
router.get('/api/rewards/me', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userRewards = demoStore.rewards.filter(r => r.userId === userId);
        const totalPoints = userRewards.reduce((sum, r) => sum + (r.points || 0), 0);
        const tier = getTier(totalPoints);

        return res.status(200).json({
            success: true,
            data: {
                points: totalPoints,
                tier,
                rewards: userRewards,
                tiers: REWARD_TIERS
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching rewards.' });
    }
});

/**
 * POST /api/rewards/redeem
 * Redeem a promo code
 */
router.post('/api/rewards/redeem', authenticateToken, (req, res) => {
    try {
        const { code } = req.body;
        const userId = req.user.id;

        const validCodes = {
            'PREMIUM2025': { subscription: 'premium', points: 500, message: '🎉 Premium unlocked!' },
            'TRIAL30': { subscription: 'trial', points: 200, message: '🚀 30-day trial activated!' },
            'VAULTBONUS': { points: 1000, message: '💎 1000 bonus points added!' },
            'WELCOME500': { points: 500, message: '🎁 Welcome bonus: 500 points!' }
        };

        const codeData = validCodes[code?.toUpperCase()];

        if (!codeData) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired promo code.'
            });
        }

        // Add points if applicable
        if (codeData.points) {
            demoStore.rewards.push({
                id: uuidv4(),
                userId,
                action: 'promo_code',
                actionId: code,
                points: codeData.points,
                description: `Promo code: ${code}`,
                idempotencyKey: `promo-${code}-${userId}`,
                createdAt: new Date().toISOString()
            });
        }

        return res.status(200).json({
            success: true,
            message: codeData.message,
            data: {
                subscription: codeData.subscription || null,
                pointsAdded: codeData.points || 0
            }
        });

    } catch (error) {
        console.error('Redeem error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error redeeming code.'
        });
    }
});

/**
 * GET /api/rewards/leaderboard
 * Get rewards leaderboard
 */
router.get('/api/rewards/leaderboard', authenticateToken, (req, res) => {
    try {
        // Build leaderboard from demoStore
        const userPointsMap = {};
        demoStore.rewards.forEach(r => {
            if (!userPointsMap[r.userId]) userPointsMap[r.userId] = 0;
            userPointsMap[r.userId] += r.points || 0;
        });

        const leaderboard = Object.entries(userPointsMap)
            .map(([userId, points]) => {
                const user = findUserById(userId);
                return {
                    userId,
                    name: user?.name || 'Anonymous',
                    points,
                    tier: getTier(points)
                };
            })
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);

        return res.status(200).json({
            success: true,
            data: { leaderboard }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching leaderboard.' });
    }
});

module.exports = router;
