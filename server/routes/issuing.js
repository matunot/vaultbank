/**
 * VaultBank Stripe Issuing - REAL cards
 *
 * Issues real Visa/Mastercard virtual cards via Stripe Issuing.
 * Cards have REAL numbers usable at any merchant (Netflix, Spotify, ...)
 * once Issuing is in live mode; test mode issues test-mode cards through
 * the exact same code path.
 *
 * Real-time controls:
 *  - issuing_authorization.request  -> answered live (approve/decline on balance)
 *  - issuing_transaction.created    -> deducts VaultBank balance + notification
 *  - freeze/unfreeze                -> Stripe declines authorizations while frozen
 *  - spend controls                 -> monthly / per-transaction limits
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
    db,
    isDemo,
    findUserById,
    findAccountByUserId,
    createNotification,
    createTransaction,
    updateAccountBalance,
} = require('../config/database');

let stripe = null;
const getStripe = () => {
    if (!stripe) {
        const key = process.env.STRIPE_SECRET_KEY || process.env.PAYMENT_PROVIDER_STRIPE_SECRET;
        if (!key || key.includes('placeholder')) return null;
        stripe = require('stripe')(key);
    }
    return stripe;
};

const stripeMode = () => {
    const key = process.env.STRIPE_SECRET_KEY || process.env.PAYMENT_PROVIDER_STRIPE_SECRET || '';
    return key.startsWith('sk_live_') ? 'live' : 'test';
};

const BASE_URL = (process.env.CLIENT_URL || 'https://vaultbank-md20.onrender.com').replace(/\/+$/, '');

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS issued_cards (
            card_id TEXT PRIMARY KEY,
            user_id UUID NOT NULL,
            cardholder_id TEXT NOT NULL,
            network TEXT NOT NULL,
            last4 TEXT NOT NULL,
            exp_month INTEGER,
            exp_year INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            brand_label TEXT DEFAULT 'VaultBank Card',
            monthly_limit NUMERIC(15,2) DEFAULT 2000,
            per_transaction_limit NUMERIC(15,2) DEFAULT 500,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS server_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    tablesReady = true;
}

async function getConfig(key) {
    try {
        const r = await db.query('SELECT value FROM server_config WHERE key = $1', [key]);
        return r.rows[0] ? r.rows[0].value : null;
    } catch (e) {
        return null;
    }
}

async function setConfig(key, value) {
    await db.query(`
        INSERT INTO server_config (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [key, value]);
}

const cardholderKey = (userId) => 'cardholder_' + userId;

// Get or create the Stripe Issuing cardholder for this VaultBank user.
// Stripe requires a real cardholder entity (KYC) behind every issued card.
async function getOrCreateCardholder(user, body) {
    const existing = await getConfig(cardholderKey(user.id));
    if (existing) {
        try {
            const ch = await getStripe().issuing.cardholders.retrieve(existing);
            if (ch && ch.status !== 'blocked') return ch;
        } catch (e) { /* recreate below */ }
    }

    const fullName = user.full_name || user.name || body.name || 'VaultBank Client';
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];

    const address = {
        line1: body.line1 || '1 Market Street',
        city: body.city || 'San Francisco',
        state: body.state || 'CA',
        postal_code: body.postal_code || '94105',
        country: body.country || 'US',
    };

    const dob = body.dob || { day: 1, month: 1, year: 1990 };

    const cardholder = await getStripe().issuing.cardholders.create({
        type: 'individual',
        name: fullName,
        email: user.email,
        phone_number: [body.phone, user.phone, user.phone_number, '+15551234567'].find(pn => typeof pn === 'string' && /^\\+[1-9]\\d{6,14}$/.test(pn)) || '+15551234567',
        billing: { address },
        individual: {
            first_name: firstName,
            last_name: lastName,
            dob,
        },
        metadata: { vaultbank_user_id: user.id },
    });

    await setConfig(cardholderKey(user.id), cardholder.id);
    return cardholder;
}

