/**
 * VaultBank Account Routes
 * 
 * Real banking account management: balances, transactions, statements.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    findUserById,
    findAccountByUserId,
    findAccountByUserIdAndCurrency,
    findAccountByNumber,
    searchUsers,
    createAccount,
    updateAccountBalance,
    createTransaction,
    getTransactions,
    createTransfer,
    getTransfers,
    createNotification,
    createAuditLog,
    db,
    isDemo,
    demoStore,
} = require('../config/database');

// ============================================================
// GET /api/account — Get user's primary account
// ============================================================
router.get('/api/account', authenticateToken, async (req, res) => {
    try {
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({
                success: false,
                message: 'No account found. Please contact support.'
            });
        }

        res.json({
            success: true,
            account: {
                id: account.id,
                accountNumber: account.account_number,
                accountType: account.account_type,
                accountName: account.account_name,
                balance: parseFloat(account.balance),
                availableBalance: parseFloat(account.available_balance),
                heldBalance: parseFloat(account.held_balance),
                currency: account.currency,
                status: account.status,
                interestRate: parseFloat(account.interest_rate),
                dailyTransferLimit: parseFloat(account.daily_transfer_limit),
                monthlyTransferLimit: parseFloat(account.monthly_transfer_limit),
                openedAt: account.opened_at,
            }
        });
    } catch (error) {
        console.error('Get account error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch account.' });
    }
});

// ============================================================
// GET /api/accounts — Get all user accounts
// ============================================================
router.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        let accounts;
        if (req.user.isDemo !== false) {
            // demo mode
            accounts = require('../config/database').demoStore.accounts.filter(a => a.user_id === req.user.id);
        } else {
            const result = await db.query(
                'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC',
                [req.user.id]
            );
            accounts = result.rows;
        }

        res.json({
            success: true,
            accounts: accounts.map(a => ({
                id: a.id,
                accountNumber: a.account_number,
                accountType: a.account_type,
                accountName: a.account_name,
                balance: parseFloat(a.balance),
                availableBalance: parseFloat(a.available_balance),
                currency: a.currency,
                status: a.status,
            }))
        });
    } catch (error) {
        console.error('Get accounts error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch accounts.' });
    }
});

// ============================================================
// GET /api/account/balance — Get real-time balance
// ============================================================
router.get('/api/account/balance', authenticateToken, async (req, res) => {
    try {
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }

        res.json({
            success: true,
            balance: {
                available: parseFloat(account.available_balance),
                current: parseFloat(account.balance),
                held: parseFloat(account.held_balance),
                currency: account.currency,
            }
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch balance.' });
    }
});

// ============================================================
// GET /api/account/transactions — Get transaction history
// ============================================================
router.get('/api/account/transactions', authenticateToken, async (req, res) => {
    try {
        const { limit = 50, offset = 0, type, startDate, endDate } = req.query;

        const transactions = await getTransactions(req.user.id, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            type,
            startDate,
            endDate,
        });

        res.json({
            success: true,
            transactions: transactions.map(t => ({
                id: t.id,
                type: t.type,
                status: t.status,
                amount: parseFloat(t.amount),
                currency: t.currency,
                balanceBefore: parseFloat(t.balance_before),
                balanceAfter: parseFloat(t.balance_after),
                description: t.description,
                category: t.category,
                counterpartyName: t.counterparty_name,
                counterpartyAccount: t.counterparty_account,
                externalReference: t.external_reference,
                metadata: typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata,
                createdAt: t.created_at,
            })),
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: transactions.length,
            }
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch transactions.' });
    }
});

// ============================================================
// POST /api/account/deposit — Deposit money (Stripe webhook will handle real deposits)
// ============================================================
router.post('/api/account/deposit', authenticateToken, async (req, res) => {
    try {
        const { amount, description, paymentMethodId } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid deposit amount.' });
        }

        if (amount > 50000) {
            return res.status(400).json({ success: false, message: 'Maximum single deposit is $50,000.' });
        }

        if (!isDemo) {
            // Real mode: a balance credit is only ever the RESULT of verified
            // external settlement. Self-serve instant deposits would mint money.
            return res.status(503).json({
                success: false,
                code: 'DEPOSITS_USE_VERIFIED_RAIL',
                message: 'Instant self-service deposits are unavailable. Fund your account with a bank transfer — open Deposits and choose the Bank option.'
            });
        }

        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }

        // Atomic credit: arithmetic stays in Postgres, so concurrent deposits
        // cannot lose updates (no read-compute-write race).
        let balanceBefore;
        let newBalance;
        if (isDemo) {
            // In-memory demo store is single-process; legacy path is safe there.
            balanceBefore = parseFloat(account.balance);
            newBalance = balanceBefore + parseFloat(amount);
            await updateAccountBalance(account.id, newBalance);
        } else {
            const upd = await db.query(
                'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after',
                [account.id, parseFloat(amount)]
            );
            if (!upd.rows.length) {
                return res.status(404).json({ success: false, message: 'No account found.' });
            }
            balanceBefore = parseFloat(upd.rows[0].balance_before);
            newBalance = parseFloat(upd.rows[0].balance_after);
        }

        // Record transaction
        await createTransaction({
            account_id: account.id,
            user_id: req.user.id,
            type: 'deposit',
            status: 'completed',
            amount: parseFloat(amount),
            currency: account.currency,
            balance_before: balanceBefore,
            balance_after: newBalance,
            description: description || 'Account deposit',
            category: 'income',
            metadata: { paymentMethodId: paymentMethodId || null }
        });

        // Notify
        await createNotification(req.user.id, {
            type: 'transaction',
            title: 'Deposit Successful',
            message: `$${parseFloat(amount).toFixed(2)} has been deposited to your account. New balance: $${newBalance.toFixed(2)}`
        });

        await createAuditLog({
            userId: req.user.id,
            action: 'deposit',
            resourceType: 'account',
            resourceId: account.id,
            details: { amount, balanceBefore, balanceAfter: newBalance },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            message: `Successfully deposited $${parseFloat(amount).toFixed(2)}`,
            balance: {
                available: newBalance,
                current: newBalance,
                held: parseFloat(account.held_balance),
                currency: account.currency,
            }
        });
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ success: false, message: 'Deposit failed.' });
    }
});

// ============================================================
// POST /api/account/withdraw — Withdraw money
// ============================================================
router.post('/api/account/withdraw', authenticateToken, async (req, res) => {
    try {
        const { amount, description } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid withdrawal amount.' });
        }

        if (!isDemo) {
            // Real mode: no authorized payout rail exists. Never debit a
            // balance and report success — the money would simply vanish.
            return res.status(503).json({
                success: false,
                code: 'OUTBOUND_TRANSFERS_NOT_CONFIGURED',
                message: 'Outbound transfers are not available yet — no payout rail is connected. Your balance stays fully available for internal transfers and payments.'
            });
        }

        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }

        let balanceBefore = parseFloat(account.balance);
        const withdrawAmount = parseFloat(amount);

        if (withdrawAmount > balanceBefore) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient funds.',
                availableBalance: balanceBefore
            });
        }

        // Atomic guarded decrement: the `balance >= $2` guard in the UPDATE is
        // the authoritative check, so two concurrent withdrawals of the same
        // funds cannot both succeed (one is left with no row -> 400).
        let newBalance;
        if (isDemo) {
            // In-memory demo store is single-process; legacy path is safe there.
            newBalance = balanceBefore - withdrawAmount;
            await updateAccountBalance(account.id, newBalance);
        } else {
            const upd = await db.query(
                'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING (balance + $2) AS balance_before, balance AS balance_after',
                [account.id, withdrawAmount]
            );
            if (!upd.rows.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient funds.',
                    availableBalance: balanceBefore
                });
            }
            balanceBefore = parseFloat(upd.rows[0].balance_before);
            newBalance = parseFloat(upd.rows[0].balance_after);
        }

        await createTransaction({
            account_id: account.id,
            user_id: req.user.id,
            type: 'withdrawal',
            status: 'completed',
            amount: -withdrawAmount,
            currency: account.currency,
            balance_before: balanceBefore,
            balance_after: newBalance,
            description: description || 'Account withdrawal',
            category: 'expense',
        });

        await createNotification(req.user.id, {
            type: 'transaction',
            title: 'Withdrawal Successful',
            message: `$${withdrawAmount.toFixed(2)} has been withdrawn from your account. New balance: $${newBalance.toFixed(2)}`
        });

        res.json({
            success: true,
            message: `Successfully withdrew $${withdrawAmount.toFixed(2)}`,
            balance: {
                available: newBalance,
                current: newBalance,
                held: parseFloat(account.held_balance),
                currency: account.currency,
            }
        });
    } catch (error) {
        console.error('Withdraw error:', error);
        res.status(500).json({ success: false, message: 'Withdrawal failed.' });
    }
});

// ============================================================
// GET /api/account/inr — INR wallet: balance + INR-only history
// ============================================================
router.get('/api/account/inr', authenticateToken, async (req, res) => {
    try {
        const account = await findAccountByUserIdAndCurrency(req.user.id, 'INR');
        if (!account) {
            return res.status(404).json({ success: false, message: 'No INR account yet — open one with POST /api/account/open-inr.' });
        }
        let transactions = [];
        if (!isDemo) {
            const { rows } = await db.query(
                'SELECT * FROM transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 25',
                [account.id]
            );
            transactions = rows;
        }
        res.json({
            success: true,
            account: {
                id: account.id,
                accountNumber: account.account_number,
                currency: 'INR',
                balance: parseFloat(account.balance),
                availableBalance: parseFloat(account.available_balance),
                heldBalance: parseFloat(account.held_balance),
            },
            transactions: transactions.map((t) => ({
                id: t.id,
                type: t.type,
                status: t.status,
                amount: parseFloat(t.amount),
                currency: t.currency,
                description: t.description,
                category: t.category,
                balanceAfter: t.balance_after ? parseFloat(t.balance_after) : null,
                date: t.created_at,
                externalReference: t.external_reference || null,
            })),
        });
    } catch (error) {
        console.error('INR account error:', error);
        res.status(500).json({ success: false, message: 'Could not load your INR account.' });
    }
});

// ============================================================
// POST /api/account/open-inr — EXPLICIT opt-in INR sub-account.
// Never reinterprets existing USD accounts or balances: it creates a NEW,
// separate, zero-balance account the collections rail can credit.
// ============================================================
router.post('/api/account/open-inr', authenticateToken, async (req, res) => {
    try {
        if (isDemo) {
            // Demo platform: in-memory store (db.query throws in demo).
            const dupe = demoStore.accounts.find((a) => a.user_id === req.user.id && a.currency === 'INR');
            if (dupe) {
                return res.status(409).json({ success: true, already: true, account: dupe, message: 'You already have an INR account.' });
            }
            const created = await createAccount(req.user.id, 'savings', 'INR');
            return res.status(201).json({
                success: true,
                account: { id: created.id, accountNumber: created.account_number, currency: 'INR', balance: 0 },
                message: 'INR account opened.',
            });
        }
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }
        // Race guard: a partial unique index guarantees one INR account per
        // user even under concurrent open requests.
        try {
            await db.query(
                "CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_inr_per_user ON accounts (user_id) WHERE currency = 'INR'"
            );
        } catch (idxErr) {
            console.warn('INR unique index ensure skipped:', idxErr.message);
        }
        const { rows: existing } = await db.query(
            "SELECT id, account_number, currency, balance FROM accounts WHERE user_id = $1 AND currency = 'INR' LIMIT 1",
            [req.user.id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ success: true, already: true, account: existing[0], message: 'You already have an INR account.' });
        }
        let created;
        try {
            created = await createAccount(req.user.id, 'savings', 'INR');
        } catch (e) {
            // Unique-index race lost to a concurrent request — treat as already open.
            if (String(e.message || '').includes('accounts_one_inr_per_user') || String(e.message || '').includes('duplicate key')) {
                const { rows: raced } = await db.query(
                    "SELECT id, account_number, currency, balance FROM accounts WHERE user_id = $1 AND currency = 'INR' LIMIT 1",
                    [req.user.id]
                );
                if (raced.length > 0) {
                    return res.status(409).json({ success: true, already: true, account: raced[0], message: 'You already have an INR account.' });
                }
            }
            throw e;
        }
        await createAuditLog({
            userId: req.user.id,
            action: 'inr_account_opened',
            resourceType: 'account',
            resourceId: created.id,
            details: { currency: 'INR', explicitOptIn: true },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
        await createNotification(req.user.id, {
            type: 'success',
            title: 'INR account opened',
            message: 'Your INR account is ready. Once the collections rail is enabled you will get your own receiving details.',
        });
        res.status(201).json({
            success: true,
            account: { id: created.id, accountNumber: created.account_number, currency: 'INR', balance: 0 },
            message: 'INR account opened.',
        });
    } catch (error) {
        console.error('Open INR account error:', error);
        res.status(500).json({ success: false, message: 'Could not open an INR account.' });
    }
});

// ============================================================
// POST /api/account/transfer — Transfer money to another user
// ATOMIC: idempotency claim + debit + credit + both ledger rows
// + the transfer record run in ONE database transaction on ONE
// pooled client. Nothing outside it can touch these tables
// between BEGIN and COMMIT. Notifications run after commit and
// are failure-tolerant — they never make a completed transfer
// look failed.
// ============================================================
router.post('/api/account/transfer', authenticateToken, async (req, res) => {
    try {
        const { recipientEmail, recipientAccountNumber, amount, description, reason, currency = 'USD' } = req.body;
        const wantedCurrency = String(currency).trim().toUpperCase();
        const idempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']).slice(0, 100) : null;

        // ── D. Explicit supported-currency whitelist ──
        const SUPPORTED_CURRENCIES = ['USD', 'INR'];
        if (!SUPPORTED_CURRENCIES.includes(wantedCurrency)) {
            return res.status(400).json({ success: false, message: `Currency ${wantedCurrency} is not supported. Use ${SUPPORTED_CURRENCIES.join(' or ')}.` });
        }

        // ── D. Amount validation: finite, positive, precision-safe ──
        const transferAmount = parseFloat(amount);
        if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid transfer amount.' });
        }
        if (transferAmount > 100000) {
            return res.status(400).json({ success: false, message: 'Maximum single transfer is 100,000.' });
        }
        if (Math.round(transferAmount * 100) / 100 !== transferAmount) {
            return res.status(400).json({ success: false, message: 'Amount cannot have more than 2 decimal places.' });
        }

        // Currency-aware sender account: resolves the user's account in the
        // REQUESTED currency only — never a silent default across currencies.
        const senderAccount = await findAccountByUserIdAndCurrency(req.user.id, wantedCurrency);
        if (!senderAccount) {
            return res.status(404).json({ success: false, message: `You don't have a ${wantedCurrency} account yet. Open one first.` });
        }

        // Find recipient — resolved in the SAME currency, server-side only.
        // No client-supplied account ID can bypass ownership.
        let recipientAccount = null;
        if (recipientAccountNumber) {
            recipientAccount = await findAccountByNumber(recipientAccountNumber);
            if (recipientAccount && String(recipientAccount.currency).toUpperCase() !== wantedCurrency) {
                return res.status(400).json({ success: false, message: `That recipient account is ${recipientAccount.currency} — ${wantedCurrency} transfers need a ${wantedCurrency} recipient.` });
            }
        } else if (recipientEmail) {
            const { findUserByEmail } = require('../config/database');
            const recipientUser = await findUserByEmail(recipientEmail);
            if (recipientUser) {
                recipientAccount = await findAccountByUserIdAndCurrency(recipientUser.id, wantedCurrency);
            }
        }

        if (!recipientAccount) {
            if (recipientEmail) {
                return res.status(404).json({ success: false, message: `Recipient has no ${wantedCurrency} account yet.` });
            }
            return res.status(404).json({ success: false, message: 'Recipient account not found.' });
        }

        if (recipientAccount.id === senderAccount.id) {
            return res.status(400).json({ success: false, message: 'Cannot transfer to your own account.' });
        }

        // Multi-currency safety: internal transfers are same-currency only.
        if (String(senderAccount.currency).toUpperCase() !== String(recipientAccount.currency).toUpperCase()) {
            return res.status(400).json({
                success: false,
                code: 'CROSS_CURRENCY_UNSUPPORTED',
                message: `Internal transfers require matching currencies (yours: ${senderAccount.currency}, recipient: ${recipientAccount.currency}). FX conversion is not available.`,
            });
        }

        const fee = 0; // Internal transfers are free for now
        let senderBalance;
        let newSenderBalance;
        let recipientBalance;

        if (isDemo) {
            // ── Demo path: in-memory store, single-process (no races) ──
            senderBalance = parseFloat(senderAccount.balance) || 0;
            const senderAvailable = parseFloat(senderAccount.available_balance) || 0;
            if (transferAmount + fee > senderAvailable) {
                return res.status(400).json({ success: false, message: 'Insufficient available funds.', availableBalance: senderAvailable });
            }
            newSenderBalance = senderBalance - transferAmount - fee;
            recipientBalance = parseFloat(recipientAccount.balance) + transferAmount;
            senderAccount.balance = newSenderBalance;
            senderAccount.available_balance = (parseFloat(senderAccount.available_balance) || 0) - transferAmount - fee;
            recipientAccount.balance = recipientBalance;
            recipientAccount.available_balance = (parseFloat(recipientAccount.available_balance) || 0) + transferAmount;

            // Demo ledger rows + transfer record (in-memory store)
            await createTransaction({
                account_id: senderAccount.id, user_id: req.user.id,
                type: 'transfer_out', status: 'completed',
                amount: -(transferAmount + fee), currency: wantedCurrency,
                balance_before: senderBalance, balance_after: newSenderBalance,
                description: description || `Transfer to ${recipientAccount.account_number}`,
                category: 'transfer', counterparty_name: recipientAccount.account_name,
                counterparty_account: recipientAccount.account_number,
            });
            await createTransaction({
                account_id: recipientAccount.id, user_id: recipientAccount.user_id,
                type: 'transfer_in', status: 'completed',
                amount: transferAmount, currency: wantedCurrency,
                balance_before: parseFloat(recipientAccount.balance) - transferAmount,
                balance_after: recipientBalance,
                description: description || `Transfer from ${senderAccount.account_number}`,
                category: 'income', counterparty_name: req.user.full_name,
                counterparty_account: senderAccount.account_number,
            });
            const transfer = await createTransfer({
                from_account_id: senderAccount.id, to_account_id: recipientAccount.id,
                from_user_id: req.user.id, to_user_id: recipientAccount.user_id,
                amount: transferAmount, currency: wantedCurrency, fee,
                transfer_type: 'internal', status: 'completed',
                description: description || reason || 'Internal transfer',
            });

            try {
                await createNotification(req.user.id, {
                    type: 'transaction', title: 'Transfer Sent',
                    message: `${wantedCurrency} ${transferAmount.toFixed(2)} sent to ${recipientAccount.account_number}. Remaining balance: ${wantedCurrency} ${newSenderBalance.toFixed(2)}`,
                });
                await createNotification(recipientAccount.user_id, {
                    type: 'transaction', title: 'Transfer Received',
                    message: `${wantedCurrency} ${transferAmount.toFixed(2)} received from ${senderAccount.account_number}. New balance: ${wantedCurrency} ${recipientBalance.toFixed(2)}`,
                });
            } catch (notifErr) {
                console.warn('Transfer notification failure (transfer completed):', notifErr.message);
            }

            return res.json({
                success: true,
                message: `Successfully transferred ${wantedCurrency} ${transferAmount.toFixed(2)}`,
                transfer: { id: transfer.id, amount: transferAmount, fee,
                    recipient: { accountNumber: recipientAccount.account_number, name: recipientAccount.account_name },
                    newBalance: newSenderBalance },
            });
        }

        // ── A+B+C: ONE atomic database transaction on ONE pooled client ──
        // Every operation below uses the SAME client. No helper that
        // silently acquires a second connection is called inside the
        // transaction. If ANY write fails, ROLLBACK undoes everything.
        // The transfer_idempotency table is created at startup (index.js)
        // and via migration 009 — never on the per-transfer hot path.

        const client = await db.getClient();
        let transferId = null;
        try {
            await client.query('BEGIN');

            // ── C. Durable idempotency claim — database-enforced UNIQUE ──
            if (idempotencyKey) {
                const claim = await client.query(
                    `INSERT INTO transfer_idempotency (user_id, currency, idempotency_key)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, currency, idempotency_key) DO NOTHING
                     RETURNING id`,
                    [req.user.id, wantedCurrency, idempotencyKey]
                );
                if (claim.rowCount === 0) {
                    await client.query('ROLLBACK');
                    // Concurrent duplicate or retry — return the original result.
                    const { rows: existing } = await client.query(
                        `SELECT ti.transfer_id FROM transfer_idempotency ti
                         WHERE ti.user_id = $1 AND ti.currency = $2 AND ti.idempotency_key = $3
                         AND ti.transfer_id IS NOT NULL LIMIT 1`,
                        [req.user.id, wantedCurrency, idempotencyKey]
                    );
                    if (existing.length > 0) {
                        res.setHeader('Idempotent-Replay', 'true');
                        return res.json({ success: true, replay: true, transferId: existing[0].transfer_id, message: 'Transfer already processed — replayed result.' });
                    }
                    // The original is still in flight — tell the client to retry.
                    return res.status(409).json({ success: false, code: 'TRANSFER_IN_PROGRESS', message: 'A transfer with this idempotency key is still in progress. Retry shortly.' });
                }
            }

            // ── A. Insert the transfer record INSIDE the transaction — gets
            // the UUID that both ledger rows will reference via reference_id.
            const transferResult = await client.query(
                `INSERT INTO transfers (from_account_id, to_account_id, from_user_id, to_user_id,
                    amount, currency, fee, transfer_type, status, description)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'internal', 'completed', $8)
                 RETURNING id`,
                [senderAccount.id, recipientAccount.id, req.user.id, recipientAccount.user_id,
                 transferAmount, wantedCurrency, fee, description || reason || 'Internal transfer']
            );
            transferId = transferResult.rows[0].id;

            // Link the idempotency claim to the completed transfer.
            if (idempotencyKey) {
                await client.query(
                    `UPDATE transfer_idempotency SET transfer_id = $1
                     WHERE user_id = $2 AND currency = $3 AND idempotency_key = $4`,
                    [transferId, req.user.id, wantedCurrency, idempotencyKey]
                );
            }

            // ── B. Guarded debit: both balance + available_balance, guarded
            // on the AUTHORITATIVE available_balance (not a stale read).
            // held_balance is never touched.
            const debit = await client.query(
                `UPDATE accounts
                 SET balance = balance - $2, available_balance = available_balance - $2
                 WHERE id = $1 AND available_balance >= $2
                 RETURNING (balance + $2) AS balance_before, balance AS balance_after`,
                [senderAccount.id, transferAmount + fee]
            );
            if (!debit.rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Insufficient available funds.', availableBalance: senderAccount.available_balance });
            }

            // ── B. Credit: both balance + available_balance consistently.
            const credit = await client.query(
                `UPDATE accounts
                 SET balance = balance + $2, available_balance = available_balance + $2
                 WHERE id = $1
                 RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
                [recipientAccount.id, transferAmount]
            );
            if (!credit.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Recipient account not found.' });
            }

            // ── A. Sender ledger row — same client, INSIDE the transaction.
            // Uses reference_id (the FK to transfers.id) for durable linkage.
            await client.query(
                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                    balance_before, balance_after, description, category, reference_id,
                    counterparty_name, counterparty_account)
                 VALUES ($1, $2, 'transfer_out', 'completed', $3, $4, $5, $6, $7, 'transfer', $8, $9, $10)`,
                [senderAccount.id, req.user.id, -(transferAmount + fee), wantedCurrency,
                 parseFloat(debit.rows[0].balance_before), parseFloat(debit.rows[0].balance_after),
                 description || `Transfer to ${recipientAccount.account_number}`,
                 recipientAccount.account_name, recipientAccount.account_number, transferId]
            );

            // ── A. Recipient ledger row — same client, same transaction.
            await client.query(
                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                    balance_before, balance_after, description, category, reference_id,
                    counterparty_name, counterparty_account)
                 VALUES ($1, $2, 'transfer_in', 'completed', $3, $4, $5, $6, $7, 'income', $8, $9, $10)`,
                [recipientAccount.id, recipientAccount.user_id, transferAmount, wantedCurrency,
                 parseFloat(credit.rows[0].balance_before), parseFloat(credit.rows[0].balance_after),
                 description || `Transfer from ${senderAccount.account_number}`,
                 req.user.full_name, senderAccount.account_number, transferId]
            );

            // ── A. COMMIT: everything above is one atomic operation ──
            await client.query('COMMIT');
            senderBalance = parseFloat(debit.rows[0].balance_before);
            newSenderBalance = parseFloat(debit.rows[0].balance_after);
            recipientBalance = parseFloat(credit.rows[0].balance_after);
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) { /* releasing anyway */ }
            throw e;
        } finally {
            client.release();
        }

        // ── Notifications AFTER the transaction — a failure here must never
        // make a completed transfer appear failed or encourage a retry.
        try {
            await createNotification(req.user.id, {
                type: 'transaction', title: 'Transfer Sent',
                message: `${wantedCurrency} ${transferAmount.toFixed(2)} sent to ${recipientAccount.account_number}. Remaining balance: ${wantedCurrency} ${newSenderBalance.toFixed(2)}`,
            });
            await createNotification(recipientAccount.user_id, {
                type: 'transaction', title: 'Transfer Received',
                message: `${wantedCurrency} ${transferAmount.toFixed(2)} received from ${senderAccount.account_number}. New balance: ${wantedCurrency} ${recipientBalance.toFixed(2)}`,
            });
        } catch (notifErr) {
            console.warn('Transfer notification failure (transfer completed):', notifErr.message);
        }

        // In-memory alert for the receiver (best-effort, never fatal).
        try {
            const { demoStore } = require('../config/database');
            demoStore.alerts.push({
                id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                userId: recipientAccount.user_id,
                type: 'success',
                message: `You received ${wantedCurrency} ${transferAmount.toFixed(2)} from ${req.user.full_name || req.user.email}.`,
                severity: 'info', read: false, createdAt: new Date().toISOString(),
            });
        } catch (e) { /* alert is best-effort */ }

        res.json({
            success: true,
            message: `Successfully transferred ${wantedCurrency} ${transferAmount.toFixed(2)}`,
            transfer: {
                id: transferId,
                amount: transferAmount,
                fee,
                recipient: {
                    accountNumber: recipientAccount.account_number,
                    name: recipientAccount.account_name,
                },
                newBalance: newSenderBalance,
            }
        });
    } catch (error) {
        console.error('Transfer error:', error);
        res.status(500).json({ success: false, message: 'Transfer failed.' });
    }
});

