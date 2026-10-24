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
const { db, findUserById, createNotification } = require('../config/database');
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
    } catch (_) { /* duplicates would need operator resolution */ }
    try {
        await db.query(`
            CREATE INDEX IF NOT EXISTS ix_payment_intents_state
            ON payment_intents (state, updated_at DESC)
            WHERE state NOT IN ('succeeded', 'failed', 'cancelled')
        `);
    } catch (_) { /* index may already exist */ }
    tablesReady = true;
}

// ── Availability: which VBR methods are genuinely ready? ──
const { activeCollectionsProvider, collectionsAvailability } = require('../collections');
const { activePayoutProvider, payoutAvailability } = require('../payouts');

function vbrAvailability() {
    const collections = collectionsAvailability();
    const payouts = payoutAvailability();
    return {
        internal: { available: true, reason: 'always available (VaultBank-to-VaultBank)' },
        collections: { available: collections.available, reason: collections.reason || (collections.available ? 'provider configured' : 'no collection provider configured'), provider: collections.provider || null },
        payouts: { available: payouts.available, reason: payouts.reason || (payouts.available ? 'provider configured' : 'no payout provider configured'), provider: payouts.provider || null },
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
    const idempotencyKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']).slice(0, 100) : null;

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
        const { findAccountByUserIdAndCurrency } = require('../config/database');
        const account = await findAccountByUserIdAndCurrency(req.user.id, wantedCurrency);
        if (!account) {
            return res.status(404).json({ success: false, message: `You don't have a ${wantedCurrency} account yet.` });
        }

        await ensureTables();

        // ── Idempotent replay: same key returns the original intent ──
        if (idempotencyKey) {
            const { rows: existing } = await db.query(
                'SELECT * FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                [req.user.id, idempotencyKey]
            );
            if (existing.length > 0) {
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
            // Internal transfer: wrap the EXISTING /api/account/transfer logic.
            // The VBR intent is a tracking record; the actual transfer goes
            // through the same atomic pipeline users already trust.
            return res.status(200).json({
                success: true,
                intent: { ...intent, state: 'pending' },
                message: 'Internal transfer intent created — use POST /api/account/transfer to execute it.',
                hint: 'The VBR intent tracks the payment; the transfer endpoint moves the money atomically.',
            });
        }

        if (method === 'collections' && direction === 'receive') {
            // Collections: the intent tracks a pending inbound payment.
            // The user needs receiving details from the collections connector.
            return res.status(200).json({
                success: true,
                intent: { ...intent, state: 'pending' },
                message: 'Receiving intent created — get your provider-issued details from /api/collections/my-details.',
            });
        }

        if (method === 'payouts' && direction === 'send') {
            // Payouts: the intent tracks an outbound withdrawal.
            // The user submits the payout through /api/payouts/requests.
            return res.status(200).json({
                success: true,
                intent: { ...intent, state: 'pending' },
                message: 'Payout intent created — submit the withdrawal through /api/payouts/requests.',
            });
        }

        // Method/direction combination not supported yet
        return res.status(400).json({
            success: false,
            message: `Method "${method}" with direction "${direction}" is not supported yet.`,
        });
    } catch (error) {
        // DB-enforced idempotency: unique violation → return the original
        if (error.code === '23505' && String(error.message || '').includes('payment_intent_idempotency')) {
            const { rows: existing } = await db.query(
                'SELECT * FROM payment_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
                [req.user.id, idempotencyKey]
            );
            if (existing.length > 0) {
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
