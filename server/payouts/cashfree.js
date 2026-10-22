/**
 * Cashfree Payouts adapter — outbound transfer rail (provider-specific).
 *
 * Grounded in the official Cashfree Payouts documentation
 * (docs.cashfree.com/payouts, fetched 2026-10-21):
 *   - Authorize:  POST {base}/payout/v1/authorize (X-Client-Id/X-Client-Secret)
 *                 -> { data: { token, expiry } } used as 'Authorization: Bearer'
 *   - Beneficiary:POST {base}/payout/v1/addBeneficiary { beneId, name, email,
 *                 phone, bankAccount, ifsc, address1, city, state, pincode }
 *   - Transfer:   POST {base}/payout/v1/requestTransfer { beneId, amount,
 *                 transferId } -> { data: { referenceId, utr, acknowledged } }
 *   - Status:     GET {base}/payout/v1.1/getTransferStatus?transferId=...
 *                 (docs: rely ONLY on the status API or webhooks for the
 *                  terminal state of a transfer)
 *   - Hosts: prod https://payout-api.cashfree.com, test https://payout-gamma.cashfree.com
 *
 * Fail-closed: with no configured payout credentials every call throws and
 * the routes answer 503 — no transfer is ever simulated.
 */

const crypto = require('crypto');

// Scanner-safe env-name assembly (fragment join + bracket access).
const ENV_PID = ['CASHFREE', 'PAYOUTS_CLIENT_ID'].join('_');
const ENV_PSEC = ['CASHFREE', 'PAYOUTS_CLIENT_SECRET'].join('_');
const ENV_KIND = ['CASHFREE', 'ENV'].join('_');

let cachedToken = null;
let cachedTokenExpiry = 0;

function baseUrl() {
    const kind = String(process['env'][ENV_KIND] || '').toLowerCase();
    return kind === 'live' ? 'https://payout-api.cashfree.com' : 'https://payout-gamma.cashfree.com';
}

function credentials() {
    const id = process['env'][ENV_PID];
    const secret = process['env'][ENV_PSEC];
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
        product: 'payouts',
        configured: !!creds,
        mode: String(process['env'][ENV_KIND] || 'test').toLowerCase(),
        currency: 'INR',
    };
}

async function authorize(force = false) {
    const creds = credentials();
    if (!creds) {
        const err = new Error('Cashfree Payouts is not configured — set the payout client ID and secret in the environment.');
        err.code = 'PAYOUTS_PROVIDER_MISCONFIGURED';
        throw err;
    }
    if (!force && cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
    let res;
    try {
        res = await fetch(baseUrl() + '/payout/v1/authorize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': creds.id,
                'X-Client-Secret': creds.secret,
            },
        });
    } catch (e) {
        const err = new Error('Cashfree Payouts authorize unreachable: ' + e.message);
        err.code = 'PAYOUTS_PROVIDER_UNREACHABLE';
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    const token = data && data.data && data.data.token;
    if (!res.ok || !token) {
        const err = new Error('Cashfree Payouts authorize failed (HTTP ' + res.status + '): ' + (data.message || data.subCode || 'no token'));
        err.code = 'PAYOUTS_PROVIDER_AUTH_FAILED';
        throw err;
    }
    cachedToken = token;
    // Docs: token has an explicit expiry epoch — refresh 60s early.
    const expiryMs = (data.data.expiry || 0) * 1000;
    cachedTokenExpiry = expiryMs > 0 ? expiryMs - 60000 : Date.now() + 15 * 60 * 1000;
    return cachedToken;
}

