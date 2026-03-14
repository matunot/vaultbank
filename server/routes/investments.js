const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore, findUserById } = require('../config/database');

const router = express.Router();

/**
 * POST /api/investments/add
 * Add a new investment
 */
router.post('/api/investments/add', authenticateToken, (req, res) => {
    try {
        const { symbol, assetType, name, quantity, purchasePrice, amountInvested } = req.body;
        const userId = req.user.id;

        if (!symbol || !assetType || !quantity || !purchasePrice) {
            return res.status(400).json({
                success: false,
                message: 'Symbol, asset type, quantity, and purchase price are required.'
            });
        }

        const investment = {
            id: uuidv4(),
            _id: uuidv4(),
            userId,
            symbol: symbol.toUpperCase(),
            assetType,
            name: name || symbol,
            quantity: parseFloat(quantity),
            purchasePrice: parseFloat(purchasePrice),
            currentPrice: parseFloat(purchasePrice), // Initially same as purchase
            amountInvested: parseFloat(amountInvested || (quantity * purchasePrice)),
            currentValue: parseFloat(quantity) * parseFloat(purchasePrice),
            gainLoss: 0,
            gainLossPercent: 0,
            status: 'active',
            purchaseDate: new Date().toISOString().split('T')[0],
            createdAt: new Date().toISOString()
        };

        demoStore.investments.push(investment);

        // Audit log
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'investment_added',
            category: 'financial',
            resourceId: investment.id,
            details: JSON.stringify({ symbol, assetType, quantity, purchasePrice }),
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: `Investment in ${symbol} added successfully.`,
            data: { investment }
        });

    } catch (error) {
        console.error('Investment add error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error adding investment.'
        });
    }
});

/**
 * GET /api/investments/me
 * Get user's investment portfolio
 */
router.get('/api/investments/me', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userInvestments = demoStore.investments.filter(i => i.userId === userId);

        const totalInvested = userInvestments.reduce((sum, i) => sum + (i.amountInvested || 0), 0);
        const currentValue = userInvestments.reduce((sum, i) => sum + (i.currentValue || 0), 0);
        const totalGainLoss = currentValue - totalInvested;
        const totalGainLossPercent = totalInvested > 0 ? ((totalGainLoss / totalInvested) * 100) : 0;

        return res.status(200).json({
            success: true,
            data: {
                investments: userInvestments,
                portfolio: {
                    totalInvested,
                    currentValue,
                    totalGainLoss,
                    totalGainLossPercent,
                    count: userInvestments.length
                }
            }
        });
    } catch (error) {
        console.error('Get investments error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching portfolio.'
        });
    }
});

/**
 * GET /api/investments
 * Get all investments (admin) or user's own
 */
router.get('/api/investments', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

        const investments = isAdmin
            ? demoStore.investments
            : demoStore.investments.filter(i => i.userId === userId);

        return res.status(200).json({
            success: true,
            data: { investments },
            count: investments.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching investments.' });
    }
});

/**
 * PUT /api/investments/:id
 * Update investment (e.g., update current price)
 */
router.put('/api/investments/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const { currentPrice } = req.body;
        const userId = req.user.id;

        const invIndex = demoStore.investments.findIndex(i => i.id === id && i.userId === userId);
        if (invIndex === -1) {
            return res.status(404).json({ success: false, message: 'Investment not found.' });
        }

        if (currentPrice) {
            const inv = demoStore.investments[invIndex];
            inv.currentPrice = parseFloat(currentPrice);
            inv.currentValue = inv.quantity * parseFloat(currentPrice);
            inv.gainLoss = inv.currentValue - inv.amountInvested;
            inv.gainLossPercent = ((inv.gainLoss / inv.amountInvested) * 100);
            inv.updatedAt = new Date().toISOString();
        }

        return res.status(200).json({
            success: true,
            message: 'Investment updated.',
            data: { investment: demoStore.investments[invIndex] }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error updating investment.' });
    }
});

/**
 * DELETE /api/investments/:id
 * Remove an investment (sell)
 */
router.delete('/api/investments/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const index = demoStore.investments.findIndex(i => i.id === id && i.userId === userId);
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Investment not found.' });
        }

        const removed = demoStore.investments.splice(index, 1)[0];

        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'investment_sold',
            category: 'financial',
            resourceId: id,
            details: JSON.stringify({ symbol: removed.symbol }),
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            success: true,
            message: `Investment in ${removed.symbol} removed.`
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error removing investment.' });
    }
});

module.exports = router;
