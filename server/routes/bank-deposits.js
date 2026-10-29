/**
 * VaultBank Bank-Transfer Deposit Rail — REAL money in, manually verified.
 *
 * This is the only production rail that can credit a real balance without an
 * external payment API:
 *   1. The user receives authentic transfer instructions carrying a UNIQUE
 *      payment reference — shown ONLY when a real receiving account is
 *      configured (VB_BANK_* env). Nothing is invented, ever.
 *   2. Creating an instruction NEVER credits anything. The money stays
 *      "pending" until settlement is proven.
 *   3. Money enters the ledger ONLY after an authorized admin confirms the
 *      arrival on an authentic bank statement (manual verification — labeled
 *      as manual everywhere; never described as automatic).
 *   4. Verification is atomic + idempotent: a status claim (pending/settling
 *      only), a ledger guard on the reference, and a RETURNING-based atomic
 *      credit. Duplicates, retries, crashes and concurrent admins cannot
 *      double-credit.
 *   5. Reversal is a compensating guarded debit — ledger history is never
 *      deleted. Insufficient balance flags 'reversal_required' instead of
 *      forcing a negative balance.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
    ensureVaultLedgerSchema,
    ensureCustomerLedgerAccount,
    changeVerifiedAvailableBalance,
    postBalancedJournal,
    toMinorUnits,
} = require('../services/ledgerJournalService');
const STATEMENT_REF_RE = /^[A-Za-z0-9-]{8,120}$/;

const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    db,
    findAccountByUserIdAndCurrency,
    createTransaction,
    createNotification,
    createAuditLog,
} = require('../config/database');

const EXPIRY_HOURS = 168; // 7 days — international bank transfers can take several business days.
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 100000;
const MAX_OPEN = 3;

// Receiving-account configuration (env only — never invented, never logged).
// Customer deposit instructions and receiving details are limited to verified
// customers. Admins retain access for the controlled pilot and reconciliation.
function requireVerifiedDepositCustomerOrAdmin(req, res, next) {
    if (req.user && ['admin', 'super_admin'].includes(req.user.role)) return next();
    if (!req.user || req.user.email_verified !== true || req.user.kyc_status !== 'verified') {
        return res.status(403).json({
            success: false,
            code: 'CUSTOMER_VERIFICATION_REQUIRED',
            message: 'Verify your email and complete identity verification before receiving real-money deposit instructions.',
        });
    }
    return next();
}

const DEPOSIT_CURRENCIES = ['INR', 'USD'];

// Currency-specific receiving accounts are preferred. The original
// VB_BANK_RECEIVING_* variables remain supported for a single legacy currency.
// Details are returned only to authenticated, verified customers and only
// when an operator has explicitly enabled the rail and fully configured them.
function configuredReceivingCurrency(currency) {
    const selected = String(currency || '').trim().toUpperCase();
    const enabledFlag = process['env'].VB_BANK_DEPOSIT_ENABLED === 'true';
    const base = {
        enabled: false,
        bankName: null,
        holder: null,
        details: null,
        currency: selected || null,
        verification: 'manual',
        reason: 'receiving-account-not-configured',
        expiryHours: EXPIRY_HOURS,
        minAmount: MIN_AMOUNT,
        maxAmount: MAX_AMOUNT,
        maxOpen: MAX_OPEN,
    };
    if (!DEPOSIT_CURRENCIES.includes(selected)) return { ...base, reason: 'unsupported-ledger-currency' };
    if (!enabledFlag) return { ...base, reason: 'disabled-by-operator' };

    const prefix = 'VB_BANK_RECEIVING_' + selected + '_';
    const specificBank = String(process['env'][prefix + 'BANK_NAME'] || '').trim();
    const specificHolder = String(process['env'][prefix + 'HOLDER'] || '').trim();
    const specificDetails = String(process['env'][prefix + 'DETAILS'] || '').trim();
    const hasSpecificConfig = !!(specificBank || specificHolder || specificDetails);
    if (hasSpecificConfig) {
        const configured = !!(specificBank && specificHolder && specificDetails);
        return {
            ...base,
            enabled: configured,
            bankName: configured ? specificBank : null,
            holder: configured ? specificHolder : null,
            details: configured ? specificDetails : null,
            reason: configured ? null : 'receiving-account-not-configured',
        };
    }

    // Backward compatibility: the old generic variables describe exactly one
    // currency. Never silently route an INR request to USD bank details or vice versa.
    const legacyCurrency = String(process['env'].VB_BANK_RECEIVING_CURRENCY || 'USD').trim().toUpperCase();
    if (legacyCurrency !== selected) return base;
    const bankName = String(process['env'].VB_BANK_RECEIVING_BANK_NAME || '').trim();
    const holder = String(process['env'].VB_BANK_RECEIVING_HOLDER || '').trim();
    const details = String(process['env'].VB_BANK_RECEIVING_DETAILS || '').trim();
    const configured = !!(bankName && holder && details);
    return {
        ...base,
        enabled: configured,
        bankName: configured ? bankName : null,
        holder: configured ? holder : null,
        details: configured ? details : null,
        reason: configured ? null : 'receiving-account-not-configured',
    };
}

function receivingConfig(currency) {
    const currencies = DEPOSIT_CURRENCIES.filter((candidate) => configuredReceivingCurrency(candidate).enabled);
    if (currency != null && String(currency).trim()) {
        return { ...configuredReceivingCurrency(currency), currencies };
    }
    const legacyCurrency = String(process['env'].VB_BANK_RECEIVING_CURRENCY || 'USD').trim().toUpperCase();
    const preferred = currencies.includes(legacyCurrency) ? legacyCurrency : (currencies[0] || (DEPOSIT_CURRENCIES.includes(legacyCurrency) ? legacyCurrency : 'USD'));
    return { ...configuredReceivingCurrency(preferred), currencies };
}

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS bank_deposit_instructions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id UUID NOT NULL,
            reference TEXT NOT NULL UNIQUE,
            amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
            currency TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','settling','settled','failed','cancelled','expired','reversed','reversal_required')),
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            settled_at TIMESTAMP WITH TIME ZONE,
            verified_by_admin_id UUID,
            settlement_amount NUMERIC(15,2),
            settlement_note TEXT,
            external_txn_ref TEXT,
            credited_at TIMESTAMP WITH TIME ZONE
        )
    `);
    // A bank UTR may settle at most one VaultBank deposit instruction.
    // If legacy duplicates exist, refuse to enable verification until reviewed.
    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS bank_deposit_external_txn_ref_uq
        ON bank_deposit_instructions (external_txn_ref)
        WHERE external_txn_ref IS NOT NULL
    `);
    tablesReady = true;
}

async function sweepExpired() {
    // Instructions past their window are closed without any credit.
    await db.query("UPDATE bank_deposit_instructions SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()");
}

function serializeInstruction(r) {
    return {
        id: r.id,
        reference: r.reference,
        amount: parseFloat(r.amount),
        currency: r.currency,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        settledAt: r.settled_at || null,
        settlementAmount: r.settlement_amount != null ? parseFloat(r.settlement_amount) : null,
    };
}

async function audit(userId, action, resourceId, details, req) {
    try {
        await createAuditLog({
            userId,
            action,
            resourceType: 'bank_deposit_instruction',
            resourceId,
            details,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    } catch (e) { /* audit is best-effort; money paths above are already atomic */ }
}

