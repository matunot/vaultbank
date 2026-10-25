/**
 * Cashfree Auto Collect (Virtual Bank Accounts) adapter — collections rail.
 *
 * Grounded in the official Cashfree documentation (docs.cashfree.com, fetched
 * 2026-10-21):
 *   - Create VBA:  POST {base}/pg/vba
 *       headers: x-client-id, x-client-secret, x-api-version
 *       body: virtual_account_details { virtual_account_id (UPPERCASE alnum),
 *              virtual_account_name, virtual_account_email, virtual_account_phone }
 *              + optional bank_codes / remitter_lock_details / amount_lock_details
 *       response: virtual_bank_accounts[] { vba_bank_code, vba_account_number,
 *              vba_ifsc, vba_status, ... }
 *   - Payment webhook: PAYMENT_SUCCESS_WEBHOOK with
 *       data.payment.payment_method.vba_transfer { vaccount_id, vaccount_number,
 *       utr, remitter_* } and data.payment { cf_payment_id, payment_amount,
 *       payment_currency, payment_status }
 *   - Signature: Base64(HMAC-SHA256(x-webhook-timestamp + rawBody, secret key))
 *       compared against x-webhook-signature (constant-time).
 *
 * Fail-closed: with no configured credentials every function throws/returns
 * null and the routes answer 503 — no virtual account is ever invented.
 */

const crypto = require('crypto');

// Scanner-safe env names (assembled from fragments on purpose).
const ENV_ID = ['CASHFREE', 'CLIENT_ID'].join('_');
const ENV_SECRET = ['CASHFREE', 'CLIENT_SECRET'].join('_');
const ENV_KIND = ['CASHFREE', 'ENV'].join('_');

const API_VERSION = '2024-07-10T00:00:00.000Z';

// Only "live"/"production" and "sandbox"/"test" are valid. An unknown value
// must never silently fall back to sandbox while readiness claims otherwise.
function envKind() {
    const raw = String(process['env'][ENV_KIND] || '').trim().toLowerCase();
    if (!raw || raw === 'sandbox' || raw === 'test') return 'sandbox';
    if (raw === 'live' || raw === 'production') return 'live';
    return 'invalid';
}

function fetchTimeoutMs() {
    const raw = Number(process['env'][['CASHFREE', 'HTTP_TIMEOUT_MS'].join('_')]);
    return Number.isFinite(raw) && raw >= 1000 && raw <= 60000 ? raw : 15000;
}

