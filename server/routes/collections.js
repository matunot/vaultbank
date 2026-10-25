/**
 * VaultBank Collections Rail — provider-issued per-user INR receiving details.
 *
 * This is the AUTOMATIC inbound rail the product requires:
 *   1. A user opens an INR account, then GET /api/collections/my-details
 *      provisions a REAL virtual bank account through the configured provider
 *      (Cashfree Auto Collect today). Details shown to the user are exactly
 *      what the provider issued — account numbers/IFSC are never invented.
 *   2. The user sends INR from any Indian banking app to those details.
 *   3. The provider's webhook is SIGNATURE-VERIFIED BEFORE any database write;
 *      the payment is matched to the owning user via the virtual account ID,
 *      amount/currency are validated, and the INR ledger account is credited
 *      EXACTLY ONCE (event-id claim + ledger guard + atomic RETURNING credit).
 *   4. Duplicate deliveries (Cashfree is at-least-once) can never double-credit.
 *
 * Fail-closed: without a configured provider every route answers 503 and no
 * virtual account, detail, or credit is ever fabricated.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    db,
    findUserById,
    createTransaction,
    createNotification,
    createAuditLog,
} = require('../config/database');
const { activeCollectionsProvider, collectionsAvailability } = require('../collections');
const { ensureCollectionsSchema } = require('../collections/schema');

const CURRENCY = 'INR';

async function audit(userId, action, resourceId, details, req) {
    try {
        await createAuditLog({
            userId,
            action,
            resourceType: 'virtual_account',
            resourceId,
            details,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    } catch (_) { /* best-effort; money paths above are already atomic */ }
}

// Deterministic, UPPERCASE-alphanumeric provider ID per user. Cashfree allows
// at most 20 characters ((^[A-Z0-9]+$) + length cap), so the user UUID is
// hashed to 18 hex chars: VB + 18 = 20. Stable across retries — the SAME id
// must always map to the SAME user, which also makes provider duplicates
// (HTTP 409) meaningful.
function vAccountIdForUser(userId) {
    const hash = crypto.createHash('sha256').update(String(userId)).digest('hex');
    return 'VB' + hash.slice(0, 18).toUpperCase();
}

// ============================================================
// GET /api/collections/availability — PUBLIC readiness booleans.
// Only configuration state, never secrets or user data.
// ============================================================
router.get('/api/collections/availability', (req, res) => {
    res.status(200).json({ success: true, ...collectionsAvailability(), currency: CURRENCY });
});

