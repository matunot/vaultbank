/**
 * VaultBank External Payouts — outbound INR transfers through a REAL payout
 * provider (Cashfree Payouts today), fail-closed until credentials exist.
 *
 * Safety contract (Phase 1.7 hardened):
 *   1. ATOMIC reservation: the payout claim + balance decrement + ledger
 *      row run in ONE database transaction (BEGIN..COMMIT on ONE pooled
 *      client). No external calls inside the transaction.
 *   2. DB-ENFORCED idempotency: UNIQUE(user_id, idempotency_key) on the
 *      payout_requests table (migration 010). A concurrent duplicate gets
 *      a unique violation and returns the original payout as a replay —
 *      the provider is never called twice for the same logical payout.
 *   3. AVAILABLE-BALANCE guard: the reservation guards on available_balance
 *      (the spendable amount), not the total balance. Held funds are never
 *      spendable. Both balance and available_balance are updated on every
 *      debit/credit so the invariant available_balance = balance - held
 *      is preserved.
 *   4. Terminal state from provider ONLY: the reconcile route uses a
 *      status-transition guard (WHERE status NOT IN terminal) so concurrent
 *      or repeated reconciliations never double-refund or double-complete.
 *   5. SAFE provider rejection refunds EXACTLY ONCE (guarded by both the
 *      status transition and the refund ledger row's external_reference).
 *      AMBIGUOUS failures NEVER auto-refund — the row stays reserved with
 *      status 'reconciliation_required'.
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

// Terminal payout statuses — once reached, no further transitions.
const TERMINAL_STATUSES = ['succeeded', 'failed_refunded', 'failed_unreserved'];

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
    // DB-enforced idempotency: at most ONE payout per (user_id, idempotency_key).
    try {
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS payout_idempotency_user_key
            ON payout_requests (user_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
        `);
    } catch (idxErr) {
        // If duplicates exist, the index creation fails — operator must resolve.
        console.warn('payout_idempotency_user_key index ensure skipped:', idxErr.message);
    }
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
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.headers['user-agent'] : null,
        });
    } catch (_) { /* best-effort */ }
}