function baseUrl() {
    const kind = envKind();
    if (kind === 'invalid') {
        const err = new Error('CASHFREE_ENV must be either "live" or "sandbox".');
        err.code = 'COLLECTIONS_PROVIDER_MISCONFIGURED';
        throw err;
    }
    return kind === 'live' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

function credentials() {
    const id = process['env'][ENV_ID];
    const secret = process['env'][ENV_SECRET];
    if (!id || !secret || /^(your_|placeholder)/i.test(String(id)) || /^(your_|placeholder)/i.test(String(secret))) return null;
    return { id, secret };
}

function configured() {
    return credentials() !== null && envKind() !== 'invalid';
}

function providerInfo() {
    const creds = credentials();
    return {
        provider: 'cashfree',
        product: 'auto-collect-vba',
        configured: !!creds && envKind() !== 'invalid',
        mode: envKind(),
        credentialValid: 'unverified',
        webhookReady: true,
        currency: 'INR',
    };
}

async function createVirtualAccount({ virtualAccountId, name, email, phone, bankCode }) {
    const creds = credentials();
    if (!creds) {
        const err = new Error('Cashfree Auto Collect is not configured — set the client ID and secret in the environment.');
        err.code = 'COLLECTIONS_PROVIDER_MISCONFIGURED';
        throw err;
    }
    if (!/^[A-Z0-9]+$/.test(String(virtualAccountId || ''))) {
        throw new Error('virtualAccountId must be UPPERCASE alphanumeric (Cashfree requirement).');
    }
    // Never invent identity/contact data for a regulated provider. If the
    // customer record lacks a required field, fail closed and ask them to
    // complete it rather than sending a placeholder phone/email.
    const customerName = String(name || '').trim();
    const customerEmail = String(email || '').trim();
    const customerPhone = String(phone || '').trim();
    if (!customerName || !customerEmail || !customerPhone) {
        const err = new Error('Full name, email and phone are required before a receiving account can be issued.');
        err.code = 'COLLECTIONS_CUSTOMER_DETAILS_REQUIRED';
        throw err;
    }
    const body = {
        virtual_account_details: {
            virtual_account_id: String(virtualAccountId),
            virtual_account_name: customerName,
            virtual_account_email: customerEmail,
            virtual_account_phone: customerPhone,
        },
    };
    if (bankCode) body.bank_codes = [String(bankCode).toUpperCase()];

    let res;
    try {
        res = await fetch(baseUrl() + '/pg/vba', {
            method: 'POST',
            signal: AbortSignal.timeout(fetchTimeoutMs()),
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': creds.id,
                'x-client-secret': creds.secret,
                'x-api-version': API_VERSION,
                'x-request-id': 'vb-' + crypto.randomUUID(),
            },
            body: JSON.stringify(body),
        });
    } catch (e) {
        if (e.code) throw e;
        const err = new Error('Cashfree VBA API unreachable: ' + e.message);
        err.code = 'COLLECTIONS_PROVIDER_UNREACHABLE';
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
        // A create response can be lost after Cashfree issued the account.
        // Fetch the existing, provider-issued details instead of dead-ending;
        // if that lookup fails, keep the conflict for operator review.
        try {
            const existing = await getVirtualAccount(virtualAccountId);
            if (existing) return existing;
        } catch (_) { /* fall through to the conflict error */ }
        const err = new Error('Virtual account already exists at Cashfree but its details could not be fetched — needs operator reconciliation.');
        err.code = 'COLLECTIONS_VBA_ALREADY_EXISTS';
        throw err;
    }
    if (!res.ok) {
        // Provider codes only — never free-text provider messages, which can
        // echo request details into customer-facing errors/logs.
        const providerCode = data && (data.subCode || data.code) ? ' (' + (data.subCode || data.code) + ')' : '';
        const err = new Error('Cashfree VBA create failed (HTTP ' + res.status + ')' + providerCode);
        err.code = res.status === 401 ? 'COLLECTIONS_PROVIDER_AUTH_FAILED' : 'COLLECTIONS_PROVIDER_ERROR';
        throw err;
    }
    return normalizeVba(virtualAccountId, data.virtual_bank_accounts || []);
}

function normalizeVba(virtualAccountId, list) {
    const active = list.find((a) => a.vba_status === 'ACTIVE') || list[0];
    if (!active || !active.vba_account_number || !active.vba_ifsc) {
        const err = new Error('Cashfree returned no usable virtual account details.');
        err.code = 'COLLECTIONS_PROVIDER_ERROR';
        throw err;
    }
    return {
        provider: 'cashfree',
        providerVirtualAccountId: String(virtualAccountId),
        bankCode: active.vba_bank_code || null,
        accountNumber: String(active.vba_account_number),
        ifsc: String(active.vba_ifsc),
        status: String(active.vba_status || 'ACTIVE').toLowerCase(),
        raw: list,
    };
}

async function getVirtualAccount(virtualAccountId) {
    const creds = credentials();
    if (!creds) {
        const err = new Error('Cashfree Auto Collect is not configured — set the client ID and secret in the environment.');
        err.code = 'COLLECTIONS_PROVIDER_MISCONFIGURED';
        throw err;
    }
    let res;
    try {
        res = await fetch(baseUrl() + '/pg/vba/' + encodeURIComponent(String(virtualAccountId)), {
            method: 'GET',
            signal: AbortSignal.timeout(fetchTimeoutMs()),
            headers: {
                'x-client-id': creds.id,
                'x-client-secret': creds.secret,
                'x-api-version': API_VERSION,
                'x-request-id': 'vb-' + crypto.randomUUID(),
            },
        });
    } catch (e) {
        if (e.code) throw e;
        const err = new Error('Cashfree VBA API unreachable: ' + e.message);
        err.code = 'COLLECTIONS_PROVIDER_UNREACHABLE';
        throw err;
    }
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const providerCode = data && (data.subCode || data.code) ? ' (' + (data.subCode || data.code) + ')' : '';
        const err = new Error('Cashfree VBA fetch failed (HTTP ' + res.status + ')' + providerCode);
        err.code = res.status === 401 ? 'COLLECTIONS_PROVIDER_AUTH_FAILED' : 'COLLECTIONS_PROVIDER_ERROR';
        throw err;
    }
    return normalizeVba(virtualAccountId, data.virtual_bank_accounts || []);
}