// ============================================================
// GET /api/collections/my-details — provision/return my virtual account
// ============================================================
router.get('/api/collections/my-details', authenticateToken, async (req, res) => {
    try {
        const active = activeCollectionsProvider();
        if (!active) {
            return res.status(503).json({
                success: false,
                code: 'COLLECTIONS_NOT_CONFIGURED',
                message: 'Per-user receiving accounts are not available yet — no collection provider is configured.',
                availability: collectionsAvailability(),
            });
        }
        await ensureCollectionsSchema();
        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        // The rail credits the user's INR account — it must exist first.
        const { rows: inrRows } = await db.query(
            "SELECT * FROM accounts WHERE user_id = $1 AND currency = $2 AND status = 'active' ORDER BY created_at ASC LIMIT 1",
            [req.user.id, CURRENCY]
        );
        if (inrRows.length === 0) {
            return res.status(409).json({
                success: false,
                code: 'INR_ACCOUNT_REQUIRED',
                message: 'Open an INR account first (POST /api/account/open-inr), then your receiving details will be issued.',
            });
        }
        const inrAccount = inrRows[0];

        const providerVAccountId = vAccountIdForUser(req.user.id);
        const { rows: existing } = await db.query(
            'SELECT * FROM virtual_accounts WHERE provider = $1 AND provider_virtual_account_id = $2 LIMIT 1',
            [active.name, providerVAccountId]
        );

        if (existing.length > 0 && existing[0].status === 'active' && existing[0].account_number && existing[0].ifsc) {
            return res.status(200).json({
                success: true,
                currency: CURRENCY,
                provider: active.name,
                details: {
                    accountNumber: existing[0].account_number,
                    ifsc: existing[0].ifsc,
                    bankCode: existing[0].bank_code,
                },
                status: 'active',
            });
        }

        // Claim the row BEFORE the provider call so concurrent requests cannot
        // double-provision (UNIQUE provider_virtual_account_id is the backstop).
        if (existing.length === 0) {
            await db.query(
                `INSERT INTO virtual_accounts (provider, provider_virtual_account_id, user_id, account_id, currency, status)
                 VALUES ($1, $2, $3, $4, $5, 'provisioning')
                 ON CONFLICT (provider, provider_virtual_account_id) DO NOTHING`,
                [active.name, providerVAccountId, req.user.id, inrAccount.id, CURRENCY]
            );
        } else if (existing[0].status === 'disabled') {
            return res.status(409).json({ success: false, message: 'Your receiving account is disabled — contact support.' });
        }

        try {
            const issued = await active.adapter.createVirtualAccount({
                virtualAccountId: providerVAccountId,
                name: user.full_name,
                email: user.email,
                phone: user.phone,
            });
            if (String(issued.status || '').toLowerCase() !== 'active') {
                const notActive = new Error('Provider has not activated the virtual account yet.');
                notActive.code = 'COLLECTIONS_VBA_NOT_ACTIVE';
                throw notActive;
            }
            const { rows: updated } = await db.query(
                `UPDATE virtual_accounts
                 SET status = 'active', bank_code = $3, account_number = $4, ifsc = $5,
                     provisioned_at = NOW(), last_error = NULL, updated_at = NOW()
                 WHERE provider = $1 AND provider_virtual_account_id = $2 AND status != 'active'
                 RETURNING *`,
                [active.name, providerVAccountId, issued.bankCode, issued.accountNumber, issued.ifsc]
            );
            if (updated.length === 0) {
                // Row became active concurrently — re-read and return the live details.
                const { rows: liveRows } = await db.query(
                    'SELECT * FROM virtual_accounts WHERE provider = $1 AND provider_virtual_account_id = $2 LIMIT 1',
                    [active.name, providerVAccountId]
                );
                const live = liveRows[0];
                return res.status(200).json({
                    success: true,
                    currency: CURRENCY,
                    provider: active.name,
                    details: { accountNumber: live.account_number, ifsc: live.ifsc, bankCode: live.bank_code },
                    status: 'active',
                });
            }
            await audit(req.user.id, 'virtual_account_provisioned', providerVAccountId, { provider: active.name }, req);
            return res.status(200).json({
                success: true,
                currency: CURRENCY,
                provider: active.name,
                details: {
                    accountNumber: updated[0].account_number,
                    ifsc: updated[0].ifsc,
                    bankCode: updated[0].bank_code,
                },
                status: 'active',
            });
        } catch (e) {
            const conflict = e.code === 'COLLECTIONS_VBA_ALREADY_EXISTS';
            // Guarded failure mark: never downgrade a row that became active
            // concurrently (a lost race must not clobber real details).
            await db.query(
                `UPDATE virtual_accounts
                 SET status = $3, last_error = $4, updated_at = NOW()
                 WHERE provider = $1 AND provider_virtual_account_id = $2 AND status != 'active'`,
                [active.name, providerVAccountId, conflict ? 'conflict' : 'error', e.message]
            );
            await audit(req.user.id, conflict ? 'virtual_account_provision_conflict' : 'virtual_account_provision_failed', providerVAccountId, { error: e.code }, req);
            if (conflict) {
                return res.status(409).json({ success: false, code: 'COLLECTIONS_VBA_CONFLICT', message: e.message });
            }
            if (e.code === 'COLLECTIONS_CUSTOMER_DETAILS_REQUIRED') {
                return res.status(400).json({ success: false, code: e.code, message: e.message });
            }
            // Never echo raw provider error text to the customer. The code is
            // enough to support them; the details stay in last_error/audit.
            return res.status(502).json({
                success: false,
                code: e.code || 'COLLECTIONS_PROVIDER_ERROR',
                message: 'The provider could not issue your receiving details. Try again later.',
            });
        }
    } catch (error) {
        console.error('Collections my-details error:', error.message);
        if (error.code === 'COLLECTIONS_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Could not load your receiving details.' });
    }
});

