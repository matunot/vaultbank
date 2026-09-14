/**
 * VaultBank Credit Engine — REAL credit line + real credit-card behavior.
 *
 * - Instant underwriting from REAL VaultBank activity (deposits, balance,
 *   tenure, transfers) -> VaultBank Credit Score (300-850) + limit + APR.
 * - Cards draw CASH first, then CREDIT (via stripe-payments.js webhook
 *   handlers) — so every issued card becomes a true credit card.
 * - Daily interest accrual + autopay minimum payment — fully automatic.
 *
 * Routes (all authenticated):
 *   GET  /api/credit/status  — limit, owed, available, score, ledger
 *   POST /api/credit/apply   — instant decision (idempotent)
 *   POST /api/credit/repay   — pay down from VaultBank balance
 *   POST /api/credit/autopay — toggle autopay
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    db,
    isDemo,
    findAccountByUserId,
    createNotification,
    createTransaction,
} = require('../config/database');

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS credit_accounts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            credit_limit NUMERIC(15,2) NOT NULL DEFAULT 0,
            balance_owed NUMERIC(15,2) NOT NULL DEFAULT 0,
            apr NUMERIC(5,2) NOT NULL DEFAULT 19.99,
            credit_score INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed','review')),
            autopay BOOLEAN NOT NULL DEFAULT true,
            last_autopay_date DATE,
            opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS credit_ledger (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            credit_account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('draw','repayment','interest','fee')),
            amount NUMERIC(15,2) NOT NULL,
            balance_owed_after NUMERIC(15,2) NOT NULL,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    tablesReady = true;
}


// ============================================================================
// UNDERWRITING — VaultBank Credit Score from REAL on-platform activity
// ============================================================================
async function underwrite(userId) {
    // Account tenure
    let tenureDays = 0;
    try {
        const { rows } = await db.query(
            'SELECT EXTRACT(DAY FROM NOW() - created_at) AS days FROM users WHERE id = $1',
            [userId]
        );
        tenureDays = rows[0] && rows[0].days ? Number(rows[0].days) : 0;
    } catch (e) { /* keep 0 */ }

    // Real money behavior
    let deposits = { count: 0, total: 0 };
    try {
        const { rows } = await db.query(
            `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
             FROM transactions
             WHERE user_id = $1 AND amount > 0 AND status = 'completed'`,
            [userId]
        );
        deposits = { count: Number(rows[0].count), total: parseFloat(rows[0].total) };
    } catch (e) { /* keep zeros */ }

    let transfers = 0;
    try {
        const { rows } = await db.query(
            `SELECT COUNT(*) AS count FROM transactions
             WHERE user_id = $1 AND type IN ('transfer_in', 'transfer_out') AND status = 'completed'`,
            [userId]
        );
        transfers = Number(rows[0].count);
    } catch (e) { /* keep 0 */ }

    let balance = 0;
    try {
        const account = await findAccountByUserId(userId);
        if (account) balance = parseFloat(account.balance);
    } catch (e) { /* keep 0 */ }

    // Score 300-850
    let score = 300;
    score += Math.min(90, Math.floor(tenureDays / 4));        // tenure (≈1y = 90)
    score += Math.min(110, deposits.count * 7);               // deposit regularity
    score += Math.min(120, Math.floor(deposits.total / 100)); // deposit volume
    score += Math.min(140, Math.floor(balance / 50));         // steady balance
    score += Math.min(70, transfers * 4);                     // money-movement maturity
    score = Math.max(300, Math.min(850, score));

    // Limit + APR tiers
    let creditLimit, apr;
    if (score < 560)      { creditLimit = 500;    apr = 24.99; }
    else if (score < 620) { creditLimit = 1000;   apr = 21.99; }
    else if (score < 680) { creditLimit = 2000;   apr = 19.99; }
    else if (score < 740) { creditLimit = 3500;   apr = 17.99; }
    else if (score < 790) { creditLimit = 5000;   apr = 14.99; }
    else                  { creditLimit = 10000;  apr = 11.99; }

    return { score, creditLimit, apr, factors: { tenureDays, depositCount: deposits.count, depositTotal: deposits.total, balance, transfers } };
}

