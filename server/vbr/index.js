/**
 * VBR — the VaultBank Rail core.
 *
 * A provider-neutral payment intent module that:
 *   1. Creates, reads, and cancels payment intents.
 *   2. Routes intents to the correct connector (internal transfer, collections,
 *      payouts) based on the intent's method.
 *   3. Validates ALL state transitions through the centralized state machine.
 *   4. Enforces idempotency via a DB unique index on (user_id, idempotency_key).
 *   5. Stores amounts as exact NUMERIC strings — never parseFloat.
 *   6. Fails closed: unconfigured connectors never simulate payments.
 *
 * The VBR module does NOT replace the existing transfer route — it wraps it.
 * Internal transfers go through the same atomic BEGIN..COMMIT pipeline, with
 * the VBR intent as an additional tracking record linked via transfer_id.
 */

const express = require('express');
const router = express.Router();
const { STATES, canTransition, isTerminal, assertTransition, isCurrencySupported, SUPPORTED_CURRENCIES } = require('./states');
const { validateConnector } = require('./connector');
const { db, findUserById, findUserByEmail, findAccountByUserIdAndCurrency, findAccountByNumber, createNotification } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Amount validation: string-based, NO floating-point ──
// Accepts "100", "100.00", "0.01". Rejects "abc", "-5", "1e5", "NaN", "Infinity".
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

function validateAmount(amountStr) {
    const s = String(amountStr || '').trim();
    if (!AMOUNT_RE.test(s)) return null;
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
    // Return the STRING for PostgreSQL NUMERIC — never a float.
    return s;
}

// ── Table ensure (idempotent, matches migration 011) ──
let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS payment_intents (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id UUID NOT NULL,
            idempotency_key TEXT,
            direction TEXT NOT NULL CHECK (direction IN ('send', 'receive')),
            method TEXT NOT NULL CHECK (method IN ('internal', 'collections', 'payouts')),
            amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
            currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
            state TEXT NOT NULL DEFAULT 'created'
                CHECK (state IN ('created', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')),
            counterparty TEXT,
            metadata JSONB DEFAULT '{}',
            transfer_id UUID REFERENCES transfers(id),
            failure_reason TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    try {
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS payment_intent_idempotency_key
            ON payment_intents (user_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
        `);
    } catch (idxErr) {
        console.error('payment_intent_idempotency_key index not ready:', idxErr.message);
    }
    try {
        await db.query(`
            CREATE INDEX IF NOT EXISTS ix_payment_intents_state
            ON payment_intents (state, updated_at DESC)
            WHERE state NOT IN ('succeeded', 'failed', 'cancelled')
        `);
    } catch (_) { /* index may already exist */ }
    // Never fail open: without the unique index, concurrent intents with the
    // same key would both insert and could replay the wrong payment.
    const { rows } = await db.query(`
        SELECT COALESCE((SELECT indisunique FROM pg_index
                          WHERE indexrelid = to_regclass('public.payment_intent_idempotency_key')), false) AS ready
    `);
    if (!rows[0] || !rows[0].ready) {
        const err = new Error('VBR schema is not ready: payment_intent_idempotency_key is missing or not unique. Resolve duplicate idempotency keys before creating intents.');
        err.code = 'VBR_SCHEMA_NOT_READY';
        throw err;
    }
    tablesReady = true;
}

/**
 * Move an ambiguous intent to reconciliation_required WITHOUT ever touching a
 * concurrently committed 'succeeded'. The WHERE guard is re-evaluated under
 * the row lock: if the original transfer transaction is still resolving, this
 * waits (bounded) and then sees its final state. Returns null on no match or
 * timeout — the caller must re-read and decide.
 */
async function markReconciliationRequired(intentId, reason) {
    let client = null;
    try {
        client = await db.getClient();
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '2s'");
        const { rows } = await client.query(
            `UPDATE payment_intents
                SET state = 'reconciliation_required', failure_reason = $2, updated_at = NOW()
              WHERE id = $1 AND state = 'created'
              RETURNING *`,
            [intentId, reason]
        );
        await client.query('COMMIT');
        return rows[0] || null;
    } catch (_) {
        if (client) { try { await client.query('ROLLBACK'); } catch (_) { /* release below */ } }
        return null;
    } finally {
        if (client) client.release(false);
    }
}

// ── Availability: which VBR methods are genuinely ready? ──
const { activeCollectionsProvider, collectionsAvailability } = require('../collections');
const { activePayoutProvider, payoutAvailability } = require('../payouts');

function vbrAvailability() {
    const collections = collectionsAvailability();
    const payouts = payoutAvailability();
    return {
        internal: { available: true, reason: 'always available (VaultBank-to-VaultBank)', execution: 'executes-transfer' },
        collections: {
            available: collections.available,
            reason: collections.reason || (collections.available ? 'provider configured' : 'no collection provider configured'),
            provider: collections.provider || null,
            configured: collections.configured,
            mode: collections.mode,
            credentialValid: collections.credentialValid,
            webhookReady: collections.webhookReady,
            providerLive: collections.providerLive,
            liveSettlementVerified: collections.liveSettlementVerified,
            execution: 'tracking-only', // use GET /api/collections/my-details for the provider VBA
        },
        payouts: {
            available: payouts.available,
            reason: payouts.reason || (payouts.available ? 'provider configured' : 'no payout provider configured'),
            provider: payouts.provider || null,
            configured: payouts.configured,
            mode: payouts.mode,
            credentialValid: payouts.credentialValid,
            webhookReady: payouts.webhookReady,
            providerLive: payouts.providerLive,
            liveSettlementVerified: payouts.liveSettlementVerified,
            reconciliation: payouts.reconciliation,
            execution: 'tracking-only', // use POST /api/payouts/requests to move money
        },
        usd_external: { available: false, reason: 'no authorized USD settlement rail exists today — explicitly unavailable' },
    };
}

// ============================================================
// GET /api/vbr/availability — PUBLIC VBR readiness
// ============================================================
router.get('/api/vbr/availability', (req, res) => {
    res.status(200).json({ success: true, ...vbrAvailability(), currencies: SUPPORTED_CURRENCIES });
});

// ============================================================
// GET /api/vbr/intents — my payment intents (owner-scoped)
// ============================================================
router.get('/api/vbr/intents', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query(
            `SELECT id, direction, method, amount, currency, state, counterparty, transfer_id,
                    failure_reason, created_at, updated_at
             FROM payment_intents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
            [req.user.id]
        );
        res.status(200).json({ success: true, intents: rows });
    } catch (error) {
        console.error('VBR list error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load your payment intents.' });
    }
});