// ============================================================
// GET /api/bank-deposits/config — is the rail configured? (auth)
// ============================================================
router.get('/api/bank-deposits/config', authenticateToken, requireVerifiedDepositCustomerOrAdmin, async (req, res) => {
    try {
        const requestedCurrency = String(req.query && req.query.currency || '').trim().toUpperCase();
        if (requestedCurrency && !DEPOSIT_CURRENCIES.includes(requestedCurrency)) {
            return res.status(400).json({ success: false, code: 'UNSUPPORTED_CURRENCY', message: 'Choose INR or USD.' });
        }
        const cfg = receivingConfig(requestedCurrency || undefined);
        if (!cfg.enabled) {
            // Never include account-holder or destination fields for a disabled rail.
            return res.status(200).json({
                success: true,
                enabled: false,
                currency: requestedCurrency || cfg.currency,
                currencies: cfg.currencies || [],
                verification: 'manual',
                reason: cfg.reason,
                minAmount: MIN_AMOUNT,
                maxAmount: MAX_AMOUNT,
                maxOpen: MAX_OPEN,
                expiryHours: EXPIRY_HOURS,
            });
        }
        await ensureTables();
        await sweepExpired();
        const { rows } = await db.query(
            "SELECT COUNT(*) AS open_count FROM bank_deposit_instructions WHERE user_id = $1 AND status = 'pending'",
            [req.user.id]
        );
        res.status(200).json({ success: true, ...cfg, openCount: Number(rows[0].open_count) });
    } catch (error) {
        console.error('Bank deposit config error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load bank deposit configuration.' });
    }
});