async function getCreditAccount(userId) {
    await ensureTables();
    const { rows } = await db.query(
        'SELECT * FROM credit_accounts WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

const availableCredit = (acct) =>
    Math.max(0, parseFloat(acct.credit_limit) - parseFloat(acct.balance_owed));

async function addLedger(creditAccountId, userId, kind, amount, owedAfter, description) {
    await db.query(
        `INSERT INTO credit_ledger (credit_account_id, user_id, kind, amount, balance_owed_after, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [creditAccountId, userId, kind, amount, owedAfter, description || null]
    );
}

// ============================================================================
// AUTOMATIC CREDIT DRAW — used by the card webhook (cash first, credit second)
// Returns { drawn, owedAfter } or { drawn: 0, reason }
// ============================================================================
async function drawCredit(userId, amount, description) {
    const amt = Math.round(amount * 100) / 100;
    if (!(amt > 0)) return { drawn: 0, reason: 'invalid' };
    const acct = await getCreditAccount(userId);
    if (!acct || acct.status !== 'active') return { drawn: 0, reason: 'no-credit-account' };
    const { rows } = await db.query(
        `UPDATE credit_accounts
         SET balance_owed = balance_owed + $2
         WHERE id = $1 AND balance_owed + $2 <= credit_limit
         RETURNING balance_owed, credit_limit`,
        [acct.id, amt]
    );
    if (rows.length === 0) return { drawn: 0, reason: 'insufficient-credit' };
    const owedAfter = parseFloat(rows[0].balance_owed);
    await addLedger(acct.id, userId, 'draw', amt, owedAfter, description || 'Card purchase on credit');
    return { drawn: amt, owedAfter, available: Math.max(0, parseFloat(rows[0].credit_limit) - owedAfter) };
}

// ============================================================================
// ROUTES
// ============================================================================

// GET /api/credit/status
router.get('/api/credit/status', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.json({ success: true, demo: true, available: false });
        const acct = await getCreditAccount(req.user.id);
        if (!acct) {
            return res.json({ success: true, exists: false, canApply: true });
        }
        const { rows: ledger } = await db.query(
            `SELECT kind, amount, balance_owed_after, description, created_at
             FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [req.user.id]
        );
        const owed = parseFloat(acct.balance_owed);
        const limit = parseFloat(acct.credit_limit);
        const minPayment = owed > 0 ? Math.max(25, Math.ceil(owed * 0.02 * 100) / 100) : 0;
        res.json({
            success: true,
            exists: true,
            creditLimit: limit,
            balanceOwed: owed,
            availableCredit: Math.max(0, limit - owed),
            apr: parseFloat(acct.apr),
            creditScore: acct.credit_score,
            status: acct.status,
            autopay: acct.autopay,
            minimumPayment: minPayment,
            openedAt: acct.opened_at,
            ledger,
        });
    } catch (error) {
        console.error('Credit status error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load credit status.' });
    }
});

// POST /api/credit/apply — instant decision from real activity
router.post('/api/credit/apply', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'Credit requires a live account.' });
        const existing = await getCreditAccount(req.user.id);
        if (existing) {
            return res.json({
                success: true,
                alreadyApproved: true,
                creditScore: existing.credit_score,
                creditLimit: parseFloat(existing.credit_limit),
                apr: parseFloat(existing.apr),
                message: 'You already have a VaultBank credit line.',
            });
        }
        const decision = await underwrite(req.user.id);
        const { rows } = await db.query(
            `INSERT INTO credit_accounts (user_id, credit_limit, balance_owed, apr, credit_score, status)
             VALUES ($1, $2, 0, $3, $4, 'active')
             RETURNING credit_limit, apr, credit_score`,
            [req.user.id, decision.creditLimit, decision.apr, decision.score]
        );
        await createNotification(req.user.id, {
            type: 'success',
            title: 'Credit line approved instantly',
            message: 'You are approved for $' + decision.creditLimit.toFixed(2) + ' at ' + decision.apr + '% APR. VaultBank Credit Score: ' + decision.score + '. Your cards now spend cash first, credit second.',
        });
        res.json({
            success: true,
            approved: true,
            instant: true,
            creditLimit: parseFloat(rows[0].credit_limit),
            apr: parseFloat(rows[0].apr),
            creditScore: rows[0].credit_score,
            factors: decision.factors,
            message: 'Approved in seconds — no paperwork. Your VaultBank cards now draw cash first, then credit.',
        });
    } catch (error) {
        console.error('Credit apply error:', error.message);
        res.status(500).json({ success: false, message: 'Credit application failed.' });
    }
});


// POST /api/credit/repay — pay down from VaultBank balance
router.post('/api/credit/repay', authenticateToken, async (req, res) => {
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'Credit requires a live account.' });
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Invalid amount.' });
        const acct = await getCreditAccount(req.user.id);
        if (!acct) return res.status(404).json({ success: false, message: 'No credit line found.' });
        const owed = parseFloat(acct.balance_owed);
        if (owed <= 0) return res.json({ success: false, message: 'Nothing to repay — balance is clear.' });
        const pay = Math.min(amount, owed);

        // Atomic debit from the main account
        const account = await findAccountByUserId(req.user.id);
        if (!account) return res.status(404).json({ success: false, message: 'No account found.' });
        const { rows: debited } = await db.query(
            'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
            [account.id, pay]
        );
        if (debited.length === 0) {
            return res.status(400).json({ success: false, message: 'Insufficient VaultBank balance for this payment.' });
        }
        const newMainBalance = parseFloat(debited[0].balance);

        // Reduce the credit balance
        const { rows: reduced } = await db.query(
            'UPDATE credit_accounts SET balance_owed = balance_owed - $2 WHERE id = $1 RETURNING balance_owed',
            [acct.id, pay]
        );
        const owedAfter = parseFloat(reduced[0].balance_owed);

        await createTransaction({
            account_id: account.id,
            user_id: req.user.id,
            type: 'payment',
            status: 'completed',
            amount: -pay,
            currency: account.currency,
            balance_before: newMainBalance + pay,
            balance_after: newMainBalance,
            description: 'Credit card payment — $' + pay.toFixed(2),
            category: 'expense',
            metadata: { credit: true, credit_account_id: acct.id },
        });
        await addLedger(acct.id, req.user.id, 'repayment', pay, owedAfter, 'Payment from VaultBank balance');
        await createNotification(req.user.id, {
            type: 'success',
            title: 'Credit payment applied',
            message: '$' + pay.toFixed(2) + ' paid. Remaining credit balance $' + owedAfter.toFixed(2) + '. Available credit $' + (parseFloat(acct.credit_limit) - owedAfter).toFixed(2) + '.',
        });
        res.json({
            success: true,
            paid: pay,
            balanceOwed: owedAfter,
            availableCredit: Math.max(0, parseFloat(acct.credit_limit) - owedAfter),
            accountBalance: newMainBalance,
        });
    } catch (error) {
        console.error('Credit repay error:', error.message);
        res.status(500).json({ success: false, message: 'Payment failed.' });
    }
});