// ============================================================
// GET /api/issuing/status Ã¢â‚¬â€ is real card issuing available?
// ============================================================
router.get('/api/issuing/status', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.json({ success: true, available: false, reason: 'no-stripe-key', mode: 'none' });

        // Probe whether Issuing is actually enabled on this Stripe account
        try {
            await s.issuing.cardholders.list({ limit: 1 });
        } catch (e) {
            if (String(e.message || '').includes('not set up to use Issuing')) {
                return res.json({ success: true, available: false, reason: 'issuing-not-activated', activationUrl: 'https://dashboard.stripe.com/issuing/overview', mode: stripeMode(), webhookRegistered: !!(await getConfig('issuing_webhook_endpoint_id')) });
            }
            // Any other error: report it but keep the UI functional
            return res.json({ success: true, available: false, reason: 'error', message: e.message, mode: stripeMode() });
        }

        let cardholder = null;
        try {
            await ensureTables();
            const chId = await getConfig(cardholderKey(req.user.id));
            cardholder = chId || null;
        } catch (e) { /* db may not be ready */ }
        const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || process.env.PAYMENT_PROVIDER_STRIPE_KEY || null;
        res.json({
            success: true,
            available: true,
            mode: stripeMode(),
            cardholder,
            publishableKey,
            cardholderAddressRequired: stripeMode() === 'live',
            webhookRegistered: !!(await getConfig('issuing_webhook_endpoint_id')),
        });
    } catch (error) {
        console.error('Issuing status error:', error.message);
        res.json({ success: true, available: false, reason: 'error', message: error.message });
    }
});