// ============================================================
// GET /api/vbr/intents/:id — read intent (owner-scoped)
// ============================================================
router.get('/api/vbr/intents/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [req.params.id]);
        const intent = rows[0];
        if (!intent || intent.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Payment intent not found.' });
        }
        res.status(200).json({ success: true, intent });
    } catch (error) {
        console.error('VBR read error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the payment intent.' });
    }
});

// ============================================================
// POST /api/vbr/intents — create + execute a payment intent
//
// For method='internal': the VBR module wraps the EXISTING atomic transfer
// pipeline, creating an intent record before and updating it after. The
// transfer itself runs through the same code path as /api/account/transfer.
//
// For external methods (collections, payouts): the VBR module checks the
// connector's availability and fails closed if unconfigured.
// ============================================================
router.post('/api/vbr/intents', authenticateToken, async (req, res) => {
    const { direction, method, amount, currency, counterparty, description, metadata } = req.body;
    const rawIdempotencyKey = req.headers['idempotency-key'];
    const idempotencyKey = rawIdempotencyKey == null ? null : (String(rawIdempotencyKey).trim() || null);
    if (idempotencyKey && idempotencyKey.length > 100) {
        return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 100 characters.' });
    }

    // Material-params match for idempotency: same key + same params = replay,
    // same key + different params = clear conflict (never a silent wrong
    // result). Defined before the try so the 23505 race handler can use it.
    const paramsMatch = (row) => !!row
        && row.direction === direction
        && row.method === method
        && String(row.currency || '').trim().toUpperCase() === String(currency || '').trim().toUpperCase()
        && Number(row.amount) === Number(String(amount || '').trim())
        && String(row.counterparty || '').trim() === String(counterparty || '').trim();

    try {
        // ── Validation: currency, amount, method ──
        const wantedCurrency = String(currency || '').trim().toUpperCase();
        if (!isCurrencySupported(wantedCurrency)) {
            return res.status(400).json({ success: false, message: `Currency ${wantedCurrency} is not supported. Use ${SUPPORTED_CURRENCIES.join(' or ')}.` });
        }
        const amountStr = validateAmount(amount);
        if (!amountStr) {
            return res.status(400).json({ success: false, message: 'Amount must be a positive number with at most 2 decimal places, no scientific notation.' });
        }
        const validDirections = ['send', 'receive'];
        const validMethods = ['internal', 'collections', 'payouts'];
        if (!validDirections.includes(direction)) {
            return res.status(400).json({ success: false, message: 'Direction must be "send" or "receive".' });
        }
        if (!validMethods.includes(method)) {
            return res.status(400).json({ success: false, message: 'Method must be "internal", "collections", or "payouts".' });
        }

        // USD external is explicitly unavailable — no authorized rail exists.
        // Check BEFORE the general payouts availability (the USD-specific
        // message is more precise than the generic connector message).
        if (wantedCurrency === 'USD' && method !== 'internal' && direction === 'send') {
            return res.status(503).json({ success: false, code: 'VBR_NO_USD_RAIL', message: 'USD external bank transfers are explicitly unavailable — no authorized USD settlement rail exists today.' });
        }
        // ── Availability check: fail closed for unconfigured connectors ──
        const avail = vbrAvailability();
        if (method === 'collections' && !avail.collections.available) {
            return res.status(503).json({ success: false, code: 'VBR_CONNECTOR_NOT_CONFIGURED', message: avail.collections.reason });
        }
        if (method === 'payouts' && !avail.payouts.available) {
            return res.status(503).json({ success: false, code: 'VBR_CONNECTOR_NOT_CONFIGURED', message: avail.payouts.reason });
        }

        // ── Resolve the user's account in the requested currency ──
        const account = await findAccountByUserIdAndCurrency(req.user.id, wantedCurrency);
        if (!account) {
            return res.status(404).json({ success: false, message: `You don't have a ${wantedCurrency} account yet.` });
        }

        await ensureTables();

        // ── Idempotent replay: same key + same params returns the original;
        // same key + different params is a clear conflict ──
        if (idempotencyKey) {
            const { rows: existing } = await db.query(
                'SELECT * FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                [req.user.id, idempotencyKey]
            );
            if (existing.length > 0) {
                if (!paramsMatch(existing[0])) {
                    return res.status(409).json({
                        success: false, code: 'IDEMPOTENCY_CONFLICT',
                        message: 'This idempotency key was already used with different parameters.',
                    });
                }
                res.setHeader('Idempotent-Replay', 'true');
                return res.status(200).json({ success: true, replay: true, intent: existing[0] });
            }
        }

        // ── Create the intent (state: created) ──
        const { rows: intentRows } = await db.query(
            `INSERT INTO payment_intents (user_id, account_id, idempotency_key, direction, method, amount, currency, state, counterparty, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9)
             RETURNING *`,
            [req.user.id, account.id, idempotencyKey, direction, method, amountStr, wantedCurrency,
             counterparty || null,
             JSON.stringify({ description: description || null, ...metadata || {} })]
        );
        const intent = intentRows[0];

        // ── Route to the connector ──
        if (method === 'internal' && direction === 'send') {
            // ── EXECUTE the transfer through the shared atomic service ──
            // The VBR intent is NOT just a tracking record — it triggers the
            // same atomic transfer pipeline as /api/account/transfer, and its
            // final state is written INSIDE that transaction (onBeforeCommit),
            // so money and intent status can never disagree.

            // Resolve the recipient: email or account number (same semantics
            // as the existing /api/account/transfer route).
            let recipientAccount = null;
            if (counterparty && counterparty.includes('@')) {
                const recipientUser = await findUserByEmail(counterparty);
                if (recipientUser) {
                    recipientAccount = await findAccountByUserIdAndCurrency(recipientUser.id, wantedCurrency);
                }
            } else if (counterparty) {
                recipientAccount = await findAccountByNumber(counterparty);
                if (recipientAccount && String(recipientAccount.currency).toUpperCase() !== wantedCurrency) {
                    const { rows: failed } = await db.query(
                        `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                        [intent.id, `Recipient account is ${recipientAccount.currency}, not ${wantedCurrency}`]
                    );
                    return res.status(400).json({ success: false, intent: failed[0], message: `That recipient account is ${recipientAccount.currency} — ${wantedCurrency} transfers need a ${wantedCurrency} recipient.` });
                }
            }
            if (!recipientAccount) {
                const { rows: failed } = await db.query(
                    `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [intent.id, `Recipient has no ${wantedCurrency} account`]
                );
                return res.status(404).json({ success: false, intent: failed[0], message: `Recipient has no ${wantedCurrency} account yet.` });
            }
            if (recipientAccount.id === account.id) {
                const { rows: failed } = await db.query(
                    `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [intent.id, 'Self-transfer rejected']
                );
                return res.status(400).json({ success: false, intent: failed[0], message: 'Cannot transfer to your own account.' });
            }
            if (String(account.currency).toUpperCase() !== String(recipientAccount.currency).toUpperCase()) {
                const { rows: failed } = await db.query(
                    `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [intent.id, 'Cross-currency rejected']
                );
                return res.status(400).json({ success: false, intent: failed[0], code: 'CROSS_CURRENCY_UNSUPPORTED', message: 'Internal transfers require matching currencies.' });
            }

            const { executeAtomicTransfer, notifyTransferCompletion } = require('../services/transferService');
            let result;
            try {
                result = await executeAtomicTransfer({
                    userId: req.user.id,
                    senderAccount: account,
                    recipientAccount,
                    amount: amountStr,
                    currency: wantedCurrency,
                    description: description || `VBR intent ${intent.id}`,
                    idempotencyKey,
                    senderName: req.user.full_name,
                    onBeforeCommit: async (client, { transferId }) => {
                        // Intent linkage INSIDE the transaction: if this fails,
                        // ROLLBACK undoes the transfer too — they commit together.
                        // Unconditional on purpose: if the money moved, the
                        // intent MUST record success even if a concurrent
                        // cancel raced in — never report moved money as
                        // cancelled or created.
                        await client.query(
                            `UPDATE payment_intents SET state = 'succeeded', transfer_id = $1, updated_at = NOW() WHERE id = $2`,
                            [transferId, intent.id]
                        );
                    },
                });
            } catch (execErr) {
                // Only pre-COMMIT failures throw here — lost COMMIT
                // acknowledgements are resolved by the service (verified
                // success / COMMIT_FAILED / ambiguous), so nothing moved.
                const { rows: failed } = await db.query(
                    `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [intent.id, `Execution error: ${execErr.message}`]
                );
                return res.status(500).json({ success: false, intent: failed[0], message: 'Transfer execution failed.' });
            }

            if (result.replay) {
                // Same key + same STORED parameters: the service already
                // compared the authoritative transfer record. Link this intent
                // to the original transfer and replay it — no second debit.
                const { rows: fresh } = await db.query(
                    `UPDATE payment_intents SET state = 'succeeded', transfer_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                    [intent.id, result.transferId]
                );
                res.setHeader('Idempotent-Replay', 'true');
                return res.status(200).json({ success: true, replay: true, intent: fresh[0], transferId: result.transferId });
            }
            if (result.ambiguous) {
                // The COMMIT acknowledgement was lost AND the service could not
                // prove either outcome. A persisted 'created' intent is NOT
                // proof of non-commit: the original transaction may still be
                // resolving. Only 'succeeded' proves the money moved; only
                // 'failed'/'cancelled' prove it did not.
                let fresh = null;
                try {
                    const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [intent.id]);
                    fresh = rows[0] || null;
                } catch (_) { fresh = null; }

                const committedResponse = (row) => res.status(200).json({
                    success: true,
                    intent: row,
                    transferId: row.transfer_id,
                    message: 'Transfer committed (the commit acknowledgement was lost; outcome verified from the persisted intent).',
                });
                const failedResponse = (row) => res.status(500).json({
                    success: false, intent: row, code: 'COMMIT_FAILED',
                    message: 'Transfer execution failed — no money moved.',
                });

                if (fresh && fresh.state === 'succeeded') return committedResponse(fresh);
                if (fresh && (fresh.state === 'failed' || fresh.state === 'cancelled')) return failedResponse(fresh);

                // Still 'created' (or unreadable). Race-safe: this UPDATE only
                // matches 'created' and waits on the original transaction's row
                // lock, so a concurrently committed 'succeeded' is never
                // overwritten.
                const marked = await markReconciliationRequired(
                    intent.id,
                    'Commit acknowledgement lost — transfer outcome unknown, operator review required'
                );
                if (marked) {
                    return res.status(503).json({
                        success: false,
                        code: 'TRANSFER_OUTCOME_UNKNOWN',
                        intent: marked,
                        message: 'The transfer outcome could not be confirmed — money may have moved. Do not retry with a new idempotency key.',
                    });
                }

                // The guarded update matched nothing (a late commit landed
                // while we waited) or timed out. Re-read once.
                let after = null;
                try {
                    const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [intent.id]);
                    after = rows[0] || null;
                } catch (_) { after = null; }
                if (after && after.state === 'succeeded') return committedResponse(after);
                if (after && (after.state === 'failed' || after.state === 'cancelled')) return failedResponse(after);

                return res.status(503).json({
                    success: false,
                    code: 'TRANSFER_OUTCOME_UNKNOWN',
                    intent: after || fresh || intent,
                    message: 'The transfer outcome could not be confirmed — money may have moved. Do not retry with a new idempotency key.',
                });
            }
            if (result.error) {
                // Expected failure — ROLLBACK already ran; nothing moved.
                // Guard 'succeeded': a definitive failure must never overwrite
                // a state that proves the money moved.
                const { rows: failedRows } = await db.query(
                    `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW()
                     WHERE id = $1 AND state <> 'succeeded' RETURNING *`,
                    [intent.id, result.message || result.code]
                );
                let failed = failedRows[0] || null;
                if (!failed) {
                    let current = null;
                    try {
                        const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [intent.id]);
                        current = rows[0] || null;
                    } catch (_) { current = null; }
                    if (current && current.state === 'succeeded') {
                        return res.status(200).json({
                            success: true,
                            intent: current,
                            transferId: current.transfer_id,
                            message: 'Transfer already committed.',
                        });
                    }
                    failed = current || intent;
                }
                const statusCode = result.code === 'TRANSFER_IN_PROGRESS' || result.code === 'IDEMPOTENCY_CONFLICT' ? 409
                    : result.code === 'COMMIT_FAILED' ? 500
                    : result.code === 'RECIPIENT_NOT_FOUND' || result.code === 'SENDER_ACCOUNT_NOT_FOUND' ? 404
                    : 400;
                return res.status(statusCode).json({ success: false, code: result.code, intent: failed, message: result.message });
            }

            // Success: the hook already set state='succeeded' + transfer_id
            // atomically with the transfer. Return the PERSISTED row. If that
            // read fails, NEVER report moved money as failed — fall back to
            // the state the service just proved.
            let freshIntent = null;
            try {
                const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [intent.id]);
                freshIntent = rows[0] || null;
            } catch (_) { freshIntent = null; }
            const persistedIntent = freshIntent || { ...intent, state: 'succeeded', transfer_id: result.transferId };

            // Notifications AFTER the commit — failure-tolerant, they never
            // change the reported result.
            await notifyTransferCompletion({
                userId: req.user.id,
                recipientAccount,
                senderAccount: account,
                amount: amountStr,
                currency: wantedCurrency,
                newSenderBalance: result.newSenderBalance,
                recipientBalance: result.recipientBalance,
            });

            return res.status(200).json({
                success: true,
                intent: persistedIntent,
                transferId: result.transferId,
                message: `Successfully transferred ${wantedCurrency} ${amountStr}`,
            });
        }

        if (method === 'internal' && direction === 'receive') {
            // Internal receive is not a valid combination — internal transfers
            // are always initiated by the sender.
            const { rows: failed } = await db.query(
                `UPDATE payment_intents SET state = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                [intent.id, 'receive+internal not supported']
            );
            return res.status(400).json({ success: false, intent: failed[0], message: 'Internal "receive" intents are not supported — internal transfers are always initiated by the sender.' });
        }

        if (method === 'collections' && direction === 'receive') {
            // Collections: the intent tracks a pending inbound payment.
            // PERSIST the pending state — never a response-only override.
            const { rows: pending } = await db.query(
                `UPDATE payment_intents SET state = 'pending', updated_at = NOW() WHERE id = $1 RETURNING *`,
                [intent.id]
            );
            return res.status(200).json({
                success: true,
                intent: pending[0],
                message: 'Receiving intent created — get your provider-issued details from /api/collections/my-details.',
            });
        }

        if (method === 'payouts' && direction === 'send') {
            // Payouts: the intent tracks an outbound withdrawal.
            // PERSIST the pending state — never a response-only override.
            const { rows: pending } = await db.query(
                `UPDATE payment_intents SET state = 'pending', updated_at = NOW() WHERE id = $1 RETURNING *`,
                [intent.id]
            );
            return res.status(200).json({
                success: true,
                intent: pending[0],
                message: 'Payout intent created — submit the withdrawal through /api/payouts/requests.',
            });
        }

        // Method/direction combination not supported yet
        return res.status(400).json({
            success: false,
            message: `Method "${method}" with direction "${direction}" is not supported yet.`,
        });
    } catch (error) {
        if (error.code === 'VBR_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
        // DB-enforced idempotency: unique violation means a concurrent request
        // with the same key won the INSERT race. Same params → replay the
        // original; different params → clear conflict.
        if (error.code === '23505' && String(error.message || '').includes('payment_intent_idempotency')) {
            const { rows: existing } = await db.query(
                'SELECT * FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                [req.user.id, idempotencyKey]
            );
            if (existing.length > 0) {
                if (!paramsMatch(existing[0])) {
                    return res.status(409).json({
                        success: false, code: 'IDEMPOTENCY_CONFLICT',
                        message: 'This idempotency key was already used with different parameters.',
                    });
                }
                res.setHeader('Idempotent-Replay', 'true');
                return res.status(200).json({ success: true, replay: true, intent: existing[0] });
            }
        }
        console.error('VBR intent error:', error.message);
        res.status(500).json({ success: false, message: 'Could not create the payment intent.' });
    }
});

// ============================================================
// POST /api/vbr/intents/:id/cancel — cancel a non-terminal intent
// ============================================================
router.post('/api/vbr/intents/:id/cancel', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [req.params.id]);
        const intent = rows[0];
        if (!intent || intent.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Payment intent not found.' });
        }
        if (isTerminal(intent.state)) {
            return res.status(409).json({ success: false, message: `Intent is already ${intent.state} — cannot cancel.` });
        }
        // State machine validation: only created/pending can be cancelled
        if (!canTransition(intent.state, STATES.CANCELLED)) {
            return res.status(409).json({ success: false, message: `Cannot cancel from state "${intent.state}".` });
        }
        const { rows: cancelled } = await db.query(
            `UPDATE payment_intents SET state = 'cancelled', updated_at = NOW() WHERE id = $1 AND state IN ('created', 'pending') RETURNING *`,
            [intent.id]
        );
        if (cancelled.length === 0) {
            return res.status(409).json({ success: false, message: 'A concurrent request already changed this intent.' });
        }
        res.status(200).json({ success: true, intent: cancelled[0] });
    } catch (error) {
        console.error('VBR cancel error:', error.message);
        res.status(500).json({ success: false, message: 'Could not cancel the payment intent.' });
    }
});

// ============================================================
// POST /api/vbr/intents/:id/reconcile — trigger reconciliation
// Only meaningful for external rails; internal transfers settle synchronously.
// ============================================================
router.post('/api/vbr/intents/:id/reconcile', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1 LIMIT 1', [req.params.id]);
        const intent = rows[0];
        if (!intent || intent.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Payment intent not found.' });
        }
        // Internal transfers are always synchronous — no reconciliation needed
        // (check BEFORE terminal state so the message is more specific)
        if (intent.method === 'internal') {
            return res.status(200).json({ success: true, intent, message: 'Internal transfers settle synchronously — no reconciliation needed.' });
        }
        if (isTerminal(intent.state)) {
            return res.status(200).json({ success: true, intent, message: 'Terminal status already reached.' });
        }
        // External rails: reconciliation is handled by the specific route
        // (/api/payouts/requests/:id/reconcile for payouts, or the collections webhook)
        return res.status(200).json({
            success: true,
            intent,
            message: intent.method === 'payouts'
                ? 'Use POST /api/payouts/requests/:id/reconcile for authoritative payout status.'
                : 'Inbound collections are reconciled automatically via verified webhooks.',
        });
    } catch (error) {
        console.error('VBR reconcile error:', error.message);
        res.status(500).json({ success: false, message: 'Could not reconcile the payment intent.' });
    }
});

module.exports = router;
module.exports.STATES = STATES;
module.exports.canTransition = canTransition;
module.exports.isTerminal = isTerminal;
module.exports.assertTransition = assertTransition;
module.exports.validateConnector = validateConnector;
module.exports.vbrAvailability = vbrAvailability;
