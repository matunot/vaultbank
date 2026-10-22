/**
 * VaultBank External Payouts — outbound INR transfers through a REAL payout
 * provider (Cashfree Payouts today), fail-closed until credentials exist.
 *
 * Money discipline (mirrors the USDC withdrawal rail contract):
 *   1. Reservation FIRST: a guarded, atomic balance decrement + a payout row
 *      claimed by a UNIQUE transfer id BEFORE any provider call.
 *   2. transferId is OUR idempotency key — the provider rejects duplicates, so
 *      a retried request can never double-send.
 *   3. Beneficiary details are validated server-side and bound to the user
 *      (beneId derived from the user id; a mismatch is refused).
 *   4. Terminal state comes ONLY from the provider's Check Status API —
 *      elapsed time, client callbacks, or redirects never mark a payout done.
 *   5. SAFE provider rejection (transfer explicitly not accepted) refunds the
 *      reservation exactly once. AMBIGUOUS failures (network error, unknown
 *      whether the provider accepted) NEVER auto-refund — the row is flagged
 *      'reconciliation_required' for operator review, like the USDC holds.
 *   6. Fail-closed: with no configured payout provider the route answers 503
 *      and moves nothing.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    db,
    findUserById,
    createTransaction,
    createNotification,
    createAuditLog,
} = require('../config/database');
const { activePayoutProvider, payoutAvailability } = require('../payouts');

const CURRENCY = 'INR';
const MIN_AMOUNT = 10;
const MAX_AMOUNT = 500000; // INR 5,00,000 per transfer until tuned by ops policy.

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_ACCOUNT_RE = /^[0-9]{6,20}$/;

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS payout_requests (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id UUID NOT NULL,
            transfer_id TEXT NOT NULL UNIQUE,
            idempotency_key TEXT,
            bene_id TEXT NOT NULL,
            amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
            currency TEXT NOT NULL DEFAULT 'INR',
            destination_account_masked TEXT,
            destination_ifsc TEXT,
            status TEXT NOT NULL DEFAULT 'reserving'
                CHECK (status IN ('reserving','reserved','submitted','succeeded','failed_refunded','failed_unreserved','reconciliation_required')),
            provider_reference_id TEXT,
            utr TEXT,
            failure_reason TEXT,
            submitted_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    tablesReady = true;
}

async function audit(userId, action, resourceId, details, req) {
    try {
        await createAuditLog({
            userId,
            action,
            resourceType: 'payout_request',
            resourceId,
            details,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    } catch (_) { /* best-effort */ }
}

// ============================================================
// GET /api/payouts/availability — PUBLIC readiness booleans.
// Only configuration state, never secrets or user data.
// ============================================================
router.get('/api/payouts/availability', (req, res) => {
    res.status(200).json({ success: true, ...payoutAvailability(), currency: CURRENCY, minAmount: MIN_AMOUNT, maxAmount: MAX_AMOUNT });
});

// ============================================================
// GET /api/payouts/requests — my payout requests (owner-scoped)
// ============================================================
router.get('/api/payouts/requests', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query(
            'SELECT id, transfer_id, amount, currency, destination_account_masked, destination_ifsc, status, provider_reference_id, utr, failure_reason, created_at, completed_at FROM payout_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
            [req.user.id]
        );
        res.status(200).json({ success: true, requests: rows });
    } catch (error) {
        console.error('Payout list error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load your payout requests.' });
    }
});

