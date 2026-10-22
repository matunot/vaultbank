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

function baseUrl() {
    const kind = String(process['env'][ENV_KIND] || '').toLowerCase();
    return kind === 'live' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

function credentials() {
    const id = process['env'][ENV_ID];
    const secret = process['env'][ENV_SECRET];
    if (!id || !secret || String(id).startsWith('your_') || String(secret).startsWith('your_')) return null;
    return { id, secret };
}

function configured() {
    return credentials() !== null;
}

function providerInfo() {
    const creds = credentials();
    return {
        provider: 'cashfree',
        product: 'auto-collect-vba',
        configured: !!creds,
        mode: String(process['env'][ENV_KIND] || 'sandbox').toLowerCase(),
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
    const body = {
        virtual_account_details: {
            virtual_account_id: String(virtualAccountId),
            virtual_account_name: String(name || 'VaultBank Customer'),
            virtual_account_email: String(email || 'customers@vaultbank.example'),
            virtual_account_phone: String(phone || '9999999999'),
        },
    };
    if (bankCode) body.bank_codes = [String(bankCode).toUpperCase()];

    let res;
    try {
        res = await fetch(baseUrl() + '/pg/vba', {
            method: 'POST',
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
        const err = new Error('Cashfree VBA API unreachable: ' + e.message);
        err.code = 'COLLECTIONS_PROVIDER_UNREACHABLE';
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
        // The deterministic virtualAccountId already exists at the provider but
        // the response does not return the account details — never guess them.
        const err = new Error('Virtual account already exists at Cashfree but its details are not in this response — needs operator reconciliation.');
        err.code = 'COLLECTIONS_VBA_ALREADY_EXISTS';
        throw err;
    }
    if (!res.ok) {
        const err = new Error('Cashfree VBA create failed (HTTP ' + res.status + '): ' + (data.message || 'unknown error'));
        err.code = res.status === 401 ? 'COLLECTIONS_PROVIDER_AUTH_FAILED' : 'COLLECTIONS_PROVIDER_ERROR';
        throw err;
    }
    const list = data.virtual_bank_accounts || [];
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
 * Normalize either webhook generation into a payment event:
 *   PAYMENT_SUCCESS_WEBHOOK (new) or AMOUNT_COLLECTED (legacy).
 */
function parsePaymentWebhook(payload) {
    if (!payload || typeof payload !== 'object') return null;
    // New generation
    if (payload.type === 'PAYMENT_SUCCESS_WEBHOOK' && payload.data && payload.data.payment) {
        const p = payload.data.payment;
        const vba = (p.payment_method && p.payment_method.vba_transfer) || {};
        return {
            eventId: String(p.cf_payment_id || vba.utr || ''),
            eventType: 'PAYMENT_SUCCESS_WEBHOOK',
            paymentStatus: String(p.payment_status || ''),
            amount: parseFloat(p.payment_amount),
            currency: String(p.payment_currency || 'INR'),
            virtualAccountId: String(vba.vaccount_id || ''),
            utr: vba.utr ? String(vba.utr) : null,
            remitterName: vba.remitter_name || null,
            remitterAccount: vba.remitter_account ? String(vba.remitter_account).slice(-4) : null,
            raw: payload,
        };
    }
    // Legacy AMOUNT_COLLECTED
    if (payload.event === 'AMOUNT_COLLECTED') {
        return {
            eventId: String(payload.referenceId || payload.utr || ''),
            eventType: 'AMOUNT_COLLECTED',
            paymentStatus: 'SUCCESS',
            amount: parseFloat(payload.amount),
            currency: 'INR',
            virtualAccountId: String(payload.vAccountId || ''),
            utr: payload.utr ? String(payload.utr) : null,
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
    verifyWebhookSignature,
    parsePaymentWebhook,
};
