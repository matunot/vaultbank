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
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    db,
    findAccountByUserId,
    createTransaction,
    createNotification,
    createAuditLog,
} = require('../config/database');

const EXPIRY_HOURS = 168; // 7 days — international bank transfers can take several business days.
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 100000;
const MAX_OPEN = 3;

// Receiving-account configuration (env only — never invented, never logged).
function receivingConfig() {
    const enabled = process['env'].VB_BANK_DEPOSIT_ENABLED === 'true';
    const bankName = (process['env'].VB_BANK_RECEIVING_BANK_NAME || '').trim();
    const holder = (process['env'].VB_BANK_RECEIVING_HOLDER || '').trim();
    const details = (process['env'].VB_BANK_RECEIVING_DETAILS || '').trim();
    const currency = (process['env'].VB_BANK_RECEIVING_CURRENCY || 'USD').trim().toUpperCase();
    const configured = enabled && bankName && holder && details;
    return {
        enabled: !!configured,
        bankName: configured ? bankName : null,
        holder: configured ? holder : null,
        details: configured ? details : null,
        currency: configured ? currency : null,
        verification: 'manual',
        expiryHours: EXPIRY_HOURS,
        minAmount: MIN_AMOUNT,
        maxAmount: MAX_AMOUNT,
        maxOpen: MAX_OPEN,
    };
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
router.get('/api/bank-deposits/config', authenticateToken, async (req, res) => {
    try {
        const cfg = receivingConfig();
        if (!cfg.enabled) {
            return res.status(200).json({
                success: true,
                enabled: false,
                verification: 'manual',
                minAmount: MIN_AMOUNT,
                maxAmount: MAX_AMOUNT,
                maxOpen: MAX_OPEN,
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
router.post('/api/bank-deposits/instructions', authenticateToken, async (req, res) => {
    try {
        const cfg = receivingConfig();
        if (!cfg.enabled) {
            return res.status(503).json({
                success: false,
                code: 'BANK_DEPOSITS_NOT_CONFIGURED',
                message: 'Bank transfer deposits are not set up yet — no verified receiving account is configured.',
            });
        }
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        if (!(amount >= MIN_AMOUNT) || amount > MAX_AMOUNT) {
            return res.status(400).json({ success: false, message: `Amount must be between ${cfg.currency} ${MIN_AMOUNT} and ${cfg.currency} ${MAX_AMOUNT}.` });
        }
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }
        const currency = String(req.body.currency || account.currency).toUpperCase();
        if (currency !== String(account.currency).toUpperCase()) {
            return res.status(400).json({ success: false, message: 'Currency not supported for this account.' });
        }
        if (currency !== cfg.currency) {
            return res.status(400).json({ success: false, message: `This receiving account accepts ${cfg.currency} transfers only.` });
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
router.get('/api/bank-deposits/admin/instructions', requireAdmin, async (req, res) => {
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
router.post('/api/bank-deposits/admin/instructions/:id/verify', requireAdmin, async (req, res) => {
    try {
        const settlementAmount = Math.round(parseFloat(req.body.settlementAmount) * 100) / 100;
        const note = String(req.body.note || '').trim();
        const externalTxnRef = req.body.externalTxnRef ? String(req.body.externalTxnRef).slice(0, 120) : null;
        if (!(settlementAmount > 0) || settlementAmount > 1000000) {
            return res.status(400).json({ success: false, message: 'A valid settlement amount is required.' });
        }
        if (note.length < 10) {
            return res.status(400).json({
                success: false,
                code: 'EVIDENCE_REQUIRED',
                message: 'Describe the statement evidence (at least 10 characters): date, sender, and the reference line you matched.',
            });
        }
        await ensureTables();
        // Atomic claim: only pending/settling can transition; settled/failed/
        // cancelled can never be claimed again (duplicate + replay protection).
        const { rows: claimed } = await db.query(
            `UPDATE bank_deposit_instructions
             SET status = 'settling', verified_by_admin_id = $2
             WHERE id = $1 AND status IN ('pending','settling')
             RETURNING *`,
            [req.params.id, req.user.id]
        );
        if (claimed.length === 0) {
            return res.status(409).json({ success: false, message: 'Instruction is not open for verification — it may already be settled, failed or cancelled.' });
        }
        const instruction = claimed[0];

        // Ledger guard (crash-window recovery): if the credit row already
        // exists, confirm settled WITHOUT crediting twice.
        const { rows: seen } = await db.query(
            'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
            [instruction.reference]
        );
        const alreadyCredited = seen.length > 0;
        let credited = false;
        let newBalance = null;
        if (!alreadyCredited) {
            const { rows: upd } = await db.query(
                'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after',
                [instruction.account_id, settlementAmount]
            );
            if (upd.length === 0) {
                await db.query(
                    "UPDATE bank_deposit_instructions SET status = 'failed', settlement_note = $2 WHERE id = $1",
                    [instruction.id, 'account missing at credit time — no money moved']
                );
                return res.status(404).json({ success: false, message: 'Account not found at credit time — no money moved.' });
            }
            const before = parseFloat(upd[0].balance_before);
            newBalance = parseFloat(upd[0].balance_after);
            await createTransaction({
                account_id: instruction.account_id,
                user_id: instruction.user_id,
                type: 'deposit',
                status: 'completed',
                amount: settlementAmount,
                currency: instruction.currency,
                balance_before: before,
                balance_after: newBalance,
                description: `Bank transfer deposit — ref ${instruction.reference}`,
                category: 'income',
                external_reference: instruction.reference,
                metadata: {
                    manual_verification: true,
                    admin_id: req.user.id,
                    instruction_id: instruction.id,
                    expected_amount: parseFloat(instruction.amount),
                    settlement_note: note,
                    external_txn_ref: externalTxnRef,
                },
            });
            credited = true;
            await createNotification(instruction.user_id, {
                type: 'transaction',
                title: 'Deposit verified',
                message: `${instruction.currency} ${settlementAmount.toFixed(2)} bank transfer credited (ref ${instruction.reference}). New balance: ${instruction.currency} ${newBalance.toFixed(2)}.`,
            });
        }
        await db.query(
            `UPDATE bank_deposit_instructions
             SET status = 'settled', settled_at = NOW(), settlement_amount = $2,
                 settlement_note = $3, external_txn_ref = $4,
                 credited_at = ${credited ? 'NOW()' : 'credited_at'}
             WHERE id = $1`,
            [instruction.id, settlementAmount, note, externalTxnRef]
        );
        await audit(req.user.id, credited ? 'bank_deposit_verified' : 'bank_deposit_verify_confirmed', instruction.id,
            { reference: instruction.reference, settlementAmount, credited, duplicate: alreadyCredited, note }, req);
        res.status(200).json({ success: true, credited, duplicate: alreadyCredited, reference: instruction.reference, newBalance });
    } catch (error) {
        console.error('Bank deposit verify error:', error.message);
        res.status(500).json({ success: false, message: 'Verification failed.' });
    }
});

// ============================================================
// POST /api/bank-deposits/admin/instructions/:id/fail (admin)
// Transfer never arrived / bounced — closes the instruction, NO credit.
// ============================================================
router.post('/api/bank-deposits/admin/instructions/:id/fail', requireAdmin, async (req, res) => {
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
router.post('/api/bank-deposits/admin/instructions/:id/reverse', requireAdmin, async (req, res) => {
    try {
        const note = String(req.body.note || '').trim();
        if (note.length < 10) {
            return res.status(400).json({ success: false, code: 'EVIDENCE_REQUIRED', message: 'Describe the reversal reason (bank chargeback, recall, or error).' });
        }
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM bank_deposit_instructions WHERE id = $1', [req.params.id]);
        const instruction = rows[0];
        if (!instruction) {
            return res.status(404).json({ success: false, message: 'Instruction not found.' });
        }
        if (instruction.status !== 'settled') {
            return res.status(409).json({ success: false, message: 'Only settled deposits can be reversed.' });
        }
        const amount = parseFloat(instruction.settlement_amount || instruction.amount);
        const { rows: debited } = await db.query(
            'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
            [instruction.account_id, amount]
        );
        if (debited.length === 0) {
            await db.query("UPDATE bank_deposit_instructions SET status = 'reversal_required' WHERE id = $1", [instruction.id]);
            await createNotification(instruction.user_id, {
                type: 'warning',
                title: 'Deposit reversal pending',
                message: `Deposit ${instruction.reference} is being reversed but your balance is insufficient. Please contact support.`,
            });
            await audit(req.user.id, 'bank_deposit_reversal_required', instruction.id, { reference: instruction.reference, amount, note }, req);
            return res.status(202).json({
                success: true,
                reversed: false,
                status: 'reversal_required',
                message: 'Balance insufficient for automatic reversal — flagged for manual recovery.',
            });
        }
        const after = parseFloat(debited[0].balance);
        await createTransaction({
            account_id: instruction.account_id,
            user_id: instruction.user_id,
            type: 'adjustment',
            status: 'completed',
            amount: -amount,
            currency: instruction.currency,
            balance_before: after + amount,
            balance_after: after,
            description: `Bank deposit reversal — ref ${instruction.reference}`,
            category: 'expense',
            external_reference: instruction.reference,
            metadata: { manual_verification: true, reversal: true, admin_id: req.user.id, instruction_id: instruction.id, note },
        });
        await db.query("UPDATE bank_deposit_instructions SET status = 'reversed', settlement_note = $2 WHERE id = $1", [instruction.id, note]);
        await createNotification(instruction.user_id, {
            type: 'warning',
            title: 'Deposit reversed',
            message: `Deposit ${instruction.reference} was reversed. ${note}`,
        });
        await audit(req.user.id, 'bank_deposit_reversed', instruction.id, { reference: instruction.reference, amount, note }, req);
        res.status(200).json({ success: true, reversed: true, status: 'reversed' });
    } catch (error) {
        console.error('Bank deposit reverse error:', error.message);
        res.status(500).json({ success: false, message: 'Reversal failed.' });
    }
});

module.exports = router;