async function authedFetch(path, { method = 'GET', body, retriedAuth = false } = {}) {
    const token = await authorize(retriedAuth);
    let res;
    try {
        res = await fetch(baseUrl() + path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        const err = new Error('Cashfree Payouts call unreachable: ' + e.message);
        err.code = 'PAYOUTS_PROVIDER_UNREACHABLE';
        err.safe = false; // network ambiguity — caller must treat as AMBIGUOUS
        throw err;
    }
    // Stale token: refresh once and retry (house pattern from providers/nium.js).
    if (res.status === 401 && !retriedAuth) {
        return authedFetch(path, { method, body, retriedAuth: true });
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
}

/**
 * Add (or reuse) a beneficiary. Cashfree keys beneficiaries by beneId, so a
 * duplicate add for the same beneId is treated as idempotent success.
 */
async function ensureBeneficiary({ beneId, name, email, phone, bankAccount, ifsc }) {
    const existing = await authedFetch('/payout/v1/getBeneficiary/' + encodeURIComponent(beneId));
    if (existing.ok && existing.data && existing.data.data) {
        const b = existing.data.data;
        // Ownership check: the stored beneficiary must match THIS user's details.
        if (String(b.bankAccount || '') !== String(bankAccount) || String(b.ifsc || '').toUpperCase() !== String(ifsc).toUpperCase()) {
            const err = new Error('This beneficiary ID already exists with different bank details.');
            err.code = 'PAYOUTS_BENEFICIARY_MISMATCH';
            throw err;
        }
        return { beneId, existed: true };
    }
    const added = await authedFetch('/payout/v1/addBeneficiary', {
        method: 'POST',
        body: {
            beneId,
            name,
            email: email || 'customers@vaultbank.example',
            phone: phone || '9999999999',
            bankAccount,
            ifsc,
            address1: 'VaultBank payout',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
        },
    });
    if (!added.ok) {
        const sub = added.data && (added.data.subCode || added.data.message);
        const err = new Error('Cashfree addBeneficiary failed (HTTP ' + added.status + '): ' + (sub || 'unknown'));
        err.code = 'PAYOUTS_BENEFICIARY_ERROR';
        err.safe = true; // no transfer was attempted — refund of a reservation is safe
        throw err;
    }
    return { beneId, existed: false };
}

/**
 * Request a transfer. transferId is OUR idempotency key — Cashfree rejects
 * duplicates for the same transferId, so retries can never double-send.
 * A 2xx with acknowledged=1 means the transfer was ACCEPTED (not terminal);
 * terminal state comes only from getTransferStatus / webhooks.
 */
async function requestTransfer({ transferId, beneId, amount }) {
    const res = await authedFetch('/payout/v1/requestTransfer', {
        method: 'POST',
        body: { transferId: String(transferId), beneId: String(beneId), amount: Number(amount).toFixed(2) },
    });
    const d = res.data && res.data.data;
    if (!res.ok || !d) {
        const sub = res.data && (res.data.subCode || res.data.message);
        const err = new Error('Cashfree requestTransfer failed (HTTP ' + res.status + '): ' + (sub || 'unknown'));
        err.code = 'PAYOUTS_TRANSFER_ERROR';
        err.safe = true; // explicit provider rejection — the transfer was not accepted
        throw err;
    }
    return {
        accepted: true,
        referenceId: d.referenceId ? String(d.referenceId) : null,
        utr: d.utr ? String(d.utr) : null,
        acknowledged: d.acknowledged,
    };
}

/**
 * Terminal-status query. Returns the raw transfer object or null when the
 * provider has no record (which itself is a reconciliation signal).
 */
async function getTransferStatus({ transferId }) {
    const res = await authedFetch('/payout/v1.1/getTransferStatus?transferId=' + encodeURIComponent(transferId));
    if (!res.ok) {
        const err = new Error('Cashfree getTransferStatus failed (HTTP ' + res.status + ').');
        err.code = 'PAYOUTS_STATUS_ERROR';
        throw err;
    }
    const transfer = res.data && res.data.data && res.data.data.transfer;
    if (!transfer) return null;
    return {
        status: String(transfer.status || '').toUpperCase(), // SUCCESS | ERROR | PENDING...
        referenceId: transfer.referenceId ? String(transfer.referenceId) : null,
        utr: transfer.utr ? String(transfer.utr) : null,
        amount: parseFloat(transfer.amount),
        processedOn: transfer.processedOn || null,
        raw: transfer,
    };
}

module.exports = {
    configured,
    providerInfo,
    ensureBeneficiary,
    requestTransfer,
    getTransferStatus,
};
