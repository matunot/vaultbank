/**
 * VaultBank Pay — OUR OWN payment network. No Stripe/PayPal/Razorpay.
 *
 * Merchants create payment requests; customers pay instantly from VaultBank
 * balance to merchant balance — atomic, internal, <1s, zero data leaks.
 *
 * Routes:
 *   POST /api/vbpay/merchant          — become a merchant (auth)
 *   GET  /api/vbpay/merchant          — my merchant profile + stats (auth)
 *   POST /api/vbpay/requests          — create payment request -> link + QR
 *   GET  /api/vbpay/requests          — my requests (merchant view, auth)
 *   GET  /api/vbpay/requests/:id      — PUBLIC status (payer checkout screen)
 *   POST /api/vbpay/requests/:id/pay  — pay it from VaultBank balance (auth)
 */

const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { authenticateToken } = require('../middleware/auth');
const {
    db,
    isDemo,
    findAccountByUserId,
    createTransaction,
    createNotification,
} = require('../config/database');

const BASE_URL = (process.env.CLIENT_URL || 'https://vaultbank-md20.onrender.com').replace(/\/+$/, '');

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS vb_merchants (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS vb_pay_requests (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            merchant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            amount NUMERIC(15,2) NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled')),
            payer_user_id UUID,
            paid_at TIMESTAMP WITH TIME ZONE,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    tablesReady = true;
}

const expiresAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

// POST /api/vbpay/merchant — become a merchant
router.post('/api/vbpay/merchant', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'VaultBank Pay needs a live account.' });
        await ensureTables();
        const name = String(req.body.name || '').trim().slice(0, 60);
        if (!name) return res.status(400).json({ success: false, message: 'Merchant name is required.' });
        const category = String(req.body.category || 'general').trim().slice(0, 30);
        const existing = (await db.query('SELECT * FROM vb_merchants WHERE user_id = $1', [req.user.id])).rows[0];
        if (existing) {
            return res.json({ success: true, already: true, merchant: existing, message: 'You are already a VaultBank merchant.' });
        }
        const { rows } = await db.query(
            'INSERT INTO vb_merchants (user_id, name, category) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, name, category]
        );
        await createNotification(req.user.id, {
            type: 'success',
            title: 'VaultBank Pay merchant account created',
            message: 'You can now accept instant payments with payment links and QR codes — powered 100% by VaultBank.',
        });
        res.json({ success: true, merchant: rows[0] });
    } catch (error) {
        console.error('vbpay merchant error:', error.message);
        res.status(500).json({ success: false, message: 'Could not create merchant account.' });
    }
});

// GET /api/vbpay/merchant — my profile + stats
router.get('/api/vbpay/merchant', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.json({ success: true, demo: true, exists: false });
        await ensureTables();
        const m = (await db.query('SELECT * FROM vb_merchants WHERE user_id = $1', [req.user.id])).rows[0];
        if (!m) return res.json({ success: true, exists: false, canCreate: true });
        const stats = (await db.query(
            `SELECT COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS received_total,
                    COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > NOW()) AS pending_count
             FROM vb_pay_requests WHERE merchant_user_id = $1`,
            [req.user.id]
        )).rows[0];
        res.json({
            success: true,
            exists: true,
            merchant: m,
            payLink: BASE_URL + '/?merchant=' + m.user_id,
            stats: {
                paidCount: parseInt(stats.paid_count, 10),
                receivedTotal: parseFloat(stats.received_total),
                pendingCount: parseInt(stats.pending_count, 10),
            },
        });
    } catch (error) {
        console.error('vbpay merchant status error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load merchant profile.' });
    }
});

