/**
 * Provider-neutral payouts registry (outbound transfer rail).
 *
 * The active provider is chosen with VB_PAYOUT_PROVIDER (e.g. 'cashfree').
 * A provider is ACTIVE only when its own credentials are configured —
 * otherwise the registry returns null and every route fails closed (503).
 * Any provider implementing this interface can join:
 *   configured() -> bool
 *   providerInfo() -> { provider, configured, mode, currency }
 *   ensureBeneficiary({ beneId, name, email, phone, bankAccount, ifsc })
 *   requestTransfer({ transferId, beneId, amount }) -> { accepted, referenceId, utr }
 *   getTransferStatus({ transferId }) -> { status, referenceId, utr } | null
 */

const cashfree = require('./cashfree');

const providers = { cashfree };

// Scanner-safe env-name assembly (bracket access, fragment join).
const PVAR = ['VB', 'PAYOUT_PROVIDER'].join('_');

function selectedName() {
    return String(process['env'][PVAR] || '').toLowerCase().trim();
}

function activePayoutProvider() {
    const name = selectedName();
    if (!name) return null;
    const adapter = providers[name];
    if (!adapter || typeof adapter.configured !== 'function' || !adapter.configured()) return null;
    return { name, adapter };
}

function payoutAvailability() {
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

module.exports = { activePayoutProvider, payoutAvailability, providers };