// ============================================================
// POST /api/bank-deposits/instructions — create a deposit instruction
// ============================================================
router.post('/api/bank-deposits/instructions', authenticateToken, requireVerifiedDepositCustomerOrAdmin, async (req, res) => {
    try {
        const requestedCurrency = String(req.body && req.body.currency || '').trim().toUpperCase();
        if (requestedCurrency && !DEPOSIT_CURRENCIES.includes(requestedCurrency)) {
            return res.status(400).json({ success: false, code: 'UNSUPPORTED_CURRENCY', message: 'Choose INR or USD.' });
        }
        const cfg = receivingConfig(requestedCurrency || undefined);
        if (!cfg.enabled) {
            return res.status(503).json({
                success: false,
                code: 'BANK_DEPOSITS_NOT_CONFIGURED',
                message: 'Bank transfer deposits are not set up for the selected currency — no verified receiving account is configured.',
            });
        }
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        if (!(amount >= MIN_AMOUNT) || amount > MAX_AMOUNT) {
            return res.status(400).json({ success: false, message: `Amount must be between ${cfg.currency} ${MIN_AMOUNT} and ${cfg.currency} ${MAX_AMOUNT}.` });
        }
        // Resolve an account in the receiving rail's actual currency; never
        // silently use the customer's primary account (which may be USD while
        // the configured receiving account accepts INR, or vice versa).
        const currency = requestedCurrency || cfg.currency;
        if (currency !== cfg.currency) {
            return res.status(400).json({ success: false, message: `This receiving account accepts ${cfg.currency} transfers only.` });
        }
        const account = await findAccountByUserIdAndCurrency(req.user.id, currency);
        if (!account) {
            return res.status(409).json({
                success: false,
                code: 'CURRENCY_ACCOUNT_REQUIRED',
                message: `Open an active ${currency} VaultBank account before creating this deposit instruction.`,
            });
        }
        await ensureTables();
        await sweepExpired();
        const { rows: open } = await db.query(
            "SELECT COUNT(*) AS open_count FROM bank_deposit_instructions WHERE user_id = $1 AND status = 'pending'",
            [req.user.id]
        );
        if (Number(open[0].open_count) >= MAX_OPEN) {
            return res.status(429).json({
                success: false,
                code: 'TOO_MANY_OPEN_INSTRUCTIONS',
                message: `You already have ${MAX_OPEN} open deposit instructions. Complete or cancel one first.`,
            });
        }
        const reference = `VB-BD-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 8).toUpperCase()}`;
        const { rows } = await db.query(
            `INSERT INTO bank_deposit_instructions (user_id, account_id, reference, amount, currency, expires_at)
             VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval)
             RETURNING *`,
            [req.user.id, account.id, reference, amount, currency, String(EXPIRY_HOURS)]
        );
        const instruction = rows[0];
        await audit(req.user.id, 'bank_deposit_instruction_created', instruction.id, { amount, currency, reference }, req);
        res.status(200).json({
            success: true,
            instruction: serializeInstruction(instruction),
            transfer: {
                bankName: cfg.bankName,
                holder: cfg.holder,
                details: cfg.details,
                currency,
                amount,
                reference: instruction.reference,
                note: `Send exactly ${currency} ${amount.toFixed(2)} and include reference ${instruction.reference} in the transfer description. Your balance is credited after our team verifies the arrival on the bank statement (manual verification, typically 1-3 business days).`,
            },
        });
    } catch (error) {
        console.error('Bank deposit instruction error:', error.message);
        res.status(500).json({ success: false, message: 'Could not create the deposit instruction.' });
    }
});

// ============================================================
// GET /api/bank-deposits/instructions — my instructions (auth)
// ============================================================
router.get('/api/bank-deposits/instructions', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        await sweepExpired();
        const { rows } = await db.query(
            'SELECT * FROM bank_deposit_instructions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
            [req.user.id]
        );
        res.status(200).json({ success: true, instructions: rows.map(serializeInstruction) });
    } catch (error) {
        console.error('Bank deposit list error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load your deposit instructions.' });
    }
});