// ============================================================
// POST /api/payouts/requests — reserve + submit a payout (auth)
// ============================================================
router.post('/api/payouts/requests', authenticateToken, async (req, res) => {
    try {
        const active = activePayoutProvider();
        if (!active) {
            return res.status(503).json({
                success: false,
                code: 'PAYOUTS_NOT_CONFIGURED',
                message: 'External withdrawals are not available yet — no authorized payout rail is configured.',
                availability: payoutAvailability(),
            });
        }
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        const bankAccount = String(req.body.bankAccount || '').trim();
        const ifsc = String(req.body.ifsc || '').trim().toUpperCase();
        const idempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : null;

        if (!(amount >= MIN_AMOUNT) || amount > MAX_AMOUNT) {
            return res.status(400).json({ success: false, message: `Amount must be between ${CURRENCY} ${MIN_AMOUNT} and ${CURRENCY} ${MAX_AMOUNT}.` });
        }
        if (!BANK_ACCOUNT_RE.test(bankAccount) || !IFSC_RE.test(ifsc)) {
            return res.status(400).json({ success: false, message: 'A valid bank account number and IFSC are required.' });
        }

        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        // Payouts debit the user's INR account — it must exist.
        const { rows: inrRows } = await db.query(
            "SELECT * FROM accounts WHERE user_id = $1 AND currency = $2 AND status = 'active' ORDER BY created_at ASC LIMIT 1",
            [req.user.id, CURRENCY]
        );
        if (inrRows.length === 0) {
            return res.status(409).json({ success: false, code: 'INR_ACCOUNT_REQUIRED', message: 'Payouts debit your INR account — open one first.' });
        }
        const inrAccount = inrRows[0];

        await ensureTables();

        // Idempotent replay: the same client key returns the original request.
        if (idempotencyKey) {
            const { rows: existing } = await db.query(
                'SELECT * FROM payout_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                [req.user.id, idempotencyKey]
            );
            if (existing.length > 0) {
                res.setHeader('Idempotent-Replay', 'true');
                return res.status(200).json({ success: true, replay: true, payout: existing[0] });
            }
        }

        const transferId = 'VBPO-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase();
        const beneId = 'VBU-' + String(req.user.id).replace(/-/g, '').slice(0, 24).toUpperCase();

        // 1. Claim the payout row (UNIQUE transfer_id = idempotency backstop).
        const { rows: claimedRows } = await db.query(
            `INSERT INTO payout_requests (user_id, account_id, transfer_id, idempotency_key, bene_id, amount, currency, destination_account_masked, destination_ifsc, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserving')
             RETURNING *`,
            [req.user.id, inrAccount.id, transferId, idempotencyKey, beneId, amount, CURRENCY, '****' + bankAccount.slice(-4), ifsc]
        );
        const payout = claimedRows[0];

        // 2. Atomic reservation: guarded decrement (insufficient funds -> release).
        const { rows: reserved } = await db.query(
            'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING (balance + $2) AS balance_before, balance AS balance_after',
            [inrAccount.id, amount]
        );
        if (reserved.length === 0) {
            await db.query("UPDATE payout_requests SET status = 'failed_unreserved', failure_reason = 'insufficient funds', updated_at = NOW() WHERE id = $1", [payout.id]);
            return res.status(400).json({ success: false, message: 'Insufficient INR balance.', payoutId: payout.id });
        }
        const before = parseFloat(reserved[0].balance_before);
        const after = parseFloat(reserved[0].balance_after);
        await db.query("UPDATE payout_requests SET status = 'reserved', updated_at = NOW() WHERE id = $1", [payout.id]);

        // 3. Ledger the reservation as a processing withdrawal (money is now held).
        await createTransaction({
            account_id: inrAccount.id,
            user_id: req.user.id,
            type: 'withdrawal',
            status: 'processing',
            amount: -amount,
            currency: CURRENCY,
            balance_before: before,
            balance_after: after,
            description: `External payout ${transferId} — to bank ****${bankAccount.slice(-4)}`,
            category: 'expense',
            external_reference: transferId,
            metadata: { provider: active.name, automatic: false, bene_id: beneId },
        });

        // 4. Provider submit. SAFE failure -> refund reservation; AMBIGUOUS -> hold.
        try {
            await active.adapter.ensureBeneficiary({ beneId, name: user.full_name, email: user.email, phone: user.phone, bankAccount, ifsc });
            const accepted = await active.adapter.requestTransfer({ transferId, beneId, amount });
            await db.query(
                `UPDATE payout_requests SET status = 'submitted', provider_reference_id = $2, utr = $3, submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [payout.id, accepted.referenceId, accepted.utr]
            );
            await audit(req.user.id, 'payout_submitted', transferId, { amount, provider: active.name }, req);
            return res.status(200).json({
                success: true,
                message: 'Payout submitted to the provider — the terminal status arrives after provider reconciliation.',
                payoutId: payout.id,
                transferId,
                status: 'submitted',
            });
        } catch (e) {
            const safe = e.safe === true;
            if (safe) {
                // Provider explicitly did NOT accept the transfer — refund the
                // reservation exactly once (guarded credit back).
                const { rows: refunded } = await db.query(
                    'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after',
                    [inrAccount.id, amount]
                );
                if (refunded.length > 0) {
                    const rBefore = parseFloat(refunded[0].balance_before);
                    const rAfter = parseFloat(refunded[0].balance_after);
                    await createTransaction({
                        account_id: inrAccount.id,
                        user_id: req.user.id,
                        type: 'refund',
                        status: 'completed',
                        amount,
                        currency: CURRENCY,
                        balance_before: rBefore,
                        balance_after: rAfter,
                        description: `Payout ${transferId} rejected by provider — funds returned`,
                        category: 'income',
                        external_reference: transferId + '-REFUND',
                        metadata: { provider: active.name, payout_id: payout.id, reason: e.message },
                    });
                    await createNotification(req.user.id, {
                        type: 'warning',
                        title: 'Payout rejected — funds returned',
                        message: `Your ${CURRENCY} ${amount.toFixed(2)} payout could not be sent and has been returned to your balance.`,
                    });
                }
                await db.query("UPDATE payout_requests SET status = 'failed_refunded', failure_reason = $2, updated_at = NOW() WHERE id = $1", [payout.id, e.message]);
                await audit(req.user.id, 'payout_failed_refunded', transferId, { reason: e.message }, req);
                return res.status(400).json({ success: false, message: 'Payout rejected by the provider — your funds were returned.', payoutId: payout.id, transferId });
            }
            // AMBIGUOUS: never auto-refund — flag for operator reconciliation.
            await db.query("UPDATE payout_requests SET status = 'reconciliation_required', failure_reason = $2, updated_at = NOW() WHERE id = $1", [payout.id, e.message]);
            await audit(req.user.id, 'payout_reconciliation_required', transferId, { reason: e.message }, req);
            return res.status(202).json({
                success: true,
                message: 'Payout submission was interrupted — it is queued for reconciliation. Your funds stay reserved until the provider confirms.',
                payoutId: payout.id,
                transferId,
                status: 'reconciliation_required',
            });
        }
    } catch (error) {
        console.error('Payout request error:', error.message);
        res.status(500).json({ success: false, message: 'Could not submit the payout request.' });
    }
});

// ============================================================
// GET /api/payouts/requests/:id — owner status view (auth)
// ============================================================
router.get('/api/payouts/requests/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [req.params.id]);
        const payout = rows[0];
        if (!payout || payout.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Payout request not found.' });
        }
        res.status(200).json({ success: true, payout });
    } catch (error) {
        console.error('Payout status error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the payout request.' });
    }
});

// ============================================================
// POST /api/payouts/requests/:id/reconcile — authoritative status refresh
// Terminal state comes ONLY from the provider status API (docs).
// ============================================================
router.post('/api/payouts/requests/:id/reconcile', authenticateToken, async (req, res) => {
    try {
        const active = activePayoutProvider();
        if (!active) {
            return res.status(503).json({ success: false, code: 'PAYOUTS_NOT_CONFIGURED', message: 'No payout rail is configured.' });
        }
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [req.params.id]);
        const payout = rows[0];
        if (!payout || payout.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Payout request not found.' });
        }
        if (payout.status === 'succeeded' || payout.status === 'failed_refunded' || payout.status === 'failed_unreserved') {
            return res.status(200).json({ success: true, payout, message: 'Terminal status already reached.' });
        }
        const status = await active.adapter.getTransferStatus({ transferId: payout.transfer_id });
        if (!status) {
            return res.status(200).json({ success: true, payout, message: 'Provider has no record yet — retry reconciliation later.' });
        }
        if (status.status === 'SUCCESS') {
            await db.query("UPDATE payout_requests SET status = 'succeeded', utr = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $1", [payout.id, status.utr || payout.utr]);
            await db.query("UPDATE transactions SET status = 'completed' WHERE external_reference = $1", [payout.transfer_id]);
            await createNotification(payout.user_id, {
                type: 'transaction',
                title: 'Payout completed',
                message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was sent to your bank (UTR ${status.utr || 'n/a'}).`,
            });
        } else if (status.status === 'ERROR' || status.status === 'REVERSED') {
            // Provider-authoritative failure AFTER submission: refund exactly
            // once, guarded by the existence of the refund ledger row.
            const { rows: refundSeen } = await db.query(
                'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
                [payout.transfer_id + '-REFUND']
            );
            if (refundSeen.length === 0) {
                const { rows: refunded } = await db.query(
                    'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after',
                    [payout.account_id, parseFloat(payout.amount)]
                );
                if (refunded.length > 0) {
                    const rBefore = parseFloat(refunded[0].balance_before);
                    const rAfter = parseFloat(refunded[0].balance_after);
                    await createTransaction({
                        account_id: payout.account_id,
                        user_id: payout.user_id,
                        type: 'refund',
                        status: 'completed',
                        amount: parseFloat(payout.amount),
                        currency: CURRENCY,
                        balance_before: rBefore,
                        balance_after: rAfter,
                        description: `Payout ${payout.transfer_id} failed at the bank — funds returned`,
                        category: 'income',
                        external_reference: payout.transfer_id + '-REFUND',
                        metadata: { provider: active.name, payout_id: payout.id, utr: status.utr },
                    });
                    await createNotification(payout.user_id, {
                        type: 'warning',
                        title: 'Payout failed at the bank — funds returned',
                        message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was returned to your balance.`,
                    });
                }
            }
            await db.query("UPDATE payout_requests SET status = 'failed_refunded', failure_reason = $2, updated_at = NOW() WHERE id = $1", [payout.id, 'provider reported ' + status.status]);
            await db.query("UPDATE transactions SET status = 'failed' WHERE external_reference = $1", [payout.transfer_id]);
        }
        const { rows: fresh } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [payout.id]);
        res.status(200).json({ success: true, payout: fresh[0] });
    } catch (error) {
        console.error('Payout reconcile error:', error.message);
        res.status(500).json({ success: false, message: 'Reconciliation failed — retry later.' });
    }
});

// ============================================================
// GET /api/payouts/admin/requests — operator queue (admin)
// ============================================================
router.get('/api/payouts/admin/requests', requireAdmin, async (req, res) => {
    try {
        await ensureTables();
        const status = req.query.status ? String(req.query.status) : null;
        const { rows } = await db.query(
            status
                ? 'SELECT * FROM payout_requests WHERE status = $1 ORDER BY created_at DESC LIMIT 100'
                : 'SELECT * FROM payout_requests ORDER BY created_at DESC LIMIT 100',
            status ? [status] : []
        );
        res.status(200).json({ success: true, requests: rows });
    } catch (error) {
        console.error('Payout admin list error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the payout queue.' });
    }
});

module.exports = router;