// ============================================================
// GET /api/payouts/availability — PUBLIC readiness booleans.
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
// POST /api/payouts/requests — atomic reserve + submit (auth)
// The reservation (claim + debit + ledger) is ONE database transaction.
// The provider call happens AFTER the transaction commits.
// ============================================================
router.post('/api/payouts/requests', authenticateToken, async (req, res) => {
    let active = null;
    let payoutId = null;
    let transferId = null;
    let inrAccount = null;
    let amount = 0;

    try {
        active = activePayoutProvider();
        if (!active) {
            return res.status(503).json({
                success: false,
                code: 'PAYOUTS_NOT_CONFIGURED',
                message: 'External withdrawals are not available yet — no authorized payout rail is configured.',
                availability: payoutAvailability(),
            });
        }
        amount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        const bankAccount = String(req.body.bankAccount || '').trim();
        const ifsc = String(req.body.ifsc || '').trim().toUpperCase();
        const idempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']).slice(0, 100) : null;

        if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            return res.status(400).json({ success: false, message: `Amount must be between ${CURRENCY} ${MIN_AMOUNT} and ${CURRENCY} ${MAX_AMOUNT}.` });
        }
        if (!BANK_ACCOUNT_RE.test(bankAccount) || !IFSC_RE.test(ifsc)) {
            return res.status(400).json({ success: false, message: 'A valid bank account number and IFSC are required.' });
        }

        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const { rows: inrRows } = await db.query(
            "SELECT * FROM accounts WHERE user_id = $1 AND currency = $2 AND status = 'active' ORDER BY created_at ASC LIMIT 1",
            [req.user.id, CURRENCY]
        );
        if (inrRows.length === 0) {
            return res.status(409).json({ success: false, code: 'INR_ACCOUNT_REQUIRED', message: 'Payouts debit your INR account — open one first.' });
        }
        inrAccount = inrRows[0];

        await ensureTables();
        transferId = 'VBPO-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase();
        const beneId = 'VBU-' + String(req.user.id).replace(/-/g, '').slice(0, 24).toUpperCase();

        // ── ATOMIC RESERVATION: ONE transaction for claim + debit + ledger ──
        const client = await db.getClient();
        let payoutRow = null;
        let reserved = null;
        try {
            await client.query('BEGIN');

            // 1. Claim the payout row. The UNIQUE(user_id, idempotency_key)
            //    index (migration 010) makes this atomic — a concurrent
            //    duplicate with the same key gets a unique violation.
            const claimResult = await client.query(
                `INSERT INTO payout_requests (user_id, account_id, transfer_id, idempotency_key, bene_id, amount, currency, destination_account_masked, destination_ifsc, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserving')
                 RETURNING *`,
                [req.user.id, inrAccount.id, transferId, idempotencyKey, beneId, amount, CURRENCY, '****' + bankAccount.slice(-4), ifsc]
            );
            payoutRow = claimResult.rows[0];
            payoutId = payoutRow.id;

            // 2. Guarded debit on available_balance (the spendable amount).
            //    Both balance and available_balance are updated so the
            //    invariant available_balance = balance - held is preserved.
            const debitResult = await client.query(
                `UPDATE accounts
                 SET balance = balance - $2, available_balance = available_balance - $2
                 WHERE id = $1 AND available_balance >= $2
                 RETURNING (balance + $2) AS balance_before, balance AS balance_after,
                           (available_balance + $2) AS available_before, available_balance AS available_after`,
                [inrAccount.id, amount]
            );
            if (debitResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Insufficient available INR balance.', availableBalance: parseFloat(inrAccount.available_balance) });
            }
            reserved = debitResult.rows[0];

            // 3. Ledger row for the reservation (withdrawal, processing).
            //    INSIDE the transaction — same client, no separate connection.
            await client.query(
                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                    balance_before, balance_after, description, category, external_reference, metadata)
                 VALUES ($1, $2, 'withdrawal', 'processing', $3, $4, $5, $6, $7, 'expense', $8, $9)`,
                [inrAccount.id, req.user.id, -amount, CURRENCY,
                 parseFloat(reserved.balance_before), parseFloat(reserved.balance_after),
                 `External payout ${transferId} — to bank ****${bankAccount.slice(-4)}`,
                 transferId,
                 JSON.stringify({ provider: active.name, automatic: false, bene_id: beneId })]
            );

            // 4. Mark the payout as reserved.
            await client.query(
                "UPDATE payout_requests SET status = 'reserved', updated_at = NOW() WHERE id = $1",
                [payoutId]
            );

            await client.query('COMMIT');
        } catch (txErr) {
            try { await client.query('ROLLBACK'); } catch (_) { /* releasing anyway */ }

            // DB-enforced idempotency: a concurrent duplicate with the same
            // (user_id, idempotency_key) hits the unique index. Return the
            // original payout as a replay — the provider was NOT called twice.
            if (txErr.code === '23505' && String(txErr.message || '').includes('payout_idempotency')) {
                const { rows: existing } = await db.query(
                    'SELECT * FROM payout_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                    [req.user.id, idempotencyKey]
                );
                if (existing.length > 0) {
                    res.setHeader('Idempotent-Replay', 'true');
                    return res.status(200).json({ success: true, replay: true, payout: existing[0] });
                }
            }
            throw txErr;
        } finally {
            client.release();
        }

        // ── Provider submission (OUTSIDE the DB transaction) ──
        // The reservation is committed. If the provider call fails:
        //   SAFE → refund (atomic transaction below)
        //   AMBIGUOUS → keep the reservation, flag for reconciliation
        try {
            await active.adapter.ensureBeneficiary({ beneId, name: user.full_name, email: user.email, phone: user.phone, bankAccount, ifsc });
            const accepted = await active.adapter.requestTransfer({ transferId, beneId, amount });
            await db.query(
                `UPDATE payout_requests SET status = 'submitted', provider_reference_id = $2, utr = $3, submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [payoutId, accepted.referenceId, accepted.utr]
            );
            await audit(req.user.id, 'payout_submitted', transferId, { amount, provider: active.name }, req);
            return res.status(200).json({
                success: true,
                message: 'Payout submitted to the provider — the terminal status arrives after provider reconciliation.',
                payoutId,
                transferId,
                status: 'submitted',
            });
        } catch (e) {
            const safe = e.safe === true;
            if (safe) {
                // ── SAFE rejection: refund EXACTLY ONCE in an atomic transaction ──
                const refundClient = await db.getClient();
                try {
                    await refundClient.query('BEGIN');

                    // Guarded status transition: only refund if not already terminal.
                    const claimStatus = await refundClient.query(
                        `UPDATE payout_requests SET status = 'failed_refunded', failure_reason = $2, updated_at = NOW()
                         WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')
                         RETURNING *`,
                        [payoutId, e.message]
                    );
                    if (claimStatus.rows.length === 0) {
                        // Already terminal (concurrent reconciliation) — no refund.
                        await refundClient.query('COMMIT'); // release the claim
                        return res.status(200).json({ success: true, message: 'Payout already resolved.', payoutId, transferId });
                    }

                    // Refund ledger guard: only refund if no refund row exists.
                    const { rows: refundSeen } = await refundClient.query(
                        'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
                        [transferId + '-REFUND']
                    );
                    if (refundSeen.length === 0) {
                        const { rows: refunded } = await refundClient.query(
                            `UPDATE accounts
                             SET balance = balance + $2, available_balance = available_balance + $2
                             WHERE id = $1
                             RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
                            [inrAccount.id, amount]
                        );
                        if (refunded.length > 0) {
                            await refundClient.query(
                                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                                    balance_before, balance_after, description, category, external_reference, metadata)
                                 VALUES ($1, $2, 'refund', 'completed', $3, $4, $5, $6, $7, 'income', $8, $9)`,
                                [inrAccount.id, req.user.id, amount, CURRENCY,
                                 parseFloat(refunded[0].balance_before), parseFloat(refunded[0].balance_after),
                                 `Payout ${transferId} rejected by provider — funds returned`,
                                 transferId + '-REFUND',
                                 JSON.stringify({ provider: active.name, payout_id: payoutId, reason: e.message })]
                            );
                        }
                    }
                    await refundClient.query('COMMIT');
                } catch (refundErr) {
                    try { await refundClient.query('ROLLBACK'); } catch (_) {}
                    throw refundErr;
                } finally {
                    refundClient.release();
                }

                // Notifications AFTER the refund commits — failure-tolerant.
                try {
                    await createNotification(req.user.id, {
                        type: 'warning',
                        title: 'Payout rejected — funds returned',
                        message: `Your ${CURRENCY} ${amount.toFixed(2)} payout could not be sent and has been returned to your balance.`,
                    });
                } catch (notifErr) {
                    console.warn('Payout refund notification failure (refund completed):', notifErr.message);
                }
                await audit(req.user.id, 'payout_failed_refunded', transferId, { reason: e.message }, req);
                return res.status(400).json({ success: false, message: 'Payout rejected by the provider — your funds were returned.', payoutId, transferId });
            }

            // ── AMBIGUOUS: NEVER auto-refund — flag for reconciliation ──
            await db.query(
                "UPDATE payout_requests SET status = 'reconciliation_required', failure_reason = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')",
                [payoutId, e.message]
            );
            await audit(req.user.id, 'payout_reconciliation_required', transferId, { reason: e.message }, req);
            return res.status(202).json({
                success: true,
                message: 'Payout submission was interrupted — it is queued for reconciliation. Your funds stay reserved until the provider confirms.',
                payoutId,
                transferId,
                status: 'reconciliation_required',
            });
        }
    } catch (error) {
        console.error('Payout request error:', error.message);
        // If we have a payoutId but the error isn't a handled case, flag for
        // reconciliation — the reservation is committed and must be resolved.
        if (payoutId && !TERMINAL_STATUSES.includes('pending')) {
            try {
                await db.query(
                    "UPDATE payout_requests SET status = 'reconciliation_required', failure_reason = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')",
                    [payoutId, 'unhandled: ' + error.message]
                );
            } catch (_) { /* best-effort flag */ }
        }
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
// Terminal state from the provider status API ONLY. Idempotent: a
// status-transition guard prevents concurrent/repeated reconciliations
// from double-refunding or double-completing.
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
        if (TERMINAL_STATUSES.includes(payout.status)) {
            return res.status(200).json({ success: true, payout, message: 'Terminal status already reached.' });
        }

        // Call the provider status API (OUTSIDE any DB transaction).
        const status = await active.adapter.getTransferStatus({ transferId: payout.transfer_id });
        if (!status) {
            return res.status(200).json({ success: true, payout, message: 'Provider has no record yet — retry reconciliation later.' });
        }

        if (status.status === 'SUCCESS') {
            // ── Idempotent success transition ──
            const { rows: transitioned } = await db.query(
                `UPDATE payout_requests SET status = 'succeeded', utr = $2, completed_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')
                 RETURNING *`,
                [payout.id, status.utr || payout.utr]
            );
            if (transitioned.length > 0) {
                await db.query("UPDATE transactions SET status = 'completed' WHERE external_reference = $1", [payout.transfer_id]);
                try {
                    await createNotification(payout.user_id, {
                        type: 'transaction',
                        title: 'Payout completed',
                        message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was sent to your bank (UTR ${status.utr || 'n/a'}).`,
                    });
                } catch (notifErr) {
                    console.warn('Payout success notification failure (payout completed):', notifErr.message);
                }
            }
        } else if (status.status === 'ERROR' || status.status === 'REVERSED') {
            // ── Idempotent refund: status-transition guard + atomic transaction ──
            const refundClient = await db.getClient();
            try {
                await refundClient.query('BEGIN');

                // Guard: only transition if not already terminal.
                const { rows: claimed } = await refundClient.query(
                    `UPDATE payout_requests SET status = 'failed_refunded', failure_reason = $2, updated_at = NOW()
                     WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')
                     RETURNING *`,
                    [payout.id, 'provider reported ' + status.status]
                );
                if (claimed.length === 0) {
                    // Already terminal (concurrent reconciliation) — no refund.
                    await refundClient.query('COMMIT');
                    const { rows: fresh } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [payout.id]);
                    return res.status(200).json({ success: true, payout: fresh[0], message: 'Already resolved by a concurrent reconciliation.' });
                }

                // Refund ledger guard: only refund if no refund row exists.
                const { rows: refundSeen } = await refundClient.query(
                    'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
                    [payout.transfer_id + '-REFUND']
                );
                if (refundSeen.length === 0) {
                    const refundAmount = parseFloat(payout.amount);
                    const { rows: refunded } = await refundClient.query(
                        `UPDATE accounts
                         SET balance = balance + $2, available_balance = available_balance + $2
                         WHERE id = $1
                         RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
                        [payout.account_id, refundAmount]
                    );
                    if (refunded.length > 0) {
                        await refundClient.query(
                            `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                                balance_before, balance_after, description, category, external_reference, metadata)
                             VALUES ($1, $2, 'refund', 'completed', $3, $4, $5, $6, $7, 'income', $8, $9)`,
                            [payout.account_id, payout.user_id, refundAmount, CURRENCY,
                             parseFloat(refunded[0].balance_before), parseFloat(refunded[0].balance_after),
                             `Payout ${payout.transfer_id} failed at the bank — funds returned`,
                             payout.transfer_id + '-REFUND',
                             JSON.stringify({ provider: active.name, payout_id: payout.id, utr: status.utr })]
                        );
                    }
                    await refundClient.query(
                        "UPDATE transactions SET status = 'failed' WHERE external_reference = $1",
                        [payout.transfer_id]
                    );
                }
                await refundClient.query('COMMIT');
            } catch (refundErr) {
                try { await refundClient.query('ROLLBACK'); } catch (_) {}
                throw refundErr;
            } finally {
                refundClient.release();
            }

            try {
                await createNotification(payout.user_id, {
                    type: 'warning',
                    title: 'Payout failed at the bank — funds returned',
                    message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was returned to your balance.`,
                });
            } catch (notifErr) {
                console.warn('Payout refund notification failure (refund completed):', notifErr.message);
            }
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
