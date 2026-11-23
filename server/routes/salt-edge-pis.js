'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const db = require('../config/db');
const { findAccountByUserIdAndCurrency } = require('../config/database');
const bankDeposits = require('./bank-deposits');
const { isCurrencyEnabled, knownCurrencies } = require('../config/currencies');
const saltEdge = require('../services/saltEdgePartnerPIS');

const AMOUNT_LIMIT = 1000000;
const REF_TTL_HOURS = 48;

function responseError(res, error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('[salt-edge-pis]', error.code || 'ERROR', error.message);
    return res.status(status).json({
        success: false,
        code: error.code || 'SALT_EDGE_PIS_ERROR',
        message: status >= 500 ? 'The bank payment service is not ready. No VaultBank balance was changed.' : error.message,
    });
}

function requireLive(_req, res, next) {
    const readiness = saltEdge.readiness();
    if (!readiness.available) {
        return res.status(503).json({
            success: false,
            code: 'SALT_EDGE_PIS_NOT_READY',
            message: 'Live bank payments are not enabled for this VaultBank backend.',
            availability: readiness,
        });
    }
    return next();
}

function requireVerifiedCustomerOrAdmin(req, res, next) {
    if (req.user && ['admin', 'super_admin'].includes(String(req.user.role || '').toLowerCase())) return next();
    if (!req.user || req.user.email_verified !== true || req.user.kyc_status !== 'verified') {
        return res.status(403).json({
            success: false,
            code: 'CUSTOMER_VERIFICATION_REQUIRED',
            message: 'Verified email and identity status are required before starting a real bank payment.',
        });
    }
    return next();
}

