/**
 * Provider payout webhooks — server-to-server receiver.
 *
 * POST /api/providers/nium/webhook
 *   Authentication: `x-api-key` shared secret (official contract). Fail-closed:
 *   unset secret or wrong key -> 401, nothing parsed or stored.
 *   Idempotency: events are stored keyed on (provider, event_id) — replays are
 *   ignored (the provider retries on failure; we must never re-apply).
 *   Ordering: status transitions only ever move forward (rank guard) — a late
 *   duplicate or out-of-order event can never pull a payout back out of a
 *   terminal state. INFO_REQUESTED is carried as a flag, not a rank, so
 *   resolved RFIs can progress to SENT_TO_BANK/PAID afterwards.
 *
 * Isolation: provider payouts/events are their own tables (provider_*). This
 * route NEVER reads or writes `accounts` — money arriving in the provider's
 * treasury is provider money, never a customer deposit. Disabled entirely in
 * chain test mode (503): sandbox-namespace discipline.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');
const testnet = require('../payments/usdc-testnet');
const nium = require('../providers/nium');

// Status ranks shared with the adapter mapping (see providers/nium.js).
const RANKS = { pending: 1, processing: 2, succeeded: 4, failed: 4, refunded: 4, reconciliation_required: 5 };

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS provider_payouts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider TEXT NOT NULL,
            request_id TEXT NOT NULL,
            payment_id TEXT,
            beneficiary_name TEXT,
            beneficiary_country TEXT,
            source_currency TEXT,
            dest_currency TEXT,
            source_amount NUMERIC(15,2),
            dest_amount NUMERIC(12,2),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','succeeded','failed','refunded','reconciliation_required')),
            sub_status TEXT,
            rfi_open BOOLEAN NOT NULL DEFAULT false,
            last_event_at TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE (provider, request_id)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS provider_webhook_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider TEXT NOT NULL,
            event_id TEXT NOT NULL,
            payment_id TEXT,
            status_seen TEXT,
            applied BOOLEAN NOT NULL DEFAULT false,
            note TEXT,
            payload JSONB,
            received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE (provider, event_id)
        )
    `);
    tablesReady = true;
}

function timingSafeEqualStr(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// Monotonic guard for equal-rank transitions: statuses may refresh in place,
// and a partial/full RETURN may land after PAID — but a paid payout can never
// be pulled back out of terminal states by a late or noisy event.
function sameRankAllowed(current, incoming, rank) {
    return current === incoming || (rank === 4 && incoming === 'refunded') || (rank === 4 && incoming === 'reconciliation_required');
}

async function audit(action, resourceId, details) {
    if (testnet.MODE) return; // sandbox namespace never touches audit_logs
    try {
        await db.query(
            'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [null, action, 'provider_payout', resourceId, JSON.stringify(details || {}), null, 'provider-webhook']
        );
    } catch (e) { console.error('audit log error:', e.message); }
}

router.post('/api/providers/nium/webhook', async (req, res) => {
    try {
        if (testnet.MODE) return res.status(503).json({ success: false, message: 'Provider webhooks are disabled in chain test mode.' });

        // Authenticate before ANY database work — unauthenticated traffic must
        // pay for nothing. Fail-closed: no secret configured -> 401.
        const cfg = nium.config();
        if (!cfg.configured || !cfg.webhookKey) {
            return res.status(401).json({ success: false, message: 'Webhook receiver not configured.' });
        }
        const providedKey = req.headers['x-api-key'];
        if (!providedKey || !timingSafeEqualStr(providedKey, cfg.webhookKey)) {
            return res.status(401).json({ success: false, message: 'Invalid webhook authentication.' });
        }

        await ensureTables();
        const p = req.body || {};
        const paymentId = p.payment_id;
        if (!paymentId || !p.status) {
            return res.status(400).json({ success: false, message: 'Malformed event: payment_id and status are required.' });
        }
        if (p.event && p.event !== 'TRANSACTION_STATUS_CHANGE') {
            return res.status(200).json({ success: true, applied: false, note: 'unsupported event type ignored' });
        }

        // Dedupe key: payment + status + timestamp (official payload fields).
        const eventId = paymentId + ':' + p.status + ':' + (p.timestamp || '');

        const inserted = await db.query(
            `INSERT INTO provider_webhook_events (provider, event_id, payment_id, status_seen, payload)
             VALUES ('nium', $1, $2, $3, $4)
             ON CONFLICT (provider, event_id) DO NOTHING
             RETURNING id`,
            [eventId, paymentId, p.status, JSON.stringify(p)]
        );
        if (inserted.rows.length === 0) {
            return res.status(200).json({ success: true, applied: false, duplicate: true });
        }

        const mapped = nium.normalizeStatus(p.status);
        let status = mapped.status;
        let rfiOpen = mapped.rfi === true;
        // A partial return splits the money back to the treasury — amounts need
        // an operator; full returns are a plain refunded state.
        if (p.status === 'RETURNED' && p.partial_return_details) status = 'reconciliation_required';

        // Unknown provider statuses land in reconciliation_required (+rank 5):
        // fetch the current row and honor the monotonic guard.
        const { rows: payoutRows } = await db.query(
            'SELECT id, status, rfi_open, last_event_at FROM provider_payouts WHERE provider = $1 AND payment_id = $2 LIMIT 1',
            ['nium', paymentId]
        );
        if (payoutRows.length === 0) {
            // Event before the payout row exists (or a foreign event): keep it
            // stored for reconciliation, nothing to apply.
            await audit('provider_event_unmatched', paymentId, { eventId, status: p.status });
            return res.status(200).json({ success: true, applied: false, note: 'no matching payout row; event stored' });
        }
        const payout = payoutRows[0];
        const currentRank = RANKS[payout.status] || 0;
        const incomingRank = RANKS[status] || 0;

        let applied = false;
        if (incomingRank > currentRank || sameRankAllowed(payout.status, status, currentRank)) {
            const upd = await db.query(
                `UPDATE provider_payouts
                    SET status = $2, sub_status = $3, rfi_open = $4, last_event_at = $5, updated_at = NOW()
                  WHERE id = $1 AND status = $6`, // optimistic: no concurrent transition overwrites
                [payout.id, status, p.sub_status || null, rfiOpen || payout.rfi_open, p.timestamp || null, payout.status]
            );
            applied = (upd.rowCount || 0) > 0;
        }
        if (applied) {
            await audit('provider_payout_status_update', paymentId, {
                eventId, payoutId: payout.id, from: payout.status, to: status,
                providerStatus: p.status, subStatus: p.sub_status || null,
                returnReason: p.return_reason || null,
            });
        }
        return res.status(200).json({ success: true, applied });
    } catch (e) {
        console.error('provider webhook error:', e.message);
        // 200-with-flag: the event is stored; provider retries must not duplicate-apply.
        return res.status(200).json({ success: false, applied: false, note: 'internal error' });
    }
});

module.exports = router;
