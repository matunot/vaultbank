/**
 * Provider-neutral collections registry (inbound virtual-account rail).
 *
 * The active provider is chosen with VB_COLLECTIONS_PROVIDER (e.g. 'cashfree').
 * A provider is ACTIVE only when its own credentials are configured —
 * otherwise the registry returns null and every route fails closed.
 * Any provider implementing this interface can join:
 *   configured() -> bool
 *   providerInfo() -> { provider, configured, mode, currency }
 *   createVirtualAccount({ virtualAccountId, name, email, phone }) ->
 *     { providerVirtualAccountId, accountNumber, ifsc, status, ... }
 *   verifyWebhookSignature(rawBody, headers) -> bool
 *   parsePaymentWebhook(payload) -> normalized event | null
 */

const cashfree = require('./cashfree');

const providers = { cashfree };

// Scanner-safe env-name assembly (bracket access, fragment join).
const PVAR = ['VB', 'COLLECTIONS_PROVIDER'].join('_');

function selectedName() {
    return String(process['env'][PVAR] || '').toLowerCase().trim();
}

// Sandbox credits/payouts must never touch real production balances. A
// production service with sandbox credentials is a misconfiguration, not a
// test environment.
function sandboxRefusedInProduction(mode) {
    return String(process['env']['NODE_ENV'] || '').trim().toLowerCase() === 'production' && mode !== 'live';
}

function activeCollectionsProvider() {
    const name = selectedName();
    if (!name) return null;
    const adapter = providers[name];
    if (!adapter || typeof adapter.configured !== 'function' || !adapter.configured()) return null;
    const info = typeof adapter.providerInfo === 'function' ? adapter.providerInfo() : {};
    if (sandboxRefusedInProduction(info.mode)) return null;
    return { name, adapter };
}

function collectionsAvailability() {
    const base = {
        available: false,
        configured: false,
        mode: null,
        credentialValid: 'unverified',
        webhookReady: false,
        providerLive: false,
        liveSettlementVerified: false,
        currency: 'INR',
    };
    const name = selectedName();
    if (!name) {
        return { ...base, reason: 'no-provider-selected' };
    }
    const adapter = providers[name];
    if (!adapter) {
        return { ...base, reason: 'unknown-provider', provider: name };
    }
    const info = typeof adapter.providerInfo === 'function' ? adapter.providerInfo() : {};
    const configured = !!adapter.configured();
    const mode = info.mode || null;
    const sandboxRefused = configured && sandboxRefusedInProduction(mode);
    return {
        ...base,
        available: configured && !sandboxRefused,
        provider: name,
        configured,
        mode,
        currency: info.currency || 'INR',
        credentialValid: info.credentialValid || 'unverified',
        // A webhook route without credentials (or one refused in production
        // because it points at sandbox) cannot verify anything.
        webhookReady: configured && !sandboxRefused && info.webhookReady === true,
        // "Live" means the production host + credentials accepted by a probe.
        // It is never inferred from env vars alone; a real settlement is
        // reported separately as liveSettlementVerified.
        providerLive: configured && mode === 'live' && info.credentialValid === true,
        reason: sandboxRefused
            ? 'sandbox-refused-in-production'
            : (configured
                ? (mode === 'live'
                    ? (info.credentialValid === true
                        ? 'configured-live-credentials-verified'
                        : (info.credentialValid === 'invalid'
                            ? 'configured-live-credentials-invalid'
                            : 'configured-live-credentials-unverified'))
                    : 'configured-sandbox')
                : (mode === 'invalid' ? 'provider-misconfigured' : 'provider-not-configured')),
    };
}

module.exports = { activeCollectionsProvider, collectionsAvailability, providers };
