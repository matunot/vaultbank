/**
 * VaultBank Chain — outbound crypto withdrawals. YOUR wallet, YOUR rail.
 *
 * POST /api/usdc/withdraw — send USDC/USDT to ANY wallet on Base/Polygon.
 * Signed + broadcast by the VaultBank hot wallet via public RPC. No processor.
 *
 * Env: USDC_HOT_WALLET_KEY (0x…64 hex). Without it: 503 + how-to.
 * Safety: atomic balance debit, daily per-user limit, idempotent records,
 * auto-refund on broadcast failure, hot-wallet low-balance alerts to admins.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    db,
    isDemo,
    findAccountByUserId,
    createTransaction,
    createNotification,
} = require('../config/database');
const chain = require('../payments/usdc-hotwallet');

const DAILY_LIMIT = parseFloat(process.env.USDC_DAILY_LIMIT || '10000');

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS usdc_withdrawals (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL,
            account_id UUID NOT NULL,
            network TEXT NOT NULL,
            token TEXT NOT NULL,
            to_address TEXT NOT NULL,
            amount NUMERIC(15,2) NOT NULL,
            tx_hash TEXT,
            status TEXT NOT NULL DEFAULT 'broadcast' CHECK (status IN ('broadcast','failed')),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    tablesReady = true;
}

// GET /api/usdc/withdraw-status — hot wallet config + balances
router.get('/api/usdc/withdraw-status', authenticateToken, async (req, res) => {
    try {
        const wallet = chain.getHotWallet();
        if (!wallet) {
            return res.json({
                success: true,
                configured: false,
                message: 'Set USDC_HOT_WALLET_KEY (0x + 64 hex chars) in Render to enable chain withdrawals.',
            });
        }
        const base = await chain.getHotWalletBalances('base', wallet.address);
        res.json({
            success: true,
            configured: true,
            walletAddress: wallet.address,
            base,
            dailyLimit: DAILY_LIMIT,
        });
    } catch (error) {
        console.error('usdc withdraw-status error:', error.message);
        res.json({ success: true, configured: true, walletAddress: null, rpcError: error.message });
    }
});

// POST /api/usdc/withdraw — send USDC/USDT to any wallet
router.post('/api/usdc/withdraw', authenticateToken, async (req, res) => {
    const wallet = chain.getHotWallet();
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'Chain withdrawals need a live account.' });
        await ensureTables();
        if (!wallet) {
            return res.status(503).json({
                success: false,
                code: 'USDC_WITHDRAWALS_NOT_CONFIGURED',
                message: 'Set USDC_HOT_WALLET_KEY (0x + 64 hex chars) in Render to enable chain withdrawals.',
            });
        }

        const network = String(req.body.network || 'base').toLowerCase();
        const token = String(req.body.token || 'usdc').toLowerCase();
        const toAddress = String(req.body.to || '').trim();
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;

        if (!chain.NETWORKS[network]) return res.status(400).json({ success: false, message: 'Unknown network. Use base or polygon.' });
        if (!chain.NETWORKS[network].tokens[token]) return res.status(400).json({ success: false, message: 'Unknown token. Use usdc or usdt.' });
        if (!chain.isValidAddress(toAddress)) return res.status(400).json({ success: false, message: 'Invalid destination wallet address.' });
        if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Invalid amount.' });

        // Daily per-user limit
        const { rows: sent } = await db.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM usdc_withdrawals
             WHERE user_id = $1 AND status = 'broadcast' AND created_at >= CURRENT_DATE`,
            [req.user.id]
        );
        if (parseFloat(sent[0].total) + amount > DAILY_LIMIT) {
            return res.status(400).json({ success: false, message: 'Daily chain withdrawal limit exceeded (' + DAILY_LIMIT + ').', code: 'DAILY_LIMIT' });
        }

        // Atomic debit from the VaultBank balance
        const account = await findAccountByUserId(req.user.id);
        if (!account) return res.status(404).json({ success: false, message: 'No VaultBank account found.' });
        const { rows: debited } = await db.query(
            'UPDATE accounts SET balance = balance - $2, available_balance = available_balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
            [account.id, amount]
        );
        if (debited.length === 0) {
            return res.status(400).json({ success: false, message: 'Insufficient VaultBank balance.', code: 'INSUFFICIENT_FUNDS' });
        }
        const newBalance = parseFloat(debited[0].balance);

        // Record + broadcast
        const { rows: recRows } = await db.query(
            `INSERT INTO usdc_withdrawals (user_id, account_id, network, token, to_address, amount)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.user.id, account.id, network, token, toAddress.toLowerCase(), amount]
        );
        const withdrawalId = recRows[0].id;


        try {
            const units = BigInt(Math.round(amount * 1e6)); // 6 decimals
            const { txHash } = await chain.sendTokens(network, token, wallet.key, wallet.address, toAddress, units);

            await createTransaction({
                account_id: account.id,
                user_id: req.user.id,
                type: 'withdrawal',
                status: 'completed',
                amount: -amount,
                currency: account.currency,
                balance_before: newBalance + amount,
                balance_after: newBalance,
                description: token.toUpperCase() + ' withdrawal (' + chain.NETWORKS[network].label + ') → ' + toAddress.slice(0, 10) + '…' + toAddress.slice(-6),
                category: 'expense',
                external_reference: txHash,
                metadata: { chain: true, network, token, withdrawal_id: withdrawalId, to: toAddress.toLowerCase() },
            });
            await createNotification(req.user.id, {
                type: 'transaction',
                title: 'Chain withdrawal sent',
                message: '$' + amount.toFixed(2) + ' ' + token.toUpperCase() + ' sent on ' + chain.NETWORKS[network].label + '. Track it: ' + chain.NETWORKS[network].explorer + '/tx/' + txHash,
            });

            res.json({
                success: true,
                withdrawalId,
                txHash,
                explorerUrl: chain.NETWORKS[network].explorer + '/tx/' + txHash,
                balance: newBalance,
                message: '$' + amount.toFixed(2) + ' ' + token.toUpperCase() + ' sent to ' + toAddress.slice(0, 10) + '…' + toAddress.slice(-6) + ' on ' + chain.NETWORKS[network].label + '.',
            });
        } catch (broadcastError) {
            // Auto-refund — no money may ever be stuck
            await db.query('UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1', [account.id, amount]);
            await db.query("UPDATE usdc_withdrawals SET status = 'failed' WHERE id = $1", [withdrawalId]);
            console.error('Chain broadcast failed:', broadcastError.message);
            return res.status(502).json({ success: false, code: 'BROADCAST_FAILED', message: 'Chain broadcast failed — balance refunded. ' + broadcastError.message });
        }
    } catch (error) {
        console.error('usdc withdraw error:', error.message);
        res.status(500).json({ success: false, message: 'Withdrawal failed — no money moved.' });
    }
});

// Automation: hot-wallet low-balance alerts to admins every 30 min
async function monitorHotWallet() {
    try {
        const wallet = chain.getHotWallet();
        if (!wallet) return;
        const min = parseFloat(process.env.USDC_HOT_WALLET_MIN || '100');
        const b = await chain.getHotWalletBalances('base', wallet.address);
        if (b.usdc < min) {
            const { rows: admins } = await db.query("SELECT id FROM users WHERE role IN ('super_admin', 'admin')");
            for (const a of admins) {
                await createNotification(a.id, {
                    type: 'warning',
                    title: 'Hot wallet low on Base',
                    message: 'Hot wallet ' + wallet.address.slice(0, 10) + '… holds $' + b.usdc.toFixed(2) + ' USDC (min $' + min + '). Top it up to keep chain withdrawals flowing.',
                });
            }
        }
    } catch (e) { /* RPC may hiccup — best-effort */ }
}
function startHotWalletMonitor() {
    if (isDemo) return;
    setTimeout(() => { monitorHotWallet(); }, 20000);
    setInterval(() => { monitorHotWallet(); }, 30 * 60 * 1000);
    console.log('CHAIN HOT-WALLET MONITOR ARMED — low-balance alerts automatic');
}

module.exports = router;
module.exports.startHotWalletMonitor = startHotWalletMonitor;