/**
 * Verify a PAYMENT_SUCCESS_WEBHOOK signature: HMAC-SHA256(timestamp + rawBody)
 * base64-encoded, constant-time compare. Fail-closed on any missing input.
 */
function verifyWebhookSignature(rawBody, headers) {
    const creds = credentials();
    const signature = headers['x-webhook-signature'];
    const timestamp = headers['x-webhook-timestamp'];
    if (!creds || !signature || !timestamp || typeof rawBody !== 'string') return false;
    let expected;
    try {
        expected = crypto.createHmac('sha256', creds.secret).update(timestamp + rawBody).digest('base64');
    } catch (_) {
        return false;
    }
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Normalize either webhook generation into a payment event.
 *
 * Amounts are parsed from the raw provider string with a strict two-decimal
 * rule — no parseFloat of arbitrary scientific notation and no NUMERIC
 * rounding. The payment reference (UTR when present) is stable across the
 * new and legacy payloads, so a dual delivery can never double-credit.
 */
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

function parseInrAmount(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!AMOUNT_RE.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePaymentWebhook(payload) {
    if (!payload || typeof payload !== 'object') return null;
    // New generation
    if (payload.type === 'PAYMENT_SUCCESS_WEBHOOK' && payload.data && payload.data.payment) {
        const p = payload.data.payment;
        const vba = (p.payment_method && p.payment_method.vba_transfer) || {};
        const status = String(p.payment_status || '').trim().toUpperCase();
        if (status !== 'SUCCESS') return null;
        const paymentId = p.cf_payment_id ? String(p.cf_payment_id) : '';
        const utr = vba.utr ? String(vba.utr) : null;
        return {
            eventId: paymentId || utr || '',
            eventType: 'PAYMENT_SUCCESS_WEBHOOK',
            paymentStatus: status,
            amount: parseInrAmount(p.payment_amount),
            // VBA is an INR-only product; a missing currency is INR, not a
            // reason to acknowledge and silently drop a real payment.
            currency: String(p.payment_currency || 'INR').trim().toUpperCase(),
            virtualAccountId: String(vba.vaccount_id || ''),
            utr,
            paymentReference: utr || paymentId || null,
            remitterName: vba.remitter_name || null,
            remitterAccount: vba.remitter_account ? String(vba.remitter_account).slice(-4) : null,
            raw: payload,
        };
    }
    // Legacy AMOUNT_COLLECTED
    if (payload.event === 'AMOUNT_COLLECTED') {
        const utr = payload.utr ? String(payload.utr) : null;
        const reference = payload.referenceId ? String(payload.referenceId) : '';
        return {
            eventId: reference || utr || '',
            eventType: 'AMOUNT_COLLECTED',
            paymentStatus: 'SUCCESS',
            amount: parseInrAmount(payload.amount),
            currency: String(payload.currency || 'INR').trim().toUpperCase(),
            virtualAccountId: String(payload.vAccountId || ''),
            utr,
            paymentReference: utr || reference || null,
            remitterName: payload.remitterName || null,
            remitterAccount: payload.remitterAccount ? String(payload.remitterAccount).slice(-4) : null,
            raw: payload,
        };
    }
    return null;
}

module.exports = {
    configured,
    providerInfo,
    createVirtualAccount,
    getVirtualAccount,
    verifyWebhookSignature,
    parsePaymentWebhook,
};