// ============================================================
// GET /api/bank-deposits/instructions/:id — status (owner only)
// ============================================================
router.get('/api/bank-deposits/instructions/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        await sweepExpired();
        const { rows } = await db.query('SELECT * FROM bank_deposit_instructions WHERE id = $1', [req.params.id]);
        const instruction = rows[0];
        if (!instruction || instruction.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Deposit instruction not found.' });
        }
        res.status(200).json({ success: true, instruction: serializeInstruction(instruction) });
    } catch (error) {
        console.error('Bank deposit status error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the deposit instruction.' });
    }
});

// ============================================================
// POST /api/bank-deposits/instructions/:id/cancel — user cancels (auth)
// ============================================================
router.post('/api/bank-deposits/instructions/:id/cancel', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query(
            "UPDATE bank_deposit_instructions SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *",
            [req.params.id, req.user.id]
        );
        if (rows.length === 0) {
            return res.status(409).json({ success: false, message: 'Instruction is not open — it may already be settled, cancelled or expired.' });
        }
        await audit(req.user.id, 'bank_deposit_instruction_cancelled', rows[0].id, { reference: rows[0].reference }, req);
        res.status(200).json({ success: true, instruction: serializeInstruction(rows[0]) });
    } catch (error) {
        console.error('Bank deposit cancel error:', error.message);
        res.status(500).json({ success: false, message: 'Could not cancel the deposit instruction.' });
    }
});

// ============================================================
// GET /api/bank-deposits/admin/instructions — review queue (admin)
// ============================================================
router.get('/api/bank-deposits/admin/instructions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureTables();
        await sweepExpired();
        const status = String(req.query.status || 'pending');
        const { rows } = await db.query(
            `SELECT i.*, u.full_name, u.email FROM bank_deposit_instructions i
             JOIN users u ON u.id = i.user_id
             WHERE i.status = $1 ORDER BY i.created_at DESC LIMIT 100`,
            [status]
        );
        res.status(200).json({
            success: true,
            instructions: rows.map((r) => Object.assign(serializeInstruction(r), {
                customerName: r.full_name,
                customerEmail: r.email,
            })),
        });
    } catch (error) {
        console.error('Bank deposit admin list error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the review queue.' });
    }
});

