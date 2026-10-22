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

const CURRENCY = 'INR';

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS virtual_accounts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            provider TEXT NOT NULL,
            provider_virtual_account_id TEXT NOT NULL UNIQUE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id UUID NOT NULL,
            currency TEXT NOT NULL DEFAULT 'INR',
            bank_code TEXT,
            account_number TEXT,
            ifsc TEXT,
            status TEXT NOT NULL DEFAULT 'provisioning'
                CHECK (status IN ('provisioning','active','conflict','error','disabled')),
            provisioned_at TIMESTAMP WITH TIME ZONE,
            last_error TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS collection_events (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            provider TEXT NOT NULL,
            event_id TEXT NOT NULL,
            event_type TEXT,
            status TEXT NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','credited','credited_duplicate','unmatched','currency_rejected','failed')),
            amount NUMERIC(15,2),
            currency TEXT,
            virtual_account_id TEXT,
            utr TEXT,
            credited_at TIMESTAMP WITH TIME ZONE,
            payload JSONB,
            received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    tablesReady = true;
}

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

// Deterministic, UPPERCASE-alphanumeric provider ID per user (Cashfree pattern
// ^[A-Z0-9]+$). Stable across retries — the SAME id must always map to the
// SAME user, which also makes provider-side duplicates (HTTP 409) meaningful.
function vAccountIdForUser(userId) {
    return ('VB' + String(userId).replace(/-/g, '')).toUpperCase();
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
        await ensureTables();
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
                name: user.full_name || 'VaultBank Customer',
                email: user.email,
                phone: user.phone || undefined,
            });
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
            return res.status(502).json({ success: false, code: e.code || 'COLLECTIONS_PROVIDER_ERROR', message: e.message });
        }
    } catch (error) {
        console.error('Collections my-details error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load your receiving details.' });
    }
});

// ============================================================
// POST /api/collections/webhook/cashfree — signature FIRST, then writes
// ============================================================
router.post('/api/collections/webhook/cashfree', express.raw({ type: 'application/json' }), async (req, res) => {
    let claimed = null;
    try {
        const active = activeCollectionsProvider();
        if (!active) {
            // No provider configured: nothing to verify against — fail closed.
            return res.status(503).json({ success: false, message: 'Collections provider not configured.' });
        }
        const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : null);
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
        if (!event || !event.eventId || !(event.amount > 0) || !event.virtualAccountId) {
            console.warn('[collections] Webhook missing identity fields — acked, not credited.');
            return res.status(200).json({ success: true, message: 'Event ignored (missing identity fields).' });
        }

        await ensureTables();

        // 3. Claim the event id exactly once (Cashfree delivers at-least-once).
        const claim = await db.query(
            `INSERT INTO collection_events (provider, event_id, event_type, amount, currency, virtual_account_id, utr, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (provider, event_id) DO NOTHING
             RETURNING id`,
            [active.name, event.eventId, event.eventType, event.amount, event.currency, event.virtualAccountId, event.utr, JSON.stringify(payload)]
        );
        if (claim.rowCount === 0) {
            return res.status(200).json({ success: true, duplicate: true, message: 'Duplicate event ignored.' });
        }
        claimed = claim.rows[0].id;

        // 4. Ownership mapping through the virtual account.
        const { rows: vaRows } = await db.query(
            `SELECT va.*, a.status AS account_status
             FROM virtual_accounts va JOIN accounts a ON a.id = va.account_id
             WHERE va.provider = $1 AND va.provider_virtual_account_id = $2
               AND va.status = 'active'
             LIMIT 1`,
            [active.name, event.virtualAccountId]
        );
        if (vaRows.length === 0) {
            await db.query("UPDATE collection_events SET status = 'unmatched' WHERE id = $1", [claimed]);
            return res.status(200).json({ success: true, message: 'Virtual account not matched — no credit.' });
        }
        const va = vaRows[0];

        // 5. Currency/amount validation.
        if (String(event.currency).toUpperCase() !== CURRENCY) {
            await db.query("UPDATE collection_events SET status = 'currency_rejected' WHERE id = $1", [claimed]);
            return res.status(200).json({ success: true, message: 'Non-INR payment not credited.' });
        }

        // 6. Ledger guard — crash-window recovery, exactly once.
        const { rows: seen } = await db.query(
            'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
            [event.eventId]
        );
        if (seen.length > 0) {
            await db.query("UPDATE collection_events SET status = 'credited_duplicate', credited_at = NOW() WHERE id = $1", [claimed]);
            return res.status(200).json({ success: true, duplicate: true, message: 'Already credited.' });
        }

        // 7. Atomic exactly-once credit to the user's INR account.
        const { rows: upd } = await db.query(
            'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after',
            [va.account_id, event.amount]
        );
        if (upd.length === 0) {
            await db.query("UPDATE collection_events SET status = 'failed' WHERE id = $1", [claimed]);
            return res.status(200).json({ success: true, message: 'Account missing at credit time — flagged.' });
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
            external_reference: event.eventId,
            metadata: {
                provider: active.name,
                automatic: true,
                virtual_account_id: event.virtualAccountId,
                utr: event.utr,
                remitter_name: event.remitterName,
                remitter_account_last4: event.remitterAccount,
            },
        });
        await createNotification(va.user_id, {
            type: 'transaction',
            title: 'Deposit received',
            message: `${CURRENCY} ${event.amount.toFixed(2)} received and credited automatically (UTR ${event.utr || event.eventId}). New balance: ${CURRENCY} ${after.toFixed(2)}.`,
        });
        await db.query("UPDATE collection_events SET status = 'credited', credited_at = NOW() WHERE id = $1", [claimed]);
        return res.status(200).json({ success: true, credited: true });
    } catch (error) {
        console.error('[collections] Webhook error:', error.message);
        if (claimed) {
            try { await db.query("UPDATE collection_events SET status = 'failed' WHERE id = $1", [claimed]); } catch (_) { /* noop */ }
        }
        // 500 makes Cashfree retry — correct, since we may have failed mid-flow.
        return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
    }
});

// ============================================================
// GET /api/collections/admin/overview — reconciliation visibility (admin)
// ============================================================
router.get('/api/collections/admin/overview', requireAdmin, async (req, res) => {
    try {
        await ensureTables();
        const { rows: counts } = await db.query(
            `SELECT status, COUNT(*) AS n FROM collection_events GROUP BY status`
        );
        const { rows: events } = await db.query(
            'SELECT id, provider, event_id, event_type, status, amount, currency, virtual_account_id, utr, received_at, credited_at FROM collection_events ORDER BY received_at DESC LIMIT 25'
        );
        const { rows: vas } = await db.query(
            `SELECT va.provider_virtual_account_id, va.user_id, va.status, va.bank_code, va.account_number, va.ifsc, va.provisioned_at
             FROM virtual_accounts va ORDER BY va.created_at DESC LIMIT 25`
        );
        res.status(200).json({ success: true, eventCounts: counts, recentEvents: events, virtualAccounts: vas });
    } catch (error) {
        console.error('Collections admin overview error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load the collections overview.' });
    }
});

module.exports = router;
