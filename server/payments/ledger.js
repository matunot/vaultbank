/**
 * Payment persistence helpers (Sprint 1)
 * --------------------------------------
 * Thin wrappers over the `pg` pool exposed by `server/config/db.js`.
 * These functions write to the new `payments` / `webhook_events` /
 * `idempotency_keys` / `settlements` tables from migration 005.
 *
 * All functions are best-effort: if the database is unavailable (demo
 * mode, Vercel cold start without DATABASE_URL), they return `null`
 * and log a warning instead of throwing. The webhook route still
 * returns 200 to the provider (we never want a provider to retry a
 * webhook we already received), but the audit trail is just kept in
 * the in-memory audit log on the route.
 */

const { query } = require('../config/db');
const { logAudit } = require('../utils/audit');

/**
 * Insert (or upsert) a payment row. Returns the row id, or null on failure.
 */
async function upsertPayment(row) {
    if (!row || !row.provider || !row.provider_id) {
        throw new Error('upsertPayment: provider and provider_id are required');
    }
    const sql = `
        INSERT INTO payments (
            provider, provider_id, from_account_id, to_identifier,
            amount, currency, status, method, user_id,
            idempotency_key, client_secret, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (provider, provider_id) DO UPDATE
        SET status = COALESCE(EXCLUDED.status, payments.status),
            client_secret = COALESCE(EXCLUDED.client_secret, payments.client_secret),
            metadata = payments.metadata || EXCLUDED.metadata
        RETURNING id, status, created_at, updated_at
    `;
    const params = [
        row.provider,
        row.provider_id,
        row.from_account_id || null,
        row.to_identifier,
        row.amount,
        row.currency,
        row.status || 'pending',
        row.method || null,
        row.user_id || null,
        row.idempotency_key || null,
        row.client_secret || null,
        JSON.stringify(row.metadata || {}),
    ];
    try {
        const { rows } = await query(sql, params);
        return rows[0] || null;
    } catch (err) {
        // demo mode or table missing -> silent no-op
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[payments.ledger] upsertPayment skipped:', err.message);
        } else {
            console.error('[payments.ledger] upsertPayment failed:', err.message);
        }
        return null;
    }
}

/**
 * Update the status of a payment by provider + provider_id.
 */
async function updatePaymentStatus(provider, providerId, status, extra = {}) {
    const fields = ['status = $3'];
    const params = [provider, providerId, status];
    let i = 4;
    if (extra.metadata) {
        fields.push(`metadata = metadata || $${i++}::jsonb`);
        params.push(JSON.stringify(extra.metadata));
    }
    if (extra.client_secret) {
        fields.push(`client_secret = $${i++}`);
        params.push(extra.client_secret);
    }
    const sql = `
        UPDATE payments SET ${fields.join(', ')}
        WHERE provider = $1 AND provider_id = $2
        RETURNING id
    `;
    try {
        const { rows } = await query(sql, params);
        return rows[0] || null;
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[payments.ledger] updatePaymentStatus skipped:', err.message);
        } else {
            console.error('[payments.ledger] updatePaymentStatus failed:', err.message);
        }
        return null;
    }
}

/**
 * Record a webhook event and return whether this is the FIRST time we've
 * seen it. If we've already processed it, returns { duplicate: true }.
 *
 * The unique index (provider, provider_event_id) makes the INSERT race-safe.
 */
async function recordWebhookEvent({ provider, providerEventId, eventType, payload }) {
    const sql = `
        INSERT INTO webhook_events (provider, provider_event_id, event_type, payload)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (provider, provider_event_id) DO NOTHING
        RETURNING id, received_at
    `;
    const params = [provider, providerEventId, eventType || null, JSON.stringify(payload || {})];
    try {
        const { rows } = await query(sql, params);
        if (rows[0]) return { duplicate: false, id: rows[0].id };
        return { duplicate: true };
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[payments.ledger] recordWebhookEvent skipped:', err.message);
        } else {
            console.error('[payments.ledger] recordWebhookEvent failed:', err.message);
        }
        // Fail open: if we can't dedup, let the handler run -- worst case
        // is a duplicate ledger write that the daily reconciliation will
        // catch and roll back.
        return { duplicate: false, id: null, dbError: err.message };
    }
}

async function markWebhookProcessed(id, { status = 'processed', error = null } = {}) {
    if (!id) return;
    try {
        await query(
            `UPDATE webhook_events SET processed_at = now(), status = $2, error = $3 WHERE id = $1`,
            [id, status, error]
        );
    } catch (err) {
        console.warn('[payments.ledger] markWebhookProcessed skipped:', err.message);
    }
}

/**
 * Persist a settlement row tied to a payment.
 */
async function createSettlement(row) {
    if (!row || !row.payment_id) {
        throw new Error('createSettlement: payment_id is required');
    }
    const sql = `
        INSERT INTO settlements (
            payment_id, provider, provider_settlement_id,
            settled_at, amount, currency, status, raw
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
    `;
    const params = [
        row.payment_id,
        row.provider,
        row.provider_settlement_id || null,
        row.settled_at || null,
        row.amount,
        row.currency,
        row.status || 'pending',
        JSON.stringify(row.raw || {}),
    ];
    try {
        const { rows } = await query(sql, params);
        return rows[0] || null;
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[payments.ledger] createSettlement skipped:', err.message);
        } else {
            console.error('[payments.ledger] createSettlement failed:', err.message);
        }
        return null;
    }
}

/**
 * Look up a payment by idempotency key. Used by the transfer route so
 * a retried POST with the same key returns the original payment.
 */
async function findPaymentByIdempotencyKey(key) {
    if (!key) return null;
    try {
        const { rows } = await query(
            `SELECT id, provider, provider_id, status, amount, currency, client_secret, metadata
             FROM payments WHERE idempotency_key = $1 LIMIT 1`,
            [key]
        );
        return rows[0] || null;
    } catch (err) {
        return null;
    }
}

/**
 * Convenience: log a payment-related audit event regardless of whether
 * the DB is reachable. Falls back to the in-memory audit log on the route.
 */
async function logPaymentEvent(userId, action) {
    try {
        return await logAudit(userId, action, 'payment');
    } catch (_) {
        return null;
    }
}

module.exports = {
    upsertPayment,
    updatePaymentStatus,
    recordWebhookEvent,
    markWebhookProcessed,
    createSettlement,
    findPaymentByIdempotencyKey,
    logPaymentEvent,
};