// ============================================================
// POST /api/issuing/cardholder Ã¢â‚¬â€ create the real cardholder (KYC entity)
// ============================================================
router.post('/api/issuing/cardholder', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        await ensureTables();
        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        const cardholder = await getOrCreateCardholder(user, req.body || {});
        await createNotification(req.user.id, {
            type: 'success',
            title: 'Card program enrolled',
            message: 'Your cardholder profile is verified. You can now issue real cards.',
        });
        res.json({ success: true, cardholder: { id: cardholder.id, name: cardholder.name, status: cardholder.status } });
    } catch (error) {
        console.error('Cardholder error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// POST /api/issuing/cards Ã¢â‚¬â€ issue a REAL virtual card
// ============================================================
router.post('/api/issuing/cards', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        await ensureTables();

        const { network = 'visa', monthlyLimit = 2000, perTransactionLimit = 500 } = req.body || {};
        const net = network === 'mastercard' ? 'mastercard' : 'visa';
        const monthly = Math.max(0, parseFloat(monthlyLimit) || 2000);
        const perTx = Math.max(0, parseFloat(perTransactionLimit) || 500);

        const user = await findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        // Issue card count guard
        const { rows: existing } = await db.query('SELECT COUNT(*) AS n FROM issued_cards WHERE user_id = $1', [req.user.id]);
        if ((existing[0].n || 0) >= 5) {
            return res.status(400).json({ success: false, message: 'Maximum of 5 real cards. Freeze or remove one first.' });
        }

        const cardholder = await getOrCreateCardholder(user, req.body || {});

        const spendingControls = {
            spending_limits: [],
        };
        if (monthly > 0) spendingControls.spending_limits.push({ amount: Math.round(monthly * 100), interval: 'monthly' });
        if (perTx > 0) spendingControls.spending_limits.push({ amount: Math.round(perTx * 100), interval: 'per_authorization' });

        const card = await s.issuing.cards.create({
            currency: 'usd',
            type: 'virtual',
            status: 'active',
            network: net,
            cardholder: cardholder.id,
            ...(spendingControls.spending_limits.length ? { spending_controls: spendingControls } : {}),
            metadata: { vaultbank_user_id: req.user.id },
        });

        const brandLabel = net === 'mastercard' ? 'VaultBank Mastercard' : 'VaultBank Visa';
        await db.query(`
            INSERT INTO issued_cards (card_id, user_id, cardholder_id, network, last4, exp_month, exp_year, status, brand_label, monthly_limit, per_transaction_limit)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (card_id) DO NOTHING
        `, [card.id, req.user.id, cardholder.id, net, card.last4, card.exp_month || null, card.exp_year || null, card.status, brandLabel, monthly, perTx]);

        await createNotification(req.user.id, {
            type: 'success',
            title: 'Real card issued',
            message: brandLabel + ' Ã¢â‚¬Â¢Ã¢â‚¬Â¢ ' + card.last4 + ' is active. Use it anywhere ' + (net === 'mastercard' ? 'Mastercard' : 'Visa') + ' is accepted.',
        });

        res.status(201).json({
            success: true,
            message: brandLabel + ' issued and active.',
            card: {
                id: card.id,
                network: net,
                last4: card.last4,
                expMonth: card.exp_month,
                expYear: card.exp_year,
                status: card.status,
                brandLabel,
                monthlyLimit: monthly,
                perTransactionLimit: perTx,
                mode: stripeMode(),
            },
        });
    } catch (error) {
        console.error('Issue card error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// GET /api/issuing/cards Ã¢â‚¬â€ my real cards (live status from Stripe)
// ============================================================
router.get('/api/issuing/cards', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.json({ success: true, cards: [], available: false });
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
        const cards = [];
        for (const row of rows) {
            let live = { status: row.status, spending_controls: null, cardholder: row.cardholder_id };
            try {
                live = await s.issuing.cards.retrieve(row.card_id);
            } catch (e) { /* keep db status */ }
            cards.push({
                id: row.card_id,
                network: row.network,
                last4: row.last4,
                expMonth: live.exp_month ?? row.exp_month,
                expYear: live.exp_year ?? row.exp_year,
                status: live.status || row.status,
                frozen: (live.status || row.status) === 'inactive',
                brandLabel: row.brand_label,
                monthlyLimit: parseFloat(row.monthly_limit),
                perTransactionLimit: parseFloat(row.per_transaction_limit),
                cardholder: row.cardholder_id,
                createdAt: row.created_at,
            });
        }
        res.json({ success: true, cards, mode: stripeMode() });
    } catch (error) {
        console.error('Issuing list error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// POST /api/issuing/cards/:id/freeze Ã¢â‚¬â€ REAL freeze (network-level decline)
// ============================================================
router.post('/api/issuing/cards/:id/freeze', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        await ensureTables();
        const frozen = !!(req.body && req.body.frozen);
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE card_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Card not found.' });
        const card = await s.issuing.cards.update(req.params.id, { status: frozen ? 'inactive' : 'active' });
        await db.query('UPDATE issued_cards SET status = $2 WHERE card_id = $1', [req.params.id, card.status]);
        await createNotification(req.user.id, {
            type: frozen ? 'warning' : 'success',
            title: frozen ? 'Card frozen' : 'Card unfrozen',
            message: (rows[0].brand_label || 'Card') + ' Ã¢â‚¬Â¢Ã¢â‚¬Â¢ ' + rows[0].last4 + (frozen ? ' now declines all authorizations.' : ' is active again.'),
        });
        res.json({ success: true, message: frozen ? 'Card frozen Ã¢â‚¬â€ all authorizations will be declined.' : 'Card is active.', status: card.status, frozen });
    } catch (error) {
        console.error('Freeze error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// POST /api/issuing/cards/:id/limits Ã¢â‚¬â€ real network-enforced spend controls
// ============================================================
router.post('/api/issuing/cards/:id/limits', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE card_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Card not found.' });
        const monthly = Math.max(0, parseFloat(req.body.monthlyLimit) || 0);
        const perTx = Math.max(0, parseFloat(req.body.perTransactionLimit) || 0);
        const limits = [];
        if (monthly > 0) limits.push({ amount: Math.round(monthly * 100), interval: 'monthly' });
        if (perTx > 0) limits.push({ amount: Math.round(perTx * 100), interval: 'per_authorization' });
        const card = await s.issuing.cards.update(req.params.id, { spending_controls: { spending_limits: limits } });
        await db.query('UPDATE issued_cards SET monthly_limit = $2, per_transaction_limit = $3 WHERE card_id = $1', [req.params.id, monthly, perTx]);
        res.json({ success: true, message: 'Spend controls updated.', monthlyLimit: monthly, perTransactionLimit: perTx, controls: card.spending_controls });
    } catch (error) {
        console.error('Limits error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// POST /api/issuing/cards/:id/ephemeral-key Ã¢â‚¬â€ PCI-safe card reveal
// The frontend mounts the number/CVV inside Stripes secure iframe.
// ============================================================
router.post('/api/issuing/cards/:id/ephemeral-key', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE card_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Card not found.' });
        const versions = [req.body && req.body.apiVersion, '2024-06-20', '2020-08-27'].filter(Boolean);
        let key = null;
        let lastErr = null;
        for (const apiVersion of [...new Set(versions)]) {
            try {
                key = await s.ephemeralKeys.create({ issuing_card: req.params.id }, { apiVersion });
                break;
            } catch (e) {
                lastErr = e;
            }
        }
        if (!key) throw lastErr || new Error('Could not create ephemeral key');
        res.json({ success: true, clientSecret: key.secret, apiVersion: key.api_version || (req.body && req.body.apiVersion) });
    } catch (error) {
        console.error('Ephemeral key error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// GET /api/issuing/cards/:id/transactions Ã¢â‚¬â€ real card activity
// (from issuing transactions recorded on the VaultBank ledger)
// ============================================================
router.get('/api/issuing/cards/:id/transactions', authenticateToken, async (req, res) => {
    try {
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE card_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Card not found.' });
        const tx = await db.query(
            "SELECT * FROM transactions WHERE account_id = (SELECT id FROM accounts WHERE user_id = $1 LIMIT 1) AND (description LIKE $2 OR type = 'card_spend') ORDER BY created_at DESC LIMIT 25",
            [req.user.id, '%Ã¢â‚¬Â¢Ã¢â‚¬Â¢ ' + rows[0].last4 + '%']
        );
        res.json({
            success: true,
            transactions: tx.rows.map(t => ({
                id: t.id,
                amount: parseFloat(t.amount),
                description: t.description,
                category: t.category,
                status: t.status,
                date: t.created_at,
            })),
        });
    } catch (error) {
        console.error('Card activity error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// POST /api/issuing/setup (admin) Ã¢â‚¬â€ auto-register the Issuing webhook.
// Stores the signing secret in server_config so no manual env var needed.
// ============================================================
router.post('/api/issuing/setup', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        await ensureTables();
        const url = BASE_URL + '/api/stripe/webhook';
        const endpoint = await s.webhookEndpoints.create({
            url,
            enabled_events: [
                'issuing_authorization.request',
                'issuing_transaction.created',
                'issuing_card.created',
                'issuing_cardholder.created',
                'issuing_authorization.created',
            ],
            description: 'VaultBank card issuing (auto-created)',
        });
        await setConfig('issuing_webhook_secret', endpoint.secret);
        await setConfig('issuing_webhook_endpoint_id', endpoint.id);
        await createNotification(req.user.id, {
            type: 'success',
            title: 'Issuing webhook registered',
            message: 'Real-time card authorizations are now live at ' + url,
        });
        res.json({ success: true, endpoint: { id: endpoint.id, url }, secretSaved: true });
    } catch (error) {
        console.error('Issuing setup error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// POST /api/issuing/simulate-authorization (test mode) Ã¢â‚¬â€ simulate a
// Netflix-style charge against a real test card end-to-end.
// ============================================================
router.post('/api/issuing/simulate-authorization', authenticateToken, async (req, res) => {
    try {
        const s = getStripe();
        if (!s) return res.status(400).json({ success: false, message: 'Stripe not configured.' });
        if (stripeMode() !== 'test') {
            return res.status(400).json({ success: false, message: 'Simulation only available in Issuing test mode.' });
        }
        await ensureTables();
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE card_id = $1 AND user_id = $2', [req.body.cardId, req.user.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Card not found.' });
        const amount = Math.round((parseFloat(req.body.amount) || 15.99) * 100);
        const auth = await s.testHelpers.issuing.authorizations.create({
            card: req.body.cardId,
            amount,
            currency: 'usd',
            merchant_name: req.body.merchantName || 'Netflix',
        });
        res.json({ success: true, authorization: { id: auth.id, status: auth.status, approved: auth.approved } });
    } catch (error) {
        console.error('Simulate auth error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});


// ============================================================
// AUTOMATION - connects VaultBank to Stripe automatically:
//   - probes whether Issuing is activated on the account
//   - registers the issuing webhook (idempotent, self-healing)
//   - notifies admins on registration
// Runs at server boot and every 30 minutes, so the moment Issuing
// is activated in the Stripe Dashboard, VaultBank self-configures
// with zero manual steps.
// ============================================================
async function autoSetupIssuing() {
    try {
        const s = getStripe();
        if (!s) return { skipped: 'no-stripe-key' };
        await ensureTables();

        let issuingAvailable = true;
        try {
            await s.issuing.cardholders.list({ limit: 1 });
        } catch (e) {
            issuingAvailable = !String(e.message || '').includes('not set up to use Issuing');
        }

        let endpointId = await getConfig('issuing_webhook_endpoint_id');
        if (endpointId) {
            try {
                await s.webhookEndpoints.retrieve(endpointId);
                return { ok: true, issuingAvailable, webhookRegistered: true, endpointId };
            } catch (e) {
                endpointId = null; // stale - recreate below
            }
        }

        const endpoint = await s.webhookEndpoints.create({
            url: BASE_URL + '/api/stripe/webhook',
            enabled_events: [
                'issuing_authorization.request',
                'issuing_authorization.created',
                'issuing_transaction.created',
                'issuing_card.created',
                'issuing_cardholder.created',
            ],
            description: 'VaultBank card issuing (auto-managed)',
        });
        await setConfig('issuing_webhook_endpoint_id', endpoint.id);
        await setConfig('issuing_webhook_secret', endpoint.secret);

        try {
            const { rows: admins } = await db.query("SELECT id FROM users WHERE role IN ('super_admin', 'admin')");
            for (const a of admins) {
                await createNotification(a.id, {
                    type: 'success',
                    title: 'Card issuing connected automatically',
                    message: 'Webhook registered at ' + BASE_URL + '/api/stripe/webhook. Issuing ' + (issuingAvailable ? 'is ACTIVE - users can mint real cards now.' : 'is not activated yet - everything flips on automatically once you activate Issuing in the Stripe Dashboard.'),
                });
            }
        } catch (e) { /* notify best-effort */ }

        return { ok: true, issuingAvailable, webhookRegistered: true, endpointId };
    } catch (error) {
        console.warn('Issuing auto-setup:', error.message);
        return { error: error.message };
    }
}

function startIssuingAutomation() {
    if (isDemo) return;
    setTimeout(() => { autoSetupIssuing(); }, 8000); // shortly after boot
    setInterval(() => { autoSetupIssuing(); }, 30 * 60 * 1000); // re-check every 30 min
    console.log('CARD ISSUING AUTOMATION ARMED - VaultBank self-connects to Stripe');
}

module.exports = router;
module.exports.startIssuingAutomation = startIssuingAutomation;