async function ensureTables() {
    if (db.isDemo) {
        const error = new Error('Salt Edge Payment Initiation requires the production PostgreSQL ledger.');
        error.code = 'REAL_DATABASE_REQUIRED';
        error.status = 503;
        throw error;
    }
    await db.ensureConnection();
    await bankDeposits.ensureTables();
    await db.query("CREATE TABLE IF NOT EXISTS salt_edge_pis_customers (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, customer_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await db.query("CREATE TABLE IF NOT EXISTS salt_edge_pis_sessions (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), deposit_instruction_id UUID NOT NULL UNIQUE REFERENCES bank_deposit_instructions(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, reference TEXT NOT NULL UNIQUE, amount NUMERIC(15,2) NOT NULL CHECK (amount > 0), currency TEXT NOT NULL, provider_code TEXT NOT NULL, template_identifier TEXT NOT NULL, payment_id TEXT UNIQUE, provider_status TEXT, status TEXT NOT NULL DEFAULT 'initiating', session_expires_at TIMESTAMPTZ, last_callback_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await db.query("CREATE INDEX IF NOT EXISTS salt_edge_pis_user_created_idx ON salt_edge_pis_sessions (user_id, created_at DESC)");
    await db.query("CREATE INDEX IF NOT EXISTS salt_edge_pis_status_created_idx ON salt_edge_pis_sessions (status, created_at DESC)");
}

function safeProvider(provider) {
    const code = String(provider && provider.code || '');
    const country = String(provider && provider.country_code || '').toUpperCase();
    return Boolean(provider)
        && provider.status === 'active'
        && provider.regulated === true
        && /^[a-z0-9_-]{2,100}$/i.test(code)
        && country !== 'XF'
        && !/fake|sandbox|mock/i.test(code + ' ' + String(provider.name || ''))
        && Array.isArray(provider.payment_templates)
        && provider.payment_templates.length > 0;
}

function clientIpV4(req) {
    let ip = String(req.ip || '').trim();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip : null;
}

function statusFromProvider(value) {
    const status = String(value || 'unknown').toLowerCase();
    if (status === 'accepted') return 'accepted_waiting_settlement';
    if (['failed', 'rejected', 'deleted'].includes(status)) return 'failed';
    if (status === 'processing') return 'processing';
    if (status === 'unknown') return 'unknown';
    return 'provider_' + status.replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

async function getOrCreateLead(user) {
    const existing = await db.query('SELECT customer_id FROM salt_edge_pis_customers WHERE user_id = $1 LIMIT 1', [user.id]);
    if (existing.rows[0]) return existing.rows[0].customer_id;
    const lead = await saltEdge.request('POST', 'leads', { data: { email: user.email } });
    const customerId = String(lead && lead.data && lead.data.customer_id || '').trim();
    if (!customerId) {
        const error = new Error('Salt Edge did not return a customer ID for the verified user.');
        error.code = 'SALT_EDGE_LEAD_INVALID';
        error.status = 502;
        throw error;
    }
    await db.query(
        'INSERT INTO salt_edge_pis_customers (user_id, customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
        [user.id, customerId, user.email]
    );
    const saved = await db.query('SELECT customer_id FROM salt_edge_pis_customers WHERE user_id = $1 LIMIT 1', [user.id]);
    if (!saved.rows[0]) {
        const error = new Error('Salt Edge customer mapping could not be saved.');
        error.code = 'SALT_EDGE_LEAD_PERSIST_FAILED';
        error.status = 503;
        throw error;
    }
    return saved.rows[0].customer_id;
}

function buildPaymentAttributes({ currency, amount, reference, req, cfg }) {
    const ip = clientIpV4(req);
    if (!ip) {
        const error = new Error('This bank payment template requires an IPv4 client address. The request was not sent.');
        error.code = 'SALT_EDGE_IPV4_REQUIRED';
        error.status = 422;
        throw error;
    }
    const attributes = {
        ...cfg.extraFields,
        end_to_end_id: reference,
        customer_last_logged_at: new Date().toISOString(),
        customer_ip_address: ip,
        creditor_name: cfg.creditorName,
        creditor_country_code: cfg.creditorCountryCode,
        currency_code: currency,
        amount,
        description: 'VaultBank deposit ' + reference,
        mode: 'normal',
    };
    if (cfg.creditorIban) attributes.creditor_iban = cfg.creditorIban;
    return attributes;
}

async function loadProviderAndTemplate(providerCode, templateIdentifier) {
    if (!/^[a-z0-9_-]{2,100}$/i.test(providerCode) || !/^[A-Z0-9_-]{1,40}$/i.test(templateIdentifier)) {
        const error = new Error('Choose a valid active bank provider and payment template.');
        error.code = 'SALT_EDGE_PROVIDER_INVALID';
        error.status = 400;
        throw error;
    }
    const providerResponse = await saltEdge.request('GET', 'providers');
    const providers = Array.isArray(providerResponse.data) ? providerResponse.data : [];
    const provider = providers.find(item => item.code === providerCode);
    if (!safeProvider(provider) || !provider.payment_templates.includes(templateIdentifier)) {
        const error = new Error('That real bank provider or payment template is not currently active for payment initiation.');
        error.code = 'SALT_EDGE_PROVIDER_NOT_AVAILABLE';
        error.status = 422;
        throw error;
    }
    const templateResponse = await saltEdge.request('GET', 'templates/' + encodeURIComponent(templateIdentifier));
    const template = templateResponse && templateResponse.data;
    const fields = template && Array.isArray(template.payment_fields) ? template.payment_fields : [];
    if (!fields.length) {
        const error = new Error('Salt Edge did not return the payment fields for this bank template.');
        error.code = 'SALT_EDGE_TEMPLATE_INVALID';
        error.status = 502;
        throw error;
    }
    return { provider, template, fields };
}

router.get('/api/salt-edge/pis/readiness', (_req, res) => {
    const readiness = saltEdge.readiness();
    const currencies = readiness.available ? knownCurrencies().filter(currency => {
        if (!isCurrencyEnabled(currency)) return false;
        const cfg = saltEdge.currencyConfig(currency);
        const destinationFields = cfg ? Object.keys(cfg.extraFields).filter(name => name.startsWith('creditor_') && !['creditor_name', 'creditor_country_code', 'creditor_address', 'creditor_street_name', 'creditor_building_number', 'creditor_post_code', 'creditor_town', 'creditor_region'].includes(name)) : [];
        return Boolean(cfg && (cfg.creditorIban || destinationFields.length) && cfg.creditorName && /^[A-Z]{2}$/.test(cfg.creditorCountryCode) && cfg.templateIdentifier);
    }) : [];
    return res.status(200).json({ success: true, ...readiness, currencies });
});

router.get('/api/salt-edge/pis/providers', authenticateToken, requireVerifiedCustomerOrAdmin, requireLive, async (_req, res) => {
    try {
        const currency = String(_req.query.currency || '').trim().toUpperCase();
        const cfg = saltEdge.currencyConfig(currency);
        if (!cfg || !isCurrencyEnabled(currency) || !cfg.templateIdentifier) {
            return res.status(400).json({ success: false, code: 'SALT_EDGE_CURRENCY_NOT_CONFIGURED', message: 'Choose a currency with a configured live receiving account and payment template.' });
        }
        const result = await saltEdge.request('GET', 'providers');
        const providers = (Array.isArray(result.data) ? result.data : [])
            .filter(provider => safeProvider(provider) && provider.payment_templates.includes(cfg.templateIdentifier))
            .map(provider => ({
                code: provider.code,
                name: provider.name,
                countryCode: provider.country_code,
                paymentTemplates: provider.payment_templates,
                logoUrl: provider.logo_url || null,
            }));
        return res.status(200).json({ success: true, providers });
    } catch (error) {
        return responseError(res, error);
    }
});

router.get('/api/salt-edge/pis/templates/:identifier', authenticateToken, requireVerifiedCustomerOrAdmin, requireLive, async (req, res) => {
    try {
        const identifier = String(req.params.identifier || '');
        if (!/^[A-Z0-9_-]{1,40}$/i.test(identifier)) {
            return res.status(400).json({ success: false, code: 'SALT_EDGE_TEMPLATE_INVALID', message: 'Invalid payment template.' });
        }
        const result = await saltEdge.request('GET', 'templates/' + encodeURIComponent(identifier));
        const fields = Array.isArray(result.data && result.data.payment_fields) ? result.data.payment_fields : [];
        return res.status(200).json({
            success: true,
            template: {
                identifier: result.data && result.data.identifier,
                description: result.data && result.data.description,
                requiredFields: fields.filter(field => field.optional !== true).map(field => field.name),
                optionalFields: fields.filter(field => field.optional === true).map(field => field.name),
            },
        });
    } catch (error) {
        return responseError(res, error);
    }
});

router.post('/api/salt-edge/pis/deposits', authenticateToken, requireVerifiedCustomerOrAdmin, requireLive, async (req, res) => {
    try {
        await ensureTables();
        const currency = String(req.body && req.body.currency || '').trim().toUpperCase();
        const amount = saltEdge.amountString(req.body && req.body.amount);
        const providerCode = String(req.body && req.body.providerCode || '').trim();
        const cfg = saltEdge.currencyConfig(currency);
        if (!amount || Number(amount) > AMOUNT_LIMIT) {
            return res.status(400).json({ success: false, code: 'SALT_EDGE_AMOUNT_INVALID', message: 'Enter a valid positive amount within the current payment limit.' });
        }
        const destinationFieldNames = cfg ? Object.keys(cfg.extraFields).filter(name =>
            name.startsWith('creditor_')
            && !['creditor_name', 'creditor_country_code', 'creditor_address', 'creditor_street_name', 'creditor_building_number', 'creditor_post_code', 'creditor_town', 'creditor_region'].includes(name)
        ) : [];
        if (!isCurrencyEnabled(currency) || !cfg || (!cfg.creditorIban && destinationFieldNames.length === 0) || !cfg.creditorName || !/^[A-Z]{2}$/.test(cfg.creditorCountryCode) || !cfg.templateIdentifier) {
            return res.status(503).json({
                success: false,
                code: 'SALT_EDGE_RECEIVING_ACCOUNT_NOT_CONFIGURED',
                message: 'A real receiving bank account, creditor name, country and provider payment template must be configured for this currency before deposits can start.',
            });
        }
        const account = await findAccountByUserIdAndCurrency(req.user.id, currency);
        if (!account || String(account.currency).toUpperCase() !== currency) {
            return res.status(400).json({ success: false, code: 'VAULTBANK_CURRENCY_ACCOUNT_NOT_FOUND', message: 'You do not have an active VaultBank account for this currency.' });
        }

        const { provider, fields } = await loadProviderAndTemplate(providerCode, cfg.templateIdentifier);
        const customerId = await getOrCreateLead(req.user);
        const reference = 'VB' + crypto.randomBytes(9).toString('hex').toUpperCase();
        const candidateAttributes = buildPaymentAttributes({ currency, amount, reference, req, cfg });
        // Send only fields advertised by this template. Bank-specific required
        // values are supplied from Render configuration, never from the browser.
        const allowedFields = new Set(fields.map(field => field.name));
        const attributes = Object.fromEntries(
            Object.entries(candidateAttributes).filter(([name]) => allowedFields.has(name))
        );
        const missingFields = fields.filter(field => field.optional !== true && (
            attributes[field.name] === undefined
            || attributes[field.name] === null
            || String(attributes[field.name]).trim() === ''
        )).map(field => field.name);
        if (missingFields.length) {
            return res.status(422).json({
                success: false,
                code: 'SALT_EDGE_PAYMENT_FIELDS_MISSING',
                message: 'The receiving-account configuration is missing required fields for this provider.',
                missingFields,
            });
        }

        const expiresAt = new Date(Date.now() + REF_TTL_HOURS * 60 * 60 * 1000);
        const instructionResult = await db.query(
            "INSERT INTO bank_deposit_instructions (user_id, account_id, reference, amount, currency, status, expires_at) VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING id, reference, amount, currency, status, expires_at",
            [req.user.id, account.id, reference, amount, currency, expiresAt]
        );
        const instruction = instructionResult.rows[0];
        const sessionResult = await db.query(
            "INSERT INTO salt_edge_pis_sessions (deposit_instruction_id, user_id, reference, amount, currency, provider_code, template_identifier, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'initiating') RETURNING id",
            [instruction.id, req.user.id, reference, amount, currency, provider.code, cfg.templateIdentifier]
        );
        const localSessionId = sessionResult.rows[0].id;

        try {
            const session = await saltEdge.request('POST', 'payments/sessions', {
                data: {
                    customer_id: customerId,
                    provider_code: provider.code,
                    show_consent_confirmation: true,
                    template_identifier: cfg.templateIdentifier,
                    return_to: saltEdge.getConfig().returnUrl,
                    payment_attributes: attributes,
                    custom_fields: {
                        vaultbank_session_id: String(localSessionId),
                        vaultbank_deposit_reference: reference,
                    },
                },
            });
            const connectUrl = String(session && session.data && session.data.connect_url || '');
            let parsedConnectUrl;
            try { parsedConnectUrl = new URL(connectUrl); } catch (_) {}
            if (!parsedConnectUrl || parsedConnectUrl.protocol !== 'https:' || parsedConnectUrl.hostname !== 'www.saltedge.com') {
                throw saltEdge.makeError('SALT_EDGE_CONNECT_URL_INVALID', 'Salt Edge returned an unexpected payment authorization URL.', 502);
            }
            await db.query(
                "UPDATE salt_edge_pis_sessions SET status = 'awaiting_authorization', session_expires_at = $2, updated_at = NOW() WHERE id = $1",
                [localSessionId, session.data.expires_at || null]
            );
            return res.status(201).json({
                success: true,
                provider: 'salt-edge-partner-pis',
                realBankPayment: true,
                walletCredited: false,
                status: 'awaiting_authorization',
                reference,
                amount,
                currency,
                connectUrl,
                expiresAt: session.data.expires_at || null,
                settlement: 'A payment is not spendable until the receiving bank confirms settlement and VaultBank completes its bank-statement reconciliation.',
            });
        } catch (providerError) {
            await db.query("UPDATE salt_edge_pis_sessions SET status = 'session_creation_failed', updated_at = NOW() WHERE id = $1", [localSessionId]);
            await db.query("UPDATE bank_deposit_instructions SET status = 'failed' WHERE id = $1 AND status = 'pending'", [instruction.id]);
            throw providerError;
        }
    } catch (error) {
        return responseError(res, error);
    }
});

router.get('/api/salt-edge/pis/deposits', authenticateToken, requireLive, async (req, res) => {
    try {
        await ensureTables();
        const isAdmin = ['admin', 'super_admin'].includes(String(req.user.role || '').toLowerCase());
        const result = await db.query(
            "SELECT s.id, s.reference, s.amount, s.currency, s.provider_code, s.template_identifier, s.payment_id, s.provider_status, s.status, s.session_expires_at, s.created_at, i.status AS deposit_status, i.credited_at FROM salt_edge_pis_sessions s JOIN bank_deposit_instructions i ON i.id = s.deposit_instruction_id WHERE ($1::boolean = true OR s.user_id = $2) ORDER BY s.created_at DESC LIMIT 100",
            [isAdmin, req.user.id]
        );
        return res.status(200).json({
            success: true,
            deposits: result.rows.map(row => ({
                id: row.id,
                reference: row.reference,
                amount: String(row.amount),
                currency: row.currency,
                providerCode: row.provider_code,
                paymentTemplate: row.template_identifier,
                paymentId: row.payment_id,
                providerStatus: row.provider_status,
                status: row.status,
                depositStatus: row.deposit_status,
                walletCredited: Boolean(row.credited_at),
                sessionExpiresAt: row.session_expires_at,
                createdAt: row.created_at,
            })),
        });
    } catch (error) {
        return responseError(res, error);
    }
});

router.get('/api/salt-edge/pis/admin/reconciliation', authenticateToken, requireAdmin, requireLive, async (_req, res) => {
    try {
        await ensureTables();
        const result = await db.query(
            "SELECT s.id, s.deposit_instruction_id, s.user_id, s.reference, s.amount, s.currency, s.provider_code, s.template_identifier, s.payment_id, s.provider_status, s.status, s.created_at, i.status AS deposit_status, u.email, u.full_name FROM salt_edge_pis_sessions s JOIN bank_deposit_instructions i ON i.id = s.deposit_instruction_id JOIN users u ON u.id = s.user_id WHERE i.status IN ('pending','settling') ORDER BY s.created_at DESC LIMIT 200"
        );
        return res.status(200).json({
            success: true,
            instructions: result.rows.map(row => ({
                id: row.deposit_instruction_id,
                sessionId: row.id,
                userId: row.user_id,
                customerEmail: row.email,
                customerName: row.full_name,
                reference: row.reference,
                amount: String(row.amount),
                currency: row.currency,
                providerCode: row.provider_code,
                paymentId: row.payment_id,
                providerStatus: row.provider_status,
                paymentStatus: row.status,
                depositStatus: row.deposit_status,
                settlementEndpoint: '/api/bank-deposits/admin/instructions/' + row.deposit_instruction_id + '/verify',
            })),
        });
    } catch (error) {
        return responseError(res, error);
    }
});

async function handleCallback(kind, req, res) {
    const url = saltEdge.callbackUrl(kind);
    if (!saltEdge.verifyCallback(req.rawBody, req.headers.signature, req.headers['signature-key-version'], url)) {
        return res.status(401).json({ success: false, message: 'Invalid Salt Edge callback signature.' });
    }
    try {
        await ensureTables();
        const callbackData = req.body && req.body.data;
        const paymentId = String(callbackData && callbackData.payment_id || '').trim();
        if (!paymentId) return res.status(400).json({ success: false, message: 'Payment ID is missing.' });

        // Never trust callback status as proof of payment. Fetch canonical data
        // from Salt Edge and match it to the original VaultBank payment request.
        const canonical = await saltEdge.request('GET', 'payments/' + encodeURIComponent(paymentId));
        const payment = canonical && canonical.data;
        if (!payment || String(payment.id) !== paymentId) {
            return res.status(502).json({ success: false, message: 'Salt Edge payment could not be verified.' });
        }
        const attributes = payment.payment_attributes || {};
        const custom = payment.custom_fields || callbackData.custom_fields || {};
        const reference = String(custom.vaultbank_deposit_reference || attributes.end_to_end_id || '').trim();
        if (!reference) return res.status(202).json({ success: true, ignored: true });

        const found = await db.query('SELECT s.*, c.customer_id AS salt_edge_customer_id FROM salt_edge_pis_sessions s JOIN salt_edge_pis_customers c ON c.user_id = s.user_id WHERE s.reference = $1 LIMIT 1', [reference]);
        const local = found.rows[0];
        if (!local) return res.status(202).json({ success: true, ignored: true });

        const receivedAmount = saltEdge.amountString(attributes.amount);
        const receivedCurrency = String(attributes.currency_code || '').toUpperCase();
        const target = saltEdge.currencyConfig(local.currency);
        const receivedIban = String(attributes.creditor_iban || '').replace(/\s+/g, '').toUpperCase();
        const configuredDestinationMatches = Boolean(target) && Object.entries(target.extraFields).every(([name, expected]) => {
            if (!name.startsWith('creditor_')) return true;
            const actual = attributes[name];
            return actual != null && String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase();
        });
        if (
            !receivedAmount
            || receivedAmount !== saltEdge.amountString(local.amount)
            || receivedCurrency !== local.currency
            || !target
            || String(attributes.end_to_end_id || '') !== local.reference
            || String(callbackData.customer_id || '') !== String(local.salt_edge_customer_id)
            || String(payment.customer_id || '') !== String(local.salt_edge_customer_id)
            || String(payment.template_identifier || '') !== local.template_identifier
            || String(payment.provider_code || '') !== local.provider_code
            || (target.creditorIban && receivedIban !== target.creditorIban)
            || String(attributes.creditor_name || '').trim().toLowerCase() !== target.creditorName.trim().toLowerCase()
            || !configuredDestinationMatches
        ) {
            await db.query(
                "UPDATE salt_edge_pis_sessions SET payment_id = $2, provider_status = $3, status = 'reconciliation_required', last_callback_at = NOW(), updated_at = NOW() WHERE id = $1",
                [local.id, paymentId, String(payment.status || 'unknown')]
            );
            return res.status(202).json({ success: true, reconciliationRequired: true });
        }

        const nextStatus = statusFromProvider(payment.status);
        await db.query(
            'UPDATE salt_edge_pis_sessions SET payment_id = $2, provider_status = $3, status = $4, last_callback_at = NOW(), updated_at = NOW() WHERE id = $1',
            [local.id, paymentId, String(payment.status || 'unknown'), nextStatus]
        );
        if (['failed', 'rejected', 'deleted'].includes(String(payment.status || '').toLowerCase())) {
            await db.query("UPDATE bank_deposit_instructions SET status = 'failed' WHERE id = $1 AND status = 'pending'", [local.deposit_instruction_id]);
        }
        return res.status(200).json({ success: true, received: true });
    } catch (error) {
        console.error('[salt-edge-pis] callback processing failed:', error.code || error.message);
        return res.status(500).json({ success: false, message: 'Salt Edge callback could not be processed.' });
    }
}

for (const kind of ['success', 'fail', 'notify']) {
    router.post('/api/salt-edge/pis/callbacks/' + kind, (req, res) => handleCallback(kind, req, res));
}

module.exports = router;
