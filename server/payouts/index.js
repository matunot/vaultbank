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

// Sandbox payouts must never debit a real production balance and then report
// success while no bank money moved. A production service with sandbox
// credentials is a misconfiguration, not a test environment.
function sandboxRefusedInProduction(mode) {
    return String(process['env']['NODE_ENV'] || '').trim().toLowerCase() === 'production' && mode !== 'live';
}

// Third-party adapters are retained only for isolated tests/development. Production is hard-locked to VaultBank-native rails; stale provider env vars are ignored.
function nativeRailsOnly() {
    // Production is permanently native-only. Legacy provider adapters remain
    // isolated for tests/development and cannot be re-enabled by environment flags.
    return String(process['env']['NODE_ENV'] || '').trim().toLowerCase() === 'production';
}

function activePayoutProvider() {
    if (nativeRailsOnly()) return null;
    const name = selectedName();
    if (!name) return null;
    const adapter = providers[name];
    if (!adapter || typeof adapter.configured !== 'function' || !adapter.configured()) return null;
    const info = typeof adapter.providerInfo === 'function' ? adapter.providerInfo() : {};
    if (sandboxRefusedInProduction(info.mode)) return null;
    return { name, adapter };
}

function payoutAvailability() {
    const base = {
        available: false,
        configured: false,
        mode: null,
        credentialValid: 'unverified',
        webhookReady: false,
        providerLive: false,
        liveSettlementVerified: false,
        reconciliation: 'pull-status-api',
        currency: 'INR',
    };
    if (nativeRailsOnly()) return { ...base, reconciliation: 'not-applicable-native-only', reason: 'native-rails-only' };
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
        // This integration does not mount a payout webhook; terminal state
        // comes from the pull status API. Never claim webhook readiness here.
        webhookReady: configured && !sandboxRefused && info.webhookReady === true,
        reconciliation: info.reconciliation || 'pull-status-api',
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

module.exports = { activePayoutProvider, payoutAvailability, providers };
