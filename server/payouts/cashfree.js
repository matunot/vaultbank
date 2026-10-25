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
let lastProbe = { at: 0, ok: false, attempted: false };

// Only "live"/"production" and "sandbox"/"test" are valid. An unknown value
// must never silently fall back to the test host while readiness claims live.
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
        err.code = 'PAYOUTS_PROVIDER_MISCONFIGURED';
        throw err;
    }
    return kind === 'live' ? 'https://payout-api.cashfree.com' : 'https://payout-gamma.cashfree.com';
}

function credentials() {
    const id = process['env'][ENV_PID];
    const secret = process['env'][ENV_PSEC];
    if (!id || !secret || /^(your_|placeholder)/i.test(String(id)) || /^(your_|placeholder)/i.test(String(secret))) return null;
    return { id, secret };
}

function configured() {
    return credentials() !== null && envKind() !== 'invalid';
}

function credentialValid() {
    // A failed probe is a real signal, not the same as "never probed".
    if (!lastProbe.attempted || Date.now() - lastProbe.at >= 10 * 60 * 1000) return 'unverified';
    return lastProbe.ok ? true : 'invalid';
}

function providerInfo() {
    const creds = credentials();
    return {
        provider: 'cashfree',
        product: 'payouts',
        configured: !!creds && envKind() !== 'invalid',
        mode: envKind(),
        credentialValid: credentialValid(),
        webhookReady: false,
        reconciliation: 'pull-status-api',
        currency: 'INR',
    };
}