// POST /api/vbpay/requests — create a payment request (merchant only)
router.post('/api/vbpay/requests', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'VaultBank Pay needs a live account.' });
        await ensureTables();
        const m = (await db.query('SELECT * FROM vb_merchants WHERE user_id = $1', [req.user.id])).rows[0];
        if (!m) return res.status(400).json({ success: false, message: 'Create a merchant account first.', code: 'NO_MERCHANT' });
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Invalid amount.' });
        const description = String(req.body.description || '').trim().slice(0, 140) || null;
        const { rows } = await db.query(
            `INSERT INTO vb_pay_requests (merchant_user_id, amount, description, expires_at)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.user.id, amount, description, expiresAt()]
        );
        const request = rows[0];
        const payUrl = BASE_URL + '/?pay=' + request.id;
        const qrDataUrl = await QRCode.toDataURL(payUrl, { width: 512, margin: 1 });
        res.json({
            success: true,
            request,
            merchant: { name: m.name },
            payUrl,
            qrDataUrl,
        });
    } catch (error) {
        console.error('vbpay request create error:', error.message);
        res.status(500).json({ success: false, message: 'Could not create payment request.' });
    }
});

// GET /api/vbpay/requests — my requests (merchant view)
router.get('/api/vbpay/requests', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query(
            `SELECT r.*, u.full_name AS payer_name
             FROM vb_pay_requests r
             LEFT JOIN users u ON u.id = r.payer_user_id
             WHERE r.merchant_user_id = $1
             ORDER BY r.created_at DESC LIMIT 50`,
            [req.user.id]
        );
        res.json({ success: true, requests: rows });
    } catch (error) {
        console.error('vbpay list error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load requests.' });
    }
});


// GET /api/vbpay/requests/:id — PUBLIC (payer checkout screen, no auth needed)
router.get('/api/vbpay/requests/:id', async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query(
            `SELECT r.id, r.amount, r.description, r.status, r.created_at, r.expires_at,
                    m.name AS merchant_name, m.category AS merchant_category
             FROM vb_pay_requests r
             JOIN vb_merchants m ON m.user_id = r.merchant_user_id
             WHERE r.id = $1`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Payment request not found.' });
        const r = rows[0];
        if (r.status === 'pending' && new Date(r.expires_at) < new Date()) {
            await db.query("UPDATE vb_pay_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'", [req.params.id]);
            r.status = 'expired';
        }
        res.json({ success: true, request: r });
    } catch (error) {
        console.error('vbpay public status error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load payment request.' });
    }
});


// POST /api/vbpay/requests/:id/pay — pay from VaultBank balance. Atomic, idempotent.
router.post('/api/vbpay/requests/:id/pay', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'VaultBank Pay needs a live account.' });
        await ensureTables();
        const { rows: reqRows } = await db.query(
            `SELECT r.*, m.name AS merchant_name FROM vb_pay_requests r
             JOIN vb_merchants m ON m.user_id = r.merchant_user_id
             WHERE r.id = $1`,
            [req.params.id]
        );
        const request = reqRows[0];
        if (!request) return res.status(404).json({ success: false, message: 'Payment request not found.' });
        if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'This request is already ' + request.status + '.', code: 'NOT_PENDING' });
        if (new Date(request.expires_at) < new Date()) {
            await db.query("UPDATE vb_pay_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'", [request.id]);
            return res.status(400).json({ success: false, message: 'This payment request has expired.', code: 'EXPIRED' });
        }
        if (request.merchant_user_id === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot pay your own payment request.' });
        }

        const amount = parseFloat(request.amount);

        // Race-safe claim: only ONE payer can flip pending -> paid
        const { rows: claimed } = await db.query(
            "UPDATE vb_pay_requests SET status = 'paid', payer_user_id = $2, paid_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *",
            [request.id, req.user.id]
        );
        if (claimed.length === 0) return res.status(400).json({ success: false, message: 'This request was just paid by someone else.', code: 'NOT_PENDING' });

        // Atomic debit from payer
        const payerAccount = await findAccountByUserId(req.user.id);
        if (!payerAccount) {
            await db.query("UPDATE vb_pay_requests SET status = 'pending', payer_user_id = NULL, paid_at = NULL WHERE id = $1", [request.id]);
            return res.status(404).json({ success: false, message: 'No VaultBank account found.' });
        }
        const { rows: debited } = await db.query(
            'UPDATE accounts SET balance = balance - $2, available_balance = available_balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
            [payerAccount.id, amount]
        );
        if (debited.length === 0) {
            await db.query("UPDATE vb_pay_requests SET status = 'pending', payer_user_id = NULL, paid_at = NULL WHERE id = $1", [request.id]);
            return res.status(400).json({ success: false, message: 'Insufficient VaultBank balance.', code: 'INSUFFICIENT_FUNDS' });
        }
        const payerBalance = parseFloat(debited[0].balance);

        // Atomic credit to merchant
        const merchantAccount = await findAccountByUserId(request.merchant_user_id);
        if (!merchantAccount) {
            // Refund payer — cannot happen in practice (merchant always has an account)
            await db.query('UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1', [payerAccount.id, amount]);
            await db.query("UPDATE vb_pay_requests SET status = 'pending', payer_user_id = NULL, paid_at = NULL WHERE id = $1", [request.id]);
            return res.status(500).json({ success: false, message: 'Merchant account error — no money moved.' });
        }
        const { rows: credited } = await db.query(
            'UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1 RETURNING balance',
            [merchantAccount.id, amount]
        );
        const merchantBalance = parseFloat(credited[0].balance);
        const payerBalanceBefore = payerBalance + amount;
        const merchantBalanceBefore = merchantBalance - amount;


        // Ledger: payer (payment) + merchant (deposit)
        await createTransaction({
            account_id: payerAccount.id,
            user_id: req.user.id,
            type: 'payment',
            status: 'completed',
            amount: -amount,
            currency: payerAccount.currency,
            balance_before: payerBalanceBefore,
            balance_after: payerBalance,
            description: 'VaultBank Pay — ' + request.merchant_name + (request.description ? ' · ' + request.description : ''),
            category: 'expense',
            external_reference: request.id,
            metadata: { vbpay: true, request_id: request.id, merchant_user_id: request.merchant_user_id },
        });
        await createTransaction({
            account_id: merchantAccount.id,
            user_id: request.merchant_user_id,
            type: 'deposit',
            status: 'completed',
            amount,
            currency: merchantAccount.currency,
            balance_before: merchantBalanceBefore,
            balance_after: merchantBalance,
            description: 'VaultBank Pay received' + (request.description ? ' — ' + request.description : ''),
            category: 'income',
            external_reference: request.id,
            metadata: { vbpay: true, request_id: request.id, payer_user_id: req.user.id },
        });
        await createNotification(req.user.id, {
            type: 'transaction',
            title: 'VaultBank Pay — payment sent',
            message: '$' + amount.toFixed(2) + ' paid to ' + request.merchant_name + ' instantly. New balance $' + payerBalance.toFixed(2) + '.',
        });
        await createNotification(request.merchant_user_id, {
            type: 'transaction',
            title: 'VaultBank Pay — payment received',
            message: '$' + amount.toFixed(2) + ' received' + (request.description ? ' (' + request.description + ')' : '') + '. New balance $' + merchantBalance.toFixed(2) + '.',
        });

        res.json({
            success: true,
            paid: amount,
            merchantName: request.merchant_name,
            payerBalance,
            receiptId: request.id,
            message: 'Paid $' + amount.toFixed(2) + ' to ' + request.merchant_name + ' — settled instantly on the VaultBank network.',
        });
    } catch (error) {
        console.error('vbpay pay error:', error.message);
        res.status(500).json({ success: false, message: 'Payment failed — no money moved.' });
    }
});

// Automation: expire stale pending requests every 15 min
async function expireStaleRequests() {
    try {
        await ensureTables();
        await db.query("UPDATE vb_pay_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()");
    } catch (e) { /* best-effort */ }
}
function startVbPayAutomation() {
    if (isDemo) return;
    setInterval(() => { expireStaleRequests(); }, 15 * 60 * 1000);
    console.log('VAULTBANK PAY AUTOMATION ARMED — stale requests expire themselves');
}

module.exports = router;
module.exports.startVbPayAutomation = startVbPayAutomation;

