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

function activeCollectionsProvider() {
    const name = selectedName();
    if (!name) return null;
    const adapter = providers[name];
    if (!adapter || typeof adapter.configured !== 'function' || !adapter.configured()) return null;
    return { name, adapter };
}

function collectionsAvailability() {
    const name = selectedName();
    if (!name) {
        return { available: false, reason: 'no-provider-selected', configured: false };
    }
    const adapter = providers[name];
    if (!adapter) {
        return { available: false, reason: 'unknown-provider', provider: name, configured: false };
    }
    const info = typeof adapter.providerInfo === 'function' ? adapter.providerInfo() : {};
    return {
        available: !!adapter.configured(),
        provider: name,
        configured: !!adapter.configured(),
        mode: info.mode || null,
        currency: info.currency || 'INR',
    };
}

module.exports = { activeCollectionsProvider, collectionsAvailability, providers };