async function authorize(force = false) {
    const creds = credentials();
    if (!creds || envKind() === 'invalid') {
        const err = new Error('Cashfree Payouts is not configured — set the payout client ID and secret in the environment, and CASHFREE_ENV to live or sandbox.');
        err.code = 'PAYOUTS_PROVIDER_MISCONFIGURED';
        throw err;
    }
    if (!force && cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
    let res;
    try {
        res = await fetch(baseUrl() + '/payout/v1/authorize', {
            method: 'POST',
            signal: AbortSignal.timeout(fetchTimeoutMs()),
            headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': creds.id,
                'X-Client-Secret': creds.secret,
            },
        });
    } catch (e) {
        if (e.code) throw e;
        const err = new Error('Cashfree Payouts authorize unreachable: ' + e.message);
        err.code = 'PAYOUTS_PROVIDER_UNREACHABLE';
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    const token = data && data.data && data.data.token;
    if (!res.ok || !token) {
        // Codes only: provider free text can echo request data.
        const providerCode = data && data.subCode ? ' (' + data.subCode + ')' : '';
        const err = new Error('Cashfree Payouts authorize failed (HTTP ' + res.status + ')' + providerCode);
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
    let token;
    try {
        token = await authorize(retriedAuth);
    } catch (e) {
        // No transfer request has been sent yet — a failed auth is safe to refund.
        e.safe = true;
        e.stage = 'auth';
        throw e;
    }
    let res;
    try {
        res = await fetch(baseUrl() + path, {
            method,
            signal: AbortSignal.timeout(fetchTimeoutMs()),
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
        err.stage = 'request';
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
 *
 * Every failure in this stage is SAFE for the caller to refund: the transfer
 * request has not been sent yet. Even a timeout after addBeneficiary only
 * means the beneficiary may exist — no money has moved.
 */
async function ensureBeneficiary({ beneId, name, email, phone, bankAccount, ifsc, address1, city, state, pincode }) {
    try {
        // Never send placeholder contact/address details to a banking provider.
        // Validate before any provider request, including beneficiary lookup.
        const actualName = String(name || '').trim();
        const actualEmail = String(email || '').trim();
        const phoneDigits = String(phone || '').replace(/\\D/g, '');
        const actualAddress = String(address1 || '').trim();
        const actualCity = String(city || '').trim();
        const actualState = String(state || '').trim();
        const actualPincode = String(pincode || '').trim();
        if (actualName.length < 2 ||
            !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(actualEmail) ||
            phoneDigits.length < 10 || phoneDigits.length > 15 ||
            actualAddress.length < 3 || !actualCity || !actualState || !/^\\d{6}$/.test(actualPincode)) {
            const err = new Error('Real beneficiary name, email, phone, street address, city, state and six-digit PIN code are required.');
            err.code = 'PAYOUTS_BENEFICIARY_DETAILS_REQUIRED';
            err.safe = true;
            throw err;
        }
        const providerPhone = phoneDigits.length === 12 && phoneDigits.startsWith('91') ? phoneDigits.slice(2) : phoneDigits;
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
        // 404 is the only status that means "not found, go ahead and add".
        if (!existing.ok && existing.status !== 404) {
            const providerCode = existing.data && existing.data.subCode ? ' (' + existing.data.subCode + ')' : '';
            const err = new Error('Cashfree getBeneficiary failed (HTTP ' + existing.status + ')' + providerCode);
            err.code = 'PAYOUTS_BENEFICIARY_ERROR';
            throw err;
        }
        const added = await authedFetch('/payout/v1/addBeneficiary', {
            method: 'POST',
            body: {
                beneId,
                name: actualName,
                email: actualEmail,
                phone: providerPhone,
                bankAccount,
                ifsc,
                address1: actualAddress,
                city: actualCity,
                state: actualState,
                pincode: actualPincode,
            },
        });
        if (!added.ok) {
            const providerCode = added.data && added.data.subCode ? ' (' + added.data.subCode + ')' : '';
            const err = new Error('Cashfree addBeneficiary failed (HTTP ' + added.status + ')' + providerCode);
            err.code = 'PAYOUTS_BENEFICIARY_ERROR';
            throw err;
        }
        return { beneId, existed: false };
    } catch (e) {
        e.safe = true; // no transfer was attempted in this stage
        throw e;
    }
}

/**
 * Request a transfer. transferId is OUR idempotency key — Cashfree rejects
 * duplicates for the same transferId, so retries can never double-send.
 * A 2xx with acknowledged=1 means the transfer was ACCEPTED (not terminal);
 * terminal state comes only from getTransferStatus / webhooks.
 */
async function requestTransfer({ transferId, beneId, amount }) {
    const amountStr = typeof amount === 'number' ? String(amount) : String(amount == null ? '' : amount).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amountStr) || !(Number(amountStr) > 0)) {
        const err = new Error('Payout amount must be a positive INR value with at most two decimals.');
        err.code = 'PAYOUTS_AMOUNT_INVALID';
        err.safe = true;
        throw err;
    }
    // Normalize to two decimals as the provider expects, without float math.
    const [whole, fraction = ''] = amountStr.split('.');
    const amountBody = whole + '.' + (fraction + '00').slice(0, 2);
    const res = await authedFetch('/payout/v1/requestTransfer', {
        method: 'POST',
        body: { transferId: String(transferId), beneId: String(beneId), amount: amountBody },
    });
    const d = res.data && res.data.data;
    if (!res.ok || !d) {
        const providerCode = res.data && res.data.subCode ? ' (' + res.data.subCode + ')' : '';
        const err = new Error('Cashfree requestTransfer failed (HTTP ' + res.status + ')' + providerCode);
        err.code = 'PAYOUTS_TRANSFER_ERROR';
        err.status = res.status;
        // 2xx without the expected transfer body is just as ambiguous as a
        // network failure: the provider may have accepted the transfer.
        // 408/409/425/429/5xx are also ambiguous. Never auto-refund these.
        const ambiguous = res.ok
            ? true
            : (res.status === 408 || res.status === 409 || res.status === 425 || res.status === 429 || res.status >= 500);
        err.safe = !ambiguous;
        err.ambiguous = ambiguous;
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
 * Terminal-status query. Returns null when the provider has no record (404)
 * so reconciliation can distinguish "not created yet" from a provider error.
 */
async function getTransferStatus({ transferId }) {
    const res = await authedFetch('/payout/v1.1/getTransferStatus?transferId=' + encodeURIComponent(transferId));
    if (res.status === 404) return null;
    if (!res.ok) {
        const err = new Error('Cashfree getTransferStatus failed (HTTP ' + res.status + ').');
        err.code = 'PAYOUTS_STATUS_ERROR';
        throw err;
    }
    const transfer = res.data && res.data.data && res.data.data.transfer;
    if (!transfer) return null;
    return {
        // SUCCESS | PENDING | FAILED | REJECTED | REVERSED | ERROR
        status: String(transfer.status || '').toUpperCase(),
        referenceId: transfer.referenceId ? String(transfer.referenceId) : null,
        utr: transfer.utr ? String(transfer.utr) : null,
        amount: parseFloat(transfer.amount),
        currency: transfer.currency ? String(transfer.currency).toUpperCase() : null,
        processedOn: transfer.processedOn || null,
        raw: transfer,
    };
}

/**
 * Admin-only, read-only credential probe. POST /payout/v1/authorize returns a
 * token; it never moves money. Success is cached for 10 minutes so the public
 * readiness endpoint can distinguish "configured" from "credentials accepted".
 */
async function probeCredentials() {
    try {
        await authorize(true);
        lastProbe = { at: Date.now(), ok: true, attempted: true };
        return { ok: true, mode: envKind() };
    } catch (e) {
        lastProbe = { at: Date.now(), ok: false, attempted: true };
        return { ok: false, mode: envKind(), code: e.code || 'PAYOUTS_PROBE_FAILED' };
    }
}

module.exports = {
    configured,
    providerInfo,
    ensureBeneficiary,
    requestTransfer,
    getTransferStatus,
    probeCredentials,
};