// POST /api/credit/autopay — toggle
router.post('/api/credit/autopay', authenticateToken, async (req, res) => {
    try {
        const acct = await getCreditAccount(req.user.id);
        if (!acct) return res.status(404).json({ success: false, message: 'No credit line found.' });
        const enabled = !!req.body.autopay;
        await db.query('UPDATE credit_accounts SET autopay = $2 WHERE id = $1', [acct.id, enabled]);
        res.json({ success: true, autopay: enabled });
    } catch (error) {
        console.error('Credit autopay error:', error.message);
        res.status(500).json({ success: false, message: 'Could not update autopay.' });
    }
});


// ============================================================================
// AUTOMATION — daily interest + autopay minimum payments. Zero manual steps.
// ============================================================================
async function runCreditAutomation() {
    try {
        await ensureTables();
        const today = new Date().toISOString().slice(0, 10);
        const { rows: accounts } = await db.query(
            "SELECT * FROM credit_accounts WHERE status = 'active' AND balance_owed > 0"
        );
        for (const acct of accounts) {
            const owed = parseFloat(acct.balance_owed);

            // 1. Daily interest
            const interest = Math.round(owed * (parseFloat(acct.apr) / 100 / 365) * 100) / 100;
            if (interest > 0) {
                const { rows: upd } = await db.query(
                    'UPDATE credit_accounts SET balance_owed = balance_owed + $2 WHERE id = $1 RETURNING balance_owed',
                    [acct.id, interest]
                );
                if (upd[0]) await addLedger(acct.id, acct.user_id, 'interest', interest, parseFloat(upd[0].balance_owed), 'Daily interest accrual');
            }

            // 2. Autopay minimum payment from the VaultBank balance
            if (acct.autopay && acct.last_autopay_date !== today) {
                const minPay = Math.min(Math.max(25, Math.ceil(owed * 0.02 * 100) / 100), owed);
                const account = await findAccountByUserId(acct.user_id);
                if (account) {
                    const { rows: debited } = await db.query(
                        'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
                        [account.id, minPay]
                    );
                    if (debited[0]) {
                        const newMain = parseFloat(debited[0].balance);
                        const { rows: reduced } = await db.query(
                            'UPDATE credit_accounts SET balance_owed = balance_owed - $2, last_autopay_date = $3 WHERE id = $1 RETURNING balance_owed',
                            [acct.id, minPay, today]
                        );
                        await createTransaction({
                            account_id: account.id,
                            user_id: acct.user_id,
                            type: 'payment',
                            status: 'completed',
                            amount: -minPay,
                            currency: account.currency,
                            balance_before: newMain + minPay,
                            balance_after: newMain,
                            description: 'Credit autopay — minimum payment',
                            category: 'expense',
                            metadata: { credit: true, credit_account_id: acct.id, autopay: true },
                        });
                        await addLedger(acct.id, acct.user_id, 'repayment', minPay, parseFloat(reduced[0].balance_owed), 'Autopay minimum payment');
                        await createNotification(acct.user_id, {
                            type: 'transaction',
                            title: 'Credit autopay applied',
                            message: '$' + minPay.toFixed(2) + ' minimum payment made automatically. Remaining $' + parseFloat(reduced[0].balance_owed).toFixed(2) + '.',
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.warn('Credit automation:', error.message);
    }
}

function startCreditAutomation() {
    if (isDemo) return;
    setTimeout(() => { runCreditAutomation(); }, 12000);
    setInterval(() => { runCreditAutomation(); }, 6 * 60 * 60 * 1000); // every 6h
    console.log('CREDIT ENGINE AUTOMATION ARMED — interest + autopay run themselves');
}

module.exports = router;
module.exports.getCreditAccount = getCreditAccount;
module.exports.availableCredit = availableCredit;
module.exports.drawCredit = drawCredit;
module.exports.ensureTables = ensureTables;
module.exports.startCreditAutomation = startCreditAutomation;

