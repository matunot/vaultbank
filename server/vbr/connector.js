/**
 * VBR Connector Contract — the provider-neutral interface every external
 * rail must implement. A connector is a MODULE (not a class) that exports
 * these named functions. The VBR core routes intents to connectors based on
 * the intent's `method` field.
 *
 * Required exports:
 *
 *   id                    → string: stable connector identifier ('internal', 'cashfree-collections', etc.)
 *   direction             → 'send' | 'receive' | 'both': which payment directions this connector serves
 *   currencies            → array: which currencies this connector supports
 *   configured()           → boolean: is the connector ready to process?
 *   availability()         → { available, reason, provider } — honest readiness state
 *
 * For receive (deposit/collection) connectors:
 *   provisionDetails({ userId, accountId, user }) → { accountNumber, ifsc, bankCode } | null
 *     — returns provider-issued receiving details, or null if unavailable
 *   verifyWebhookSignature(rawBody, headers) → boolean
 *     — verifies the webhook cryptographically BEFORE any DB write
 *   parsePaymentWebhook(payload) → { eventId, amount, currency, virtualAccountId, ... } | null
 *     — normalizes a provider webhook into a standard shape
 *
 * For send (payout/withdrawal) connectors:
 *   requestTransfer({ transferId, userId, amount, currency, beneficiary }) → { accepted, referenceId, utr } | throws
 *     — submits to the provider; `err.safe === true` means confirmed NOT accepted (refund is safe)
 *   getTransferStatus({ transferId }) → { status, referenceId, utr } | null
 *     — authoritative status from the provider's API
 *
 * Safety rules (ENFORCED by the VBR core, not trusted from connectors):
 *   1. A connector can never directly change an intent's state — it returns
 *      results and the VBR core applies transitions through the state machine.
 *   2. A connector can never directly post to the ledger — the VBR core
 *      handles all ledger writes.
 *   3. A connector marked `safe` on a rejection means the provider confirmed
 *      the transfer was NOT accepted — refunding the reservation is safe.
 *   4. An unconfigured connector must fail closed: return false/null/throw,
 *      never simulate a payment.
 *
 * Existing connectors (wrapping current adapters, not replacing them):
 *   - server/vbr/connectors/internal.js       — VaultBank-to-VaultBank transfers (always available)
 *   - server/collections/cashfree.js           — INR inbound (wrapped, not duplicated)
 *   - server/payouts/cashfree.js               — INR outbound (wrapped, not duplicated)
 *
 * USD external bank transfers: NO connector exists today — explicitly
 * unavailable until a suitable authorized settlement rail is configured.
 * The VBR core rejects USD send intents with method != 'internal' and
 * returns a clear "no authorized USD rail" error.
 */

// The contract is this file's documentation plus the validation helpers below.

const REQUIRED_RECEIVE_FUNCTIONS = ['provisionDetails'];
const REQUIRED_SEND_FUNCTIONS = ['requestTransfer', 'getTransferStatus'];
const REQUIRED_BASE_FUNCTIONS = ['configured', 'availability'];

/** Validates that a module satisfies the connector contract. Never throws — returns a list of issues. */
function validateConnector(conn, direction) {
    const issues = [];
    for (const fn of REQUIRED_BASE_FUNCTIONS) {
        if (typeof conn[fn] !== 'function') issues.push(`missing base function: ${fn}`);
    }
    if (typeof conn.id !== 'string' || !conn.id) issues.push('missing or empty id');
    if (!['send', 'receive', 'both', 'base-only'].includes(conn.direction)) issues.push(`invalid direction: ${conn.direction}`);
    if (!Array.isArray(conn.currencies)) issues.push('currencies must be an array');
    if (direction === 'receive' || direction === 'both') {
        for (const fn of REQUIRED_RECEIVE_FUNCTIONS) {
            if (typeof conn[fn] !== 'function') issues.push(`missing receive function: ${fn}`);
        }
    }
    if (direction === 'send' || direction === 'both') {
        for (const fn of REQUIRED_SEND_FUNCTIONS) {
            if (typeof conn[fn] !== 'function') issues.push(`missing send function: ${fn}`);
        }
    }
    return issues;
}

module.exports = { validateConnector };