// ============================================================
// GET /api/account/transfers — Get transfer history
// ============================================================
router.get('/api/account/transfers', authenticateToken, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const transfers = await getTransfers(req.user.id, {
            limit: parseInt(limit),
            offset: parseInt(offset),
        });

        res.json({
            success: true,
            transfers: transfers.map(t => ({
                id: t.id,
                amount: parseFloat(t.amount),
                currency: t.currency,
                fee: parseFloat(t.fee || 0),
                transferType: t.transfer_type,
                status: t.status,
                description: t.description,
                fromAccountNumber: t.from_account_id,
                toAccountNumber: t.to_account_id,
                fromUserName: t.from_user_name,
                toUserName: t.to_user_name,
                initiatedAt: t.initiated_at,
                completedAt: t.completed_at,
                createdAt: t.created_at,
            }))
        });
    } catch (error) {
        console.error('Get transfers error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch transfers.' });
    }
});

// ============================================================
// GET /api/account/statement — Generate account statement
// ============================================================
router.get('/api/account/statement', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate, format = 'json' } = req.query;

        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }

        let query = 'SELECT * FROM transactions WHERE user_id = $1 AND account_id = $2';
        const params = [req.user.id, account.id];
        let paramIndex = 3;

        if (startDate) {
            query += ` AND created_at >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }
        if (endDate) {
            query += ` AND created_at <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        query += ' ORDER BY created_at ASC';

        const result = await db.query(query, params);
        const transactions = result.rows;

        const statement = {
            account: {
                accountNumber: account.account_number,
                accountName: account.account_name,
                accountType: account.account_type,
            },
            period: {
                startDate: startDate || 'Account opening',
                endDate: endDate || new Date().toISOString(),
            },
            openingBalance: transactions.length > 0 ? parseFloat(transactions[0].balance_before) : parseFloat(account.balance),
            closingBalance: parseFloat(account.balance),
            totalDeposits: transactions.filter(t => parseFloat(t.amount) > 0).reduce((sum, t) => sum + parseFloat(t.amount), 0),
            totalWithdrawals: transactions.filter(t => parseFloat(t.amount) < 0).reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0),
            transactionCount: transactions.length,
            transactions: transactions.map(t => ({
                date: t.created_at,
                type: t.type,
                description: t.description,
                amount: parseFloat(t.amount),
                balance: parseFloat(t.balance_after),
                category: t.category,
                reference: t.external_reference,
            }))
        };

        res.json({ success: true, statement });
    } catch (error) {
        console.error('Statement error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate statement.' });
    }
});

// ============================================================
// GET /api/account/users/search?q= — Find REAL registered users
// Powers the Send Money recipient lookup by name / email /
// account number. Authenticated, self-excluded, safe fields only.
// ============================================================
router.get('/api/account/users/search', authenticateToken, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        if (q.length < 2) {
            return res.json({ success: true, users: [] });
        }
        const users = await searchUsers(q, req.user.id, 8);
        res.json({
            success: true,
            users: users.map(u => ({
                id: u.id,
                name: u.full_name || u.email,
                email: u.email,
                accountNumber: u.account_number,
                accountType: u.account_type,
                currency: u.currency,
            })),
        });
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ success: false, message: 'User search failed.' });
    }
});

module.exports = router;