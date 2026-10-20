/**
 * Nium payout adapter — contracts grounded in the current official
 * documentation (mpdocs.nium.com, payout/pay-in hub):
 *   authentication -> POST /api/v1/authentication (client_key/client_secret)
 *   create payment -> POST /api/v2/payouts (inline beneficiary object)
 *   status polling -> GET /api/v1/payments/id/{payment_id}
 *   funding entry  -> POST /api/v1/fund/create (provider-treasury money only)
 *   webhook        -> client-hosted, auth via x-api-key shared secret
 */

const { providerConfig } = require('./config');

// Unknown provider statuses must land in a held state requiring human eyes,
// never silently in succeeded/failed.
const STATUS_MAP = {
    AWAITING_FUNDS: { status: 'pending', rank: 1 },
    IN_PROCESS: { status: 'processing', rank: 2 },
    PG_PROCESSING: { status: 'processing', rank: 2 },
    SENT_TO_BANK: { status: 'processing', rank: 2 },
    INFO_REQUESTED: { status: 'processing', rank: 2, rfi: true },
    PAID: { status: 'succeeded', rank: 4 },
    REJECTED: { status: 'failed', rank: 4 },
    CANCELLED: { status: 'failed', rank: 4 },
    COMPLIANCE_REJECTED: { status: 'failed', rank: 4 },
    RETURNED: { status: 'refunded', rank: 4 },
};

class ProviderError extends Error {
    constructor(code, message, opts) {
        super(message);
        this.code = code || 'PROVIDER_HTTP'; // NOT_CONFIGURED | AUTH_FAILED | PROVIDER_HTTP
        this.status = (opts && opts.status) || null;
        // safe=true -> provably nothing happened (e.g. auth rejected upfront)
        this.safe = !!(opts && opts.safe === true);
    }
}

let cfg = null;
function config() {
    if (!cfg) cfg = providerConfig();
    return cfg;
}

// --- auth token (cached; refreshed once on 401) ---
let token = null;
let tokenIssuedAt = 0;
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // refresh early; 401-refresh is the backstop

async function bearerToken() {
    if (token && Date.now() - tokenIssuedAt < TOKEN_TTL_MS) return token;
    const c = config();
    if (!c.configured) throw new ProviderError('NOT_CONFIGURED', c.reason || 'Nium adapter is not configured.');
    const r = await fetch(c.baseUrl + '/api/v1/authentication', {
        method: 'POST',
        headers: {
            'client_key': c.clientKey,
            'client_secret': c.clientSecret,
            'content-type': 'application/json',
        },
        body: '{}',
    });
    if (!r.ok) {
        token = null;
        throw new ProviderError('AUTH_FAILED', 'Authentication failed (HTTP ' + r.status + '). No payout request was forwarded.', { status: r.status, safe: true });
    }
    const data = await r.json();
    if (!data || !data.token) {
        token = null;
        throw new ProviderError('AUTH_FAILED', 'Authentication response had no token; refusing to call the provider without one.', { safe: true });
    }
    token = data.token;
    tokenIssuedAt = Date.now();
    return token;
}

async function authedFetch(method, path, opts) {
    const o = opts || {};
    const c = config();
    if (!c.configured) throw new ProviderError('NOT_CONFIGURED', c.reason || 'Nium adapter is not configured.');
    const bearer = await bearerToken();
    const r = await fetch(c.baseUrl + path, {
        method,
        headers: { 'authorization': 'Bearer ' + bearer, 'content-type': 'application/json' },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    if (r.status === 401 && !o.retriedAuth) { // stale cached token — refresh once, then retry
        token = null;
        return authedFetch(method, path, { body: o.body, retriedAuth: true });
    }
    if (!r.ok) {
        let detail = '';
        try {
            const e = await r.json();
            detail = e && (e.message || e.error) ? ' ' + (e.message || e.error) : '';
        } catch (e) { /* opaque provider error body */ }
        throw new ProviderError('PROVIDER_HTTP', 'Nium ' + method + ' ' + path + ' failed (HTTP ' + r.status + ')' + detail, { status: r.status });
    }
    return r.json();
}

async function createPayout(req) {
    const body = {
        request_id: req.requestId,
        transaction_number: req.transactionNumber,
        statement_narrative: req.statementNarrative,
        source_account: req.sourceAccount,
        source_currency: req.sourceCurrency,
        source_amount: req.sourceAmount,
        destination_currency: req.destinationCurrency,
        destination_amount: req.destinationAmount,
        payment_reference_number: req.paymentReference,
        beneficiary: req.beneficiary, // inline beneficiary object (official v2 contract)
        beneficiary_details: req.beneficiaryDetails,
    };
    const data = await authedFetch('POST', '/api/v2/payouts', { body });
    return {
        paymentId: data.payment_id || null,
        requestId: data.reference_number || req.requestId,
        status: data.status || 'IN_PROCESS',
        subStatus: data.sub_status || null,
        raw: data,
    };
}

async function getPayout(paymentId) {
    const data = await authedFetch('GET', '/api/v1/payments/id/' + encodeURIComponent(paymentId));
    return {
        paymentId: data.payment_id || paymentId,
        status: data.status || null,
        subStatus: data.sub_status || null,
        returnReason: data.return_reason || null,
        gpi: data.gpi_details || null,
        raw: data,
    };
}

// Provider-treasury funding entry — provider money ONLY: never a customer
// deposit, never recorded against the accounts table.
async function createFundingEntry(req) {
    const body = {
        currency: req.currency,
        usage_type: req.usageType,
        payment_reference: req.paymentReference,
        amount: req.amount,
    };
    const data = await authedFetch('POST', '/api/v1/fund/create', { body });
    return data;
}

// --- webhook-side helpers (shared with routes/provider-webhooks.js) ---
function webhookSecretPresent() {
    return !!(config()).webhookKey;
}

function normalizeStatus(niumStatus) {
    const m = STATUS_MAP[niumStatus];
    if (m) return { status: m.status, rank: m.rank, rfi: !!m.rfi };
    return { status: 'reconciliation_required', rank: 5 }; // unmapped -> hold for humans
}

module.exports = { providerConfig, ProviderError, config, createPayout, getPayout, createFundingEntry, webhookSecretPresent, normalizeStatus, STATUS_MAP };
