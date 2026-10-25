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

// Refunded/unreserved are terminal. 'succeeded' is NOT fully terminal:
// Cashfree documents SUCCESS -> REVERSED when the beneficiary bank reverses
// a payout, and that reversal must return the user's money.
const TERMINAL_STATUSES = ['failed_refunded', 'failed_unreserved'];
const FAILURE_PROVIDER_STATUSES = ['ERROR', 'FAILED', 'REJECTED', 'REVERSED'];
const TERMINAL_PROVIDER_STATUSES = ['SUCCESS', ...FAILURE_PROVIDER_STATUSES];

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
    // Never fail open: without this index two concurrent requests with the
    // same Idempotency-Key could both debit and both call the provider.
    const { rows } = await db.query(`
        SELECT COALESCE((SELECT indisunique FROM pg_index
                          WHERE indexrelid = to_regclass('public.payout_idempotency_user_key')), false) AS ready
    `);
    if (!rows[0] || !rows[0].ready) {
        const err = new Error('Payout schema is not ready: the (user_id, idempotency_key) unique index is missing or not unique. Resolve duplicate keys before enabling payouts.');
        err.code = 'PAYOUTS_SCHEMA_NOT_READY';
        throw err;
    }
    tablesReady = true;
}

// Store provider/HTTP codes, never raw provider text or DB error text, in
// customer-visible failure fields.
function safeFailureReason(err) {
    return [err && err.code ? String(err.code) : 'provider_error', err && err.status ? 'HTTP ' + err.status : null]
        .filter(Boolean)
        .join(' ');
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

/**
 * Atomically refund one payout. The status transition is the claim: only the
 * caller that moves the row to failed_refunded may credit the account, and
 * the refund ledger row is a second idempotency guard.
 *
 * allowFromSucceeded is used only for a bank reversal of a successful payout;
 * the normal failure path must never refund a row that already succeeded.
 */
async function refundPayout({ payout, active, reason, withdrawalStatus, allowFromSucceeded = false }) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const guard = allowFromSucceeded
            ? "status = 'succeeded'"
            : "status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')";
        const { rows: claimed } = await client.query(
            `UPDATE payout_requests SET status = 'failed_refunded', failure_reason = $2, updated_at = NOW()
             WHERE id = $1 AND ${guard} RETURNING id`,
            [payout.id, reason]
        );
        if (claimed.length === 0) {
            await client.query('COMMIT');
            return { refunded: false };
        }

        const { rows: refundSeen } = await client.query(
            'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
            [payout.transfer_id + '-REFUND']
        );
        if (refundSeen.length === 0) {
            const refundAmount = parseFloat(payout.amount);
            const { rows: refunded } = await client.query(
                `UPDATE accounts
                    SET balance = balance + $2, available_balance = available_balance + $2
                  WHERE id = $1
                  RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
                [payout.account_id, refundAmount]
            );
            // A missing account must never look like a completed refund: roll
            // the claim back and leave the payout for an operator to resolve.
            if (refunded.length === 0) {
                const err = new Error('Refund account is missing — payout left held for operator review.');
                err.code = 'PAYOUT_REFUND_ACCOUNT_MISSING';
                throw err;
            }
            await client.query(
                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                    balance_before, balance_after, description, category, external_reference, metadata)
                 VALUES ($1, $2, 'refund', 'completed', $3, $4, $5, $6, $7, 'income', $8, $9)`,
                [payout.account_id, payout.user_id, refundAmount, CURRENCY,
                 parseFloat(refunded[0].balance_before), parseFloat(refunded[0].balance_after),
                 `Payout ${payout.transfer_id} returned — ${reason}`,
                 payout.transfer_id + '-REFUND',
                 JSON.stringify({ provider: active.name, payout_id: payout.id, reason })]
            );
        }

        await client.query(
            "UPDATE transactions SET status = $2 WHERE external_reference = $1 AND type = 'withdrawal'",
            [payout.transfer_id, withdrawalStatus]
        );
        await client.query('COMMIT');
        return { refunded: true };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw err;
    } finally {
        client.release();
    }
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
        if (error.code === 'PAYOUTS_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
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
        const body = req.body || {};
        // Strict decimal parse: reject scientific notation, >2 decimals and
        // values that would be silently rounded by NUMERIC(15,2).
        const rawAmount = body.amount;
        const amountStr = typeof rawAmount === 'number' ? String(rawAmount) : String(rawAmount == null ? '' : rawAmount).trim();
        if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
            return res.status(400).json({ success: false, code: 'PAYOUT_AMOUNT_INVALID', message: `Amount must be a positive ${CURRENCY} value with at most two decimals.` });
        }
        amount = Number(amountStr);
        const bankAccount = String(body.bankAccount || '').trim();
        const ifsc = String(body.ifsc || '').trim().toUpperCase();

        // Idempotency is mandatory for a money-moving POST. Never truncate a
        // long key (that would let two different keys collide).
        const rawKey = req.headers['idempotency-key'];
        const idempotencyKey = rawKey == null ? '' : String(rawKey).trim();
        if (!idempotencyKey) {
            return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'An Idempotency-Key header is required for payout requests.' });
        }
        if (idempotencyKey.length < 8 || idempotencyKey.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
            return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be 8-100 characters using letters, digits, dot, underscore, colon or hyphen.' });
        }

        if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            return res.status(400).json({ success: false, message: `Amount must be between ${CURRENCY} ${MIN_AMOUNT} and ${CURRENCY} ${MAX_AMOUNT}.` });
        }
        if (!BANK_ACCOUNT_RE.test(bankAccount) || !IFSC_RE.test(ifsc)) {
            return res.status(400).json({ success: false, message: 'A valid bank account number and IFSC are required.' });
        }

        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        // Collect real beneficiary identity/address BEFORE reserving or debiting funds.
        // No placeholder personal data is sent to the payout provider.
        const beneficiaryName = String(user.full_name || '').trim();
        const beneficiaryEmail = String(user.email || '').trim();
        const beneficiaryPhoneDigits = String(user.phone || '').replace(/\\D/g, '');
        const address1 = String(body.address1 || '').trim();
        const city = String(body.city || '').trim();
        const state = String(body.state || '').trim();
        const pincode = String(body.pincode || '').trim();
        if (beneficiaryName.length < 2 ||
            !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(beneficiaryEmail) ||
            beneficiaryPhoneDigits.length < 10 || beneficiaryPhoneDigits.length > 15) {
            return res.status(400).json({
                success: false,
                code: 'PAYOUTS_CUSTOMER_DETAILS_REQUIRED',
                message: 'Complete your real full name, valid email and phone number before requesting an INR payout.',
            });
        }
        if (address1.length < 3 || !city || !state || !/^\\d{6}$/.test(pincode)) {
            return res.status(400).json({
                success: false,
                code: 'PAYOUTS_BENEFICIARY_ADDRESS_REQUIRED',
                message: 'A real street address, city, state and six-digit PIN code are required for an INR payout.',
            });
        }

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
        // Per-destination beneficiary ID: a user who changes bank account gets
        // a new provider beneficiary instead of a permanent mismatch on the
        // old per-user ID. The hash is stable for the same user + account+IFSC.
        const destinationHash = crypto.createHash('sha256')
            .update(String(req.user.id) + '|' + bankAccount + '|' + ifsc)
            .digest('hex').slice(0, 32).toUpperCase();
        const beneId = 'VBU-' + destinationHash;

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
            if (txErr.code === '23505' && (txErr.constraint === 'payout_idempotency_user_key' || String(txErr.message || '').includes('payout_idempotency'))) {
                const { rows: existing } = await db.query(
                    'SELECT * FROM payout_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                    [req.user.id, idempotencyKey]
                );
                if (existing.length > 0) {
                    res.setHeader('Idempotent-Replay', 'true');
                    return res.status(200).json({ success: true, replay: true, payout: existing[0], status: existing[0].status });
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
            try {
                await active.adapter.ensureBeneficiary({
                    beneId,
                    name: beneficiaryName,
                    email: beneficiaryEmail,
                    phone: beneficiaryPhoneDigits.length === 12 && beneficiaryPhoneDigits.startsWith('91')
                        ? beneficiaryPhoneDigits.slice(2)
                        : beneficiaryPhoneDigits,
                    bankAccount,
                    ifsc,
                    address1,
                    city,
                    state,
                    pincode,
                });
            } catch (beneficiaryErr) {
                // No transfer request has been sent yet — refunding is safe
                // even if the beneficiary may have been created.
                beneficiaryErr.safe = true;
                throw beneficiaryErr;
            }
            const accepted = await active.adapter.requestTransfer({ transferId, beneId, amount });
            const { rows: submittedRows } = await db.query(
                `UPDATE payout_requests SET status = 'submitted', provider_reference_id = $2, utr = $3, submitted_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status = 'reserved' RETURNING id`,
                [payoutId, accepted.referenceId, accepted.utr]
            );
            if (submittedRows.length === 0) {
                // The row changed while the provider call was in flight. Do not
                // claim success; treat as ambiguous and flag for reconciliation.
                const raceErr = new Error('Payout row changed before submission could be recorded.');
                raceErr.code = 'PAYOUT_STATE_RACE';
                throw raceErr;
            }
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
                const outcome = await refundPayout({
                    payout: payoutRow,
                    active,
                    reason: e.message,
                    withdrawalStatus: 'failed',
                });
                if (!outcome.refunded) {
                    return res.status(200).json({ success: true, message: 'Payout already resolved.', payoutId, transferId });
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
            const reason = safeFailureReason(e);
            await db.query(
                "UPDATE payout_requests SET status = 'reconciliation_required', failure_reason = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')",
                [payoutId, reason]
            );
            await audit(req.user.id, 'payout_reconciliation_required', transferId, { reason }, req);
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
        if (error.code === 'PAYOUTS_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
        if (error.code === 'PAYOUT_REFUND_ACCOUNT_MISSING') {
            return res.status(500).json({ success: false, code: error.code, message: 'Your funds could not be returned automatically — support has been flagged.' });
        }
        // If we have a payoutId but the error isn't a handled case, flag for
        // reconciliation — the reservation is committed and must be resolved.
        if (payoutId) {
            try {
                await db.query(
                    "UPDATE payout_requests SET status = 'reconciliation_required', failure_reason = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')",
                    [payoutId, safeFailureReason(error)]
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
        // Owners reconcile their own payout; admins may reconcile any payout
        // from the admin queue (the status call/refund logic is identical).
        const isAdmin = String((req.user && req.user.role) || '').toLowerCase() === 'admin';
        if (!payout || (!isAdmin && payout.user_id !== req.user.id)) {
            return res.status(404).json({ success: false, message: 'Payout request not found.' });
        }
        if (TERMINAL_STATUSES.includes(payout.status)) {
            return res.status(200).json({ success: true, payout, message: 'Terminal status already reached.' });
        }
        // Call the provider status API (OUTSIDE any DB transaction).
        let status;
        if (payout.status === 'reserved' || payout.status === 'reserving') {
            // The submit route owns the row until it records submitted / safe
            // refund / reconciliation_required. A concurrent reconcile could
            // refund a payout the provider is about to accept, so only an admin
            // may break a clearly stale reservation (process died after commit).
            const ageMs = Date.now() - new Date(payout.created_at || 0).getTime();
            const stale = Number.isFinite(ageMs) && ageMs > 60 * 60 * 1000;
            if (!isAdmin || !stale) {
                return res.status(202).json({
                    success: false,
                    code: 'PAYOUT_SUBMISSION_IN_PROGRESS',
                    message: 'The payout submission is still being recorded. Retry reconciliation shortly; a stuck reserved payout requires operator review.',
                    payout,
                });
            }
            status = await active.adapter.getTransferStatus({ transferId: payout.transfer_id });
            if (!status) {
                // Provider has no record after an hour: the process died before
                // submission. Release the hold exactly once via the refund guard.
                const outcome = await refundPayout({
                    payout,
                    active,
                    reason: 'stale reservation: provider has no transfer record',
                    withdrawalStatus: 'cancelled',
                });
                if (outcome.refunded) {
                    try {
                        await createNotification(payout.user_id, {
                            type: 'warning',
                            title: 'Payout released',
                            message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was returned because the payout was never submitted.`,
                        });
                    } catch (notifErr) {
                        console.warn('Payout stale-release notification failure (refund completed):', notifErr.message);
                    }
                    await audit(payout.user_id, 'payout_stale_unreserved', payout.transfer_id, { amount: parseFloat(payout.amount), provider_status: 'NOT_FOUND' }, req);
                }
                const { rows: released } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [payout.id]);
                return res.status(200).json({ success: true, payout: released[0], message: 'Stale reservation released and funds returned.' });
            }
        }
        if (status === undefined) {
            status = await active.adapter.getTransferStatus({ transferId: payout.transfer_id });
        }
        if (!status) {
            return res.status(200).json({ success: true, payout, message: 'Provider has no record yet — retry reconciliation later.' });
        }
        if (payout.status === 'reserved' || payout.status === 'reserving') {
            // The provider does have a record, so the submit response was lost.
            // Record that fact before applying the terminal transition below.
            await db.query(
                "UPDATE payout_requests SET status = 'submitted', provider_reference_id = COALESCE(provider_reference_id, $2), utr = COALESCE(utr, $3), updated_at = NOW() WHERE id = $1 AND status IN ('reserved','reserving')",
                [payout.id, status.referenceId || null, status.utr || null]
            );
        }

        // A terminal provider status must agree with the amount we reserved
        // before any money moves. Missing or mismatched values are manual review.
        if (TERMINAL_PROVIDER_STATUSES.includes(status.status)) {
            const expectedAmount = parseFloat(payout.amount);
            const amountMatches = Number.isFinite(status.amount) && Math.abs(status.amount - expectedAmount) <= 0.005;
            if (!amountMatches) {
                return res.status(409).json({
                    success: false,
                    code: 'PAYOUT_STATUS_AMOUNT_MISMATCH',
                    message: 'The provider reported a different payout amount — manual review required.',
                    payout,
                });
            }
            if (status.currency && status.currency !== CURRENCY) {
                return res.status(409).json({
                    success: false,
                    code: 'PAYOUT_STATUS_CURRENCY_MISMATCH',
                    message: 'The provider reported a different settlement currency — manual review required.',
                    payout,
                });
            }
        }

        if (payout.status === 'succeeded') {
            // 'succeeded' is not fully terminal: Cashfree documents
            // SUCCESS -> REVERSED when the beneficiary bank returns the money.
            if (status.status === 'SUCCESS' || status.status === 'PENDING') {
                // Repair a ledger completion lost after the status commit; a
                // later reconcile is allowed specifically to catch reversals.
                await db.query(
                    "UPDATE transactions SET status = 'completed' WHERE external_reference = $1 AND type = 'withdrawal' AND status <> 'completed'",
                    [payout.transfer_id]
                );
            } else if (status.status === 'REVERSED') {
                const outcome = await refundPayout({
                    payout,
                    active,
                    reason: 'provider reversed after success',
                    withdrawalStatus: 'reversed',
                    allowFromSucceeded: true,
                });
                if (outcome.refunded) {
                    try {
                        await createNotification(payout.user_id, {
                            type: 'warning',
                            title: 'Payout reversed by the bank — funds returned',
                            message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was returned to your balance after the bank reversed the payout.`,
                        });
                    } catch (notifErr) {
                        console.warn('Payout reversal notification failure (refund completed):', notifErr.message);
                    }
                    await audit(payout.user_id, 'payout_reversed_refunded', payout.transfer_id, { amount: parseFloat(payout.amount), utr: status.utr }, req);
                }
            } else if (FAILURE_PROVIDER_STATUSES.includes(status.status)) {
                // A failure after success is contradictory. Never auto-refund
                // on a status we do not trust; a human resolves it.
                return res.status(409).json({
                    success: false,
                    code: 'PAYOUT_STATUS_INCONSISTENT',
                    message: 'The provider reports a failure after a completed payout — manual review required.',
                    payout,
                });
            }
        } else if (status.status === 'SUCCESS') {
            // ── Idempotent success transition ──
            const { rows: transitioned } = await db.query(
                `UPDATE payout_requests SET status = 'succeeded', utr = $2, completed_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status NOT IN ('succeeded', 'failed_refunded', 'failed_unreserved')
                 RETURNING *`,
                [payout.id, status.utr || payout.utr]
            );
            if (transitioned.length > 0) {
                await db.query(
                    "UPDATE transactions SET status = 'completed' WHERE external_reference = $1 AND type = 'withdrawal'",
                    [payout.transfer_id]
                );
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
        } else if (FAILURE_PROVIDER_STATUSES.includes(status.status)) {
            // ── Failure before success: refund exactly once ──
            const outcome = await refundPayout({
                payout,
                active,
                reason: 'provider reported ' + status.status,
                withdrawalStatus: 'failed',
            });
            if (outcome.refunded) {
                try {
                    await createNotification(payout.user_id, {
                        type: 'warning',
                        title: 'Payout failed at the bank — funds returned',
                        message: `${CURRENCY} ${parseFloat(payout.amount).toFixed(2)} was returned to your balance.`,
                    });
                } catch (notifErr) {
                    console.warn('Payout refund notification failure (refund completed):', notifErr.message);
                }
                await audit(payout.user_id, 'payout_failed_refunded', payout.transfer_id, { amount: parseFloat(payout.amount), provider_status: status.status, utr: status.utr }, req);
            } else {
                const { rows: fresh } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [payout.id]);
                return res.status(200).json({ success: true, payout: fresh[0], message: 'Already resolved by a concurrent reconciliation.' });
            }
        }

        const { rows: fresh } = await db.query('SELECT * FROM payout_requests WHERE id = $1 LIMIT 1', [payout.id]);
        res.status(200).json({ success: true, payout: fresh[0] });
    } catch (error) {
        console.error('Payout reconcile error:', error.message);
        if (error.code === 'PAYOUTS_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
        if (error.code === 'PAYOUT_REFUND_ACCOUNT_MISSING') {
            return res.status(500).json({ success: false, code: error.code, message: 'Your funds could not be returned automatically — support has been flagged.' });
        }
        res.status(500).json({ success: false, message: 'Reconciliation failed — retry later.' });
    }
});

// ============================================================
// GET /api/payouts/admin/requests — operator queue (admin)
// ============================================================
router.get('/api/payouts/admin/requests', authenticateToken, requireAdmin, async (req, res) => {
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