// ============================================================
// POST /api/bank-deposits/admin/instructions/:id/verify (admin)
// The ONLY credit path. Admin asserts authentic bank-statement evidence.
// ============================================================
router.post('/api/bank-deposits/admin/instructions/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
    let client = null;
    try {
        const settlementText = String(req.body && req.body.settlementAmount != null ? req.body.settlementAmount : '').trim();
        let settlementMinor;
        try { settlementMinor = toMinorUnits(settlementText); }
        catch (_) {
            return res.status(400).json({ success: false, code: 'SETTLEMENT_AMOUNT_INVALID', message: 'A valid positive settlement amount with at most two decimals is required.' });
        }
        const note = String(req.body && req.body.note || '').trim();
        const externalTxnRef = String(req.body && req.body.externalTxnRef || '').trim();
        if (note.length < 10 || note.length > 500) {
            return res.status(400).json({
                success: false,
                code: 'EVIDENCE_REQUIRED',
                message: 'Describe the authentic bank-statement line (10-500 characters), including date and sender/reference details.',
            });
        }
        if (!STATEMENT_REF_RE.test(externalTxnRef)) {
            return res.status(400).json({
                success: false,
                code: 'BANK_STATEMENT_REFERENCE_REQUIRED',
                message: 'Enter the unique bank transaction reference/UTR from the receiving bank statement.',
            });
        }

        await ensureVaultLedgerSchema();
        await ensureTables();
        client = await db.getClient();
        await client.query('BEGIN');
        const selected = await client.query(
            'SELECT * FROM bank_deposit_instructions WHERE id = $1 FOR UPDATE',
            [req.params.id]
        );
        const instruction = selected.rows[0];
        if (!instruction) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Deposit instruction not found.' });
        }
        if (!['pending', 'settling'].includes(instruction.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_NOT_PENDING', message: 'Only an unresolved deposit instruction can be verified.' });
        }
        if (new Date(instruction.expires_at).getTime() <= Date.now()) {
            await client.query("UPDATE bank_deposit_instructions SET status = 'expired' WHERE id = $1 AND status IN ('pending','settling')", [instruction.id]);
            await client.query('COMMIT');
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_EXPIRED', message: 'This instruction expired. Reconcile any actual arrival manually before starting another credit.' });
        }
        if (toMinorUnits(String(instruction.amount)) !== settlementMinor) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'BANK_DEPOSIT_AMOUNT_MISMATCH',
                message: 'The bank-statement amount must exactly match the deposit instruction. Do not auto-credit partial or excess payments.',
            });
        }
        if (instruction.external_txn_ref && instruction.external_txn_ref !== externalTxnRef) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_REFERENCE_MISMATCH', message: 'This instruction is already bound to a different bank transaction reference.' });
        }

        // Recover conservatively from a legacy split-write state. A pre-existing
        // transaction without its native journal cannot safely be auto-replayed:
        // the opening snapshot may already include the old credit.
        const priorTransactions = await client.query(
            'SELECT id, account_id, user_id, type, amount, currency FROM transactions WHERE external_reference = $1 LIMIT 2',
            [instruction.reference]
        );
        if (priorTransactions.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'BANK_DEPOSIT_RECONCILIATION_REQUIRED',
                message: 'A legacy ledger row already exists for this reference. No additional credit was made; reconcile this record before retrying.',
            });
        }

        const claimed = await client.query(
            `UPDATE bank_deposit_instructions
                SET status = 'settling', verified_by_admin_id = $2, external_txn_ref = $3
              WHERE id = $1 AND status IN ('pending','settling')
                AND (external_txn_ref IS NULL OR external_txn_ref = $3)
              RETURNING *`,
            [instruction.id, req.user.id, externalTxnRef]
        );
        if (!claimed.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_NOT_PENDING', message: 'The instruction was concurrently resolved. No credit was made.' });
        }

        await ensureCustomerLedgerAccount(client, instruction.account_id);
        await changeVerifiedAvailableBalance(client, instruction.account_id, settlementText, 'credit');
        const accountUpdate = await client.query(
            `UPDATE accounts
                SET balance = balance + $2, available_balance = available_balance + $2
              WHERE id = $1 AND user_id = $3 AND currency = $4 AND status = 'active'
              RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
            [instruction.account_id, settlementText, instruction.user_id, instruction.currency]
        );
        if (!accountUpdate.rows.length) {
            const error = new Error('Target account is missing, inactive, or has a different currency.');
            error.code = 'BANK_DEPOSIT_ACCOUNT_NOT_ACTIVE';
            throw error;
        }

        const before = String(accountUpdate.rows[0].balance_before);
        const after = String(accountUpdate.rows[0].balance_after);
        await createTransaction({
            account_id: instruction.account_id,
            user_id: instruction.user_id,
            type: 'deposit',
            status: 'completed',
            amount: settlementText,
            currency: instruction.currency,
            balance_before: before,
            balance_after: after,
            description: 'Bank transfer deposit — ref ' + instruction.reference,
            category: 'income',
            external_reference: instruction.reference,
            metadata: {
                manual_verification: true,
                admin_id: req.user.id,
                instruction_id: instruction.id,
                statement_reference: externalTxnRef,
                evidence_note: note,
            },
        }, client);

        await postBalancedJournal(client, {
            eventType: 'bank_deposit_settled',
            sourceType: 'bank_deposit_instruction',
            sourceId: String(instruction.id),
            currency: instruction.currency,
            description: 'VaultBank bank-transfer deposit verified against receiving-bank statement',
            actorUserId: req.user.id,
            metadata: { reference: instruction.reference, statementReference: externalTxnRef, verification: 'manual-bank-statement', evidenceNote: note },
            entries: [
                { systemCode: 'INBOUND_SETTLEMENT_ASSET', side: 'debit', amount: settlementText },
                { accountId: instruction.account_id, side: 'credit', amount: settlementText },
            ],
        });

        const completed = await client.query(
            `UPDATE bank_deposit_instructions
                SET status = 'settled', settled_at = NOW(), settlement_amount = $2,
                    settlement_note = $3, external_txn_ref = $4, credited_at = NOW()
              WHERE id = $1 AND status = 'settling'
              RETURNING *`,
            [instruction.id, settlementText, note, externalTxnRef]
        );
        if (!completed.rows.length) {
            const error = new Error('Deposit settlement state could not be finalized.');
            error.code = 'BANK_DEPOSIT_FINAL_STATE_FAILED';
            throw error;
        }
        await client.query('COMMIT');
        const newBalance = Number(after);
        try {
            await createNotification(instruction.user_id, {
                type: 'transaction',
                title: 'Deposit verified',
                message: String(instruction.currency) + ' ' + Number(settlementText).toFixed(2) + ' bank transfer credited (ref ' + instruction.reference + '). New balance: ' + String(instruction.currency) + ' ' + newBalance.toFixed(2) + '.',
            });
        } catch (_) {}
        await audit(req.user.id, 'bank_deposit_verified', instruction.id,
            { reference: instruction.reference, settlementAmount: Number(settlementText), credited: true, statementReference: externalTxnRef, note }, req);
        return res.status(200).json({ success: true, credited: true, duplicate: false, reference: instruction.reference, newBalance });
    } catch (error) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        if (error && error.code === '23505') {
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_REFERENCE_ALREADY_USED', message: 'This bank transaction reference has already been used. No additional credit was made.' });
        }
        if (error && error.code === 'VB_LEDGER_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: 'VaultBank ledger is not ready; no deposit credit was committed.' });
        }
        console.error('Bank deposit verify error:', error.message);
        return res.status(500).json({ success: false, message: 'Verification failed; no successful settlement should be assumed.' });
    } finally {
        if (client) client.release();
    }
});

// POST /api/bank-deposits/admin/instructions/:id/fail (admin)
// Transfer never arrived / bounced — closes the instruction, NO credit.
// ============================================================
router.post('/api/bank-deposits/admin/instructions/:id/fail', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const note = String(req.body.note || '').trim() || 'Marked failed by admin review.';
        await ensureTables();
        const { rows } = await db.query(
            "UPDATE bank_deposit_instructions SET status = 'failed', settlement_note = $3 WHERE id = $1 AND status IN ('pending','settling') RETURNING *",
            [req.params.id, req.user.id, note]
        );
        if (rows.length === 0) {
            return res.status(409).json({ success: false, message: 'Instruction is not open.' });
        }
        await createNotification(rows[0].user_id, {
            type: 'warning',
            title: 'Deposit not received',
            message: `Deposit instruction ${rows[0].reference} was closed: ${note}`,
        });
        await audit(req.user.id, 'bank_deposit_failed', rows[0].id, { reference: rows[0].reference, note }, req);
        res.status(200).json({ success: true, instruction: serializeInstruction(rows[0]) });
    } catch (error) {
        console.error('Bank deposit fail error:', error.message);
        res.status(500).json({ success: false, message: 'Could not mark the instruction failed.' });
    }
});

// ============================================================
// POST /api/bank-deposits/admin/instructions/:id/reverse (admin)
// Compensating guarded debit for a settled deposit (chargeback/recall).
// Never deletes ledger history; never forces a negative balance.
// ============================================================
router.post('/api/bank-deposits/admin/instructions/:id/reverse', authenticateToken, requireAdmin, async (req, res) => {
    let client = null;
    let needsReview = false;
    let instruction = null;
    let amountText = null;
    try {
        const note = String(req.body && req.body.note || '').trim();
        if (note.length < 10 || note.length > 500) {
            return res.status(400).json({ success: false, code: 'EVIDENCE_REQUIRED', message: 'Describe the bank reversal reason (10-500 characters).' });
        }
        await ensureVaultLedgerSchema();
        await ensureTables();
        client = await db.getClient();
        await client.query('BEGIN');
        const selected = await client.query(
            'SELECT * FROM bank_deposit_instructions WHERE id = $1 FOR UPDATE',
            [req.params.id]
        );
        instruction = selected.rows[0];
        if (!instruction) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Instruction not found.' });
        }
        if (!['settled', 'reversal_required'].includes(instruction.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_NOT_REVERSIBLE', message: 'Only a settled or pending-reversal deposit may be reversed.' });
        }
        amountText = String(instruction.settlement_amount || instruction.amount);
        await ensureCustomerLedgerAccount(client, instruction.account_id);

        // Only previously verified funds can be reversed automatically.
        // Unverified opening balances are not a source of spendable cash.
        try {
            await changeVerifiedAvailableBalance(client, instruction.account_id, amountText, 'debit');
        } catch (error) {
            if (!error || error.code !== 'VB_LEDGER_VERIFIED_FUNDS_INSUFFICIENT') throw error;
            await client.query(
                "UPDATE bank_deposit_instructions SET status = 'reversal_required', settlement_note = $2 WHERE id = $1",
                [instruction.id, note]
            );
            await client.query('COMMIT');
            needsReview = true;
        }

        if (!needsReview) {
            const debited = await client.query(
                `UPDATE accounts
                    SET balance = balance - $2, available_balance = available_balance - $2
                  WHERE id = $1 AND user_id = $3 AND currency = $4 AND status = 'active'
                    AND balance >= $2 AND available_balance >= $2
                  RETURNING (balance + $2) AS balance_before, balance AS balance_after`,
                [instruction.account_id, amountText, instruction.user_id, instruction.currency]
            );
            if (!debited.rows.length) {
                // The spendable account balance and verified-funds tracker are
                // one contract. Restore the tracker before flagging review.
                await changeVerifiedAvailableBalance(client, instruction.account_id, amountText, 'credit');
                await client.query(
                    "UPDATE bank_deposit_instructions SET status = 'reversal_required', settlement_note = $2 WHERE id = $1",
                    [instruction.id, note]
                );
                await client.query('COMMIT');
                needsReview = true;
            } else {
                const amount = amountText;
                await createTransaction({
                    account_id: instruction.account_id,
                    user_id: instruction.user_id,
                    type: 'adjustment',
                    status: 'completed',
                    amount: '-' + amount,
                    currency: instruction.currency,
                    balance_before: String(debited.rows[0].balance_before),
                    balance_after: String(debited.rows[0].balance_after),
                    description: 'Bank deposit reversal — ref ' + instruction.reference,
                    category: 'expense',
                    external_reference: instruction.reference + '-REVERSAL',
                    metadata: { manual_verification: true, reversal: true, admin_id: req.user.id, instruction_id: instruction.id, note },
                }, client);
                await postBalancedJournal(client, {
                    eventType: 'deposit_reversed',
                    sourceType: 'bank_deposit_instruction',
                    sourceId: String(instruction.id),
                    currency: instruction.currency,
                    description: 'VaultBank bank-transfer deposit reversed after bank recall/reversal evidence',
                    actorUserId: req.user.id,
                    metadata: { reference: instruction.reference, reversalNote: note },
                    entries: [
                        { accountId: instruction.account_id, side: 'debit', amount },
                        { systemCode: 'INBOUND_SETTLEMENT_ASSET', side: 'credit', amount },
                    ],
                });
                const updated = await client.query(
                    "UPDATE bank_deposit_instructions SET status = 'reversed', settlement_note = $2 WHERE id = $1 AND status IN ('settled','reversal_required') RETURNING id",
                    [instruction.id, note]
                );
                if (!updated.rows.length) {
                    const error = new Error('Deposit reversal state could not be finalized.');
                    error.code = 'BANK_DEPOSIT_REVERSAL_STATE_FAILED';
                    throw error;
                }
                await client.query('COMMIT');
            }
        }
        if (needsReview) {
            try {
                await createNotification(instruction.user_id, {
                    type: 'warning',
                    title: 'Deposit reversal needs review',
                    message: 'Deposit ' + instruction.reference + ' could not be debited automatically because available funds are insufficient. It has been flagged for reconciliation.',
                });
            } catch (_) {}
            await audit(req.user.id, 'bank_deposit_reversal_required', instruction.id,
                { reference: instruction.reference, amount: Number(amountText), note }, req);
            return res.status(202).json({
                success: true, reversed: false, status: 'reversal_required',
                message: 'Available balance is insufficient; the reversal remains flagged for manual recovery.',
            });
        }
        try {
            await createNotification(instruction.user_id, {
                type: 'warning',
                title: 'Deposit reversed',
                message: 'Deposit ' + instruction.reference + ' was reversed. ' + note,
            });
        } catch (_) {}
        await audit(req.user.id, 'bank_deposit_reversed', instruction.id,
            { reference: instruction.reference, amount: Number(amountText), note }, req);
        return res.status(200).json({ success: true, reversed: true, status: 'reversed' });
    } catch (error) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        if (error && error.code === '23505') {
            return res.status(409).json({ success: false, code: 'BANK_DEPOSIT_REVERSAL_ALREADY_POSTED', message: 'A reversal journal already exists for this instruction.' });
        }
        console.error('Bank deposit reverse error:', error.message);
        return res.status(500).json({ success: false, message: 'Reversal was not confirmed. Check the account ledger before retrying.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
module.exports.receivingConfig = receivingConfig;