// ============================================================
// POST /api/collections/webhook/cashfree — signature FIRST, then writes
// ============================================================
router.post('/api/collections/webhook/cashfree', express.raw({ type: 'application/json' }), async (req, res) => {
    let client = null;
    try {
        const active = activeCollectionsProvider();
        if (!active) {
            // No provider configured: nothing to verify against — fail closed.
            return res.status(503).json({ success: false, message: 'Collections provider not configured.' });
        }
        const rawBody = Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : (typeof req.body === 'string'
                ? req.body
                : (Buffer.isBuffer(req.rawBody)
                    ? req.rawBody.toString('utf8')
                    : (typeof req.rawBody === 'string' ? req.rawBody : null)));
        if (!rawBody) {
            return res.status(400).json({ success: false, message: 'Missing raw body.' });
        }

        // 1. Cryptographic verification BEFORE any database write.
        if (!active.adapter.verifyWebhookSignature(rawBody, req.headers || {})) {
            console.error('[collections] Webhook signature verification failed — ignored.');
            return res.status(400).json({ success: false, message: 'Webhook signature verification failed.' });
        }

        let payload;
        try {
            payload = JSON.parse(rawBody);
        } catch (_) {
            return res.status(400).json({ success: false, message: 'Malformed payload.' });
        }

        // 2. Normalize + validate the payment event.
        const event = active.adapter.parsePaymentWebhook(payload);
        // Do not ack a signed-but-unusable event: Cashfree treats 2xx as
        // delivered and never retries, so an unparseable payment would vanish.
        // Record it as failed for operators, then return non-2xx.
        const invalidReason = !event
            ? 'unsupported event'
            : (!event.eventId
                ? 'missing event id'
                : (!(event.amount > 0)
                    ? 'missing or invalid amount'
                    : (!/^\d+(\.\d{1,2})?$/.test(String(event.amount))
                        ? 'invalid amount precision'
                        : (!event.virtualAccountId ? 'missing virtual account id' : null))));
        if (invalidReason) {
            await ensureCollectionsSchema();
            const invalidEventId = 'invalid:' + crypto.createHash('sha256').update(rawBody).digest('hex');
            await db.query(
                `INSERT INTO collection_events (provider, event_id, event_type, status, amount, currency, virtual_account_id, utr, payload)
                 VALUES ($1, $2, $3, 'failed', $4, $5, $6, $7, $8)
                 ON CONFLICT (provider, event_id) DO NOTHING`,
                [
                    active.name,
                    invalidEventId,
                    (event && event.eventType) || 'UNSUPPORTED',
                    event && Number.isFinite(event.amount) && event.amount > 0 ? event.amount : null,
                    (event && event.currency) || null,
                    (event && event.virtualAccountId) || null,
                    (event && event.utr) || null,
                    JSON.stringify(payload),
                ]
            );
            console.warn('[collections] Invalid signed webhook recorded as failed:', invalidReason, 'event', event && event.eventId);
            return res.status(400).json({ success: false, code: 'COLLECTIONS_EVENT_INVALID', message: 'Webhook event could not be processed (' + invalidReason + ').' });
        }
        if (event.paymentStatus && String(event.paymentStatus).toUpperCase() !== 'SUCCESS') {
            return res.status(200).json({ success: true, message: 'Non-success payment event ignored.' });
        }

        await ensureCollectionsSchema();

        // UTR is the stable bank reference; fall back to the provider payment id.
        const paymentReference = String(event.paymentReference || event.eventId);
        const eventCurrency = String(event.currency || '').trim().toUpperCase();

        client = await db.getClient();
        await client.query('BEGIN');

        // Serialize retries for the same provider payment even when Cashfree
        // delivers it under two different event ids (new + legacy payloads).
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['collection:' + paymentReference]);

        // 3. Claim the event id exactly once (Cashfree delivers at-least-once).
        const claim = await client.query(
            `INSERT INTO collection_events (provider, event_id, event_type, amount, currency, virtual_account_id, utr, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (provider, event_id) DO NOTHING
             RETURNING id`,
            [active.name, event.eventId, event.eventType || null, event.amount, eventCurrency || null, event.virtualAccountId, event.utr || null, JSON.stringify(payload)]
        );
        if (claim.rowCount === 0) {
            await client.query('COMMIT');
            return res.status(200).json({ success: true, duplicate: true, message: 'Duplicate event ignored.' });
        }
        const eventRowId = claim.rows[0].id;

        // 4. Ownership mapping through the virtual account. A frozen/missing
        // account is NOT acknowledged: roll back and let Cashfree retry so the
        // money is never silently lost. Any non-disabled row is valid here: the
        // provider issued this VBA and its signed webhook proves the money
        // arrived, even if a previous create response was lost (conflict/error).
        const { rows: vaRows } = await client.query(
            `SELECT va.*
             FROM virtual_accounts va JOIN accounts a ON a.id = va.account_id
             WHERE va.provider = $1 AND va.provider_virtual_account_id = $2
               AND va.status <> 'disabled' AND a.status = 'active'
             LIMIT 1`,
            [active.name, event.virtualAccountId]
        );
        if (vaRows.length === 0) {
            await client.query('ROLLBACK');
            console.error('[collections] Unmatched virtual account for event', event.eventId, 'va', event.virtualAccountId, '— provider will retry.');
            return res.status(500).json({ success: false, code: 'COLLECTIONS_VA_UNMATCHED', message: 'Virtual account not ready — retry later.' });
        }
        const va = vaRows[0];

        // 5. Currency validation.
        if (eventCurrency !== CURRENCY) {
            await client.query("UPDATE collection_events SET status = 'currency_rejected' WHERE id = $1", [eventRowId]);
            await client.query('COMMIT');
            return res.status(200).json({ success: true, message: 'Non-INR payment not credited.' });
        }

        // 6. Ledger guard — crash-window recovery, exactly once. The payment
        // reference (UTR when present) is stable across webhook generations.
        const { rows: seen } = await client.query(
            'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
            [paymentReference]
        );
        if (seen.length > 0) {
            await client.query("UPDATE collection_events SET status = 'credited_duplicate', credited_at = NOW() WHERE id = $1", [eventRowId]);
            await client.query('COMMIT');
            return res.status(200).json({ success: true, duplicate: true, message: 'Already credited.' });
        }

        // 7. Credit + ledger + event status in ONE transaction. A failure at
        // any point rolls the whole credit back; the provider retry re-claims
        // the event and starts cleanly.
        const { rows: upd } = await client.query(
            `UPDATE accounts
                SET balance = balance + $2, available_balance = available_balance + $2
              WHERE id = $1
              RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
            [va.account_id, event.amount]
        );
        if (upd.length === 0) {
            await client.query('ROLLBACK');
            return res.status(500).json({ success: false, code: 'COLLECTIONS_ACCOUNT_MISSING', message: 'Account missing — retry later.' });
        }
        const before = parseFloat(upd[0].balance_before);
        const after = parseFloat(upd[0].balance_after);
        await createTransaction({
            account_id: va.account_id,
            user_id: va.user_id,
            type: 'deposit',
            status: 'completed',
            amount: event.amount,
            currency: CURRENCY,
            balance_before: before,
            balance_after: after,
            description: `INR collection — ${event.utr ? 'UTR ' + event.utr : 'event ' + event.eventId}`,
            category: 'income',
            external_reference: paymentReference,
            metadata: {
                provider: active.name,
                automatic: true,
                virtual_account_id: event.virtualAccountId,
                utr: event.utr,
                remitter_name: event.remitterName,
                remitter_account_last4: event.remitterAccount ? String(event.remitterAccount).slice(-4) : null,
            },
        }, client);
        await client.query("UPDATE collection_events SET status = 'credited', credited_at = NOW() WHERE id = $1", [eventRowId]);
        await client.query('COMMIT');

        // Notification is best-effort AFTER the money transaction commits.
        try {
            await createNotification(va.user_id, {
                type: 'transaction',
                title: 'Deposit received',
                message: `${CURRENCY} ${Number(event.amount).toFixed(2)} received and credited automatically (UTR ${event.utr || event.eventId}). New balance: ${CURRENCY} ${after.toFixed(2)}.`,
            });
        } catch (notifErr) {
            console.warn('[collections] Credit notification failed (credit committed):', notifErr.message);
        }
        return res.status(200).json({ success: true, credited: true });
    } catch (error) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* already committed or connection lost */ }
        }
        console.error('[collections] Webhook error:', error.message);
        if (error.code === 'COLLECTIONS_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
        // 500 makes Cashfree retry — correct, since we may have failed mid-flow.
        return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
    } finally {
        if (client) client.release();
    }
});

// ============================================================
// GET /api/collections/admin/overview — reconciliation visibility (admin)
// ============================================================
router.get('/api/collections/admin/overview', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureCollectionsSchema();
        const { rows: counts } = await db.query(
            `SELECT status, COUNT(*) AS n FROM collection_events GROUP BY status`
        );
        const { rows: events } = await db.query(
            'SELECT id, provider, event_id, event_type, status, amount, currency, virtual_account_id, utr, received_at, credited_at FROM collection_events ORDER BY received_at DESC LIMIT 25'
        );
        const { rows: vas } = await db.query(
            `SELECT va.provider_virtual_account_id, va.user_id, va.status, va.bank_code,
                    CASE WHEN length(va.account_number) > 4
                         THEN '****' || right(va.account_number, 4)
                         ELSE va.account_number END AS account_number,
                    va.ifsc, va.provisioned_at
             FROM virtual_accounts va ORDER BY va.created_at DESC LIMIT 25`
        );
        res.status(200).json({ success: true, eventCounts: counts, recentEvents: events, virtualAccounts: vas });
    } catch (error) {
        console.error('Collections admin overview error:', error.message);
        if (error.code === 'COLLECTIONS_SCHEMA_NOT_READY') {
            return res.status(503).json({ success: false, code: error.code, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Could not load the collections overview.' });
    }
});

module.exports = router;
