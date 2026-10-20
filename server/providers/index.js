/**
 * Provider adapter interface — the seam lets any payout provider join
 * VaultBank without touching the ledger or financial core.
 *
 * Contract every implementation must satisfy (all fail-closed when unconfigured):
 *
 *   providerConfig()              -> { env, baseUrl?, configured, reason? }
 *   authenticate()                -> 'Bearer <token>' (cached; refresh on 401)
 *   createPayout(req)             -> { paymentId, requestId, status, raw }
 *        req: { requestId (client idempotency id), transactionNumber,
 *               statementNarrative, sourceAccount, sourceCurrency,
 *               sourceAmount|destinationAmount,
 *               beneficiary: { name, country_code, account_number, ... } }
 *   getPayout(paymentId)          -> { paymentId, status, subStatus, raw }
 *   normalizeStatus(providerRest) -> 'pending'|'processing'|'succeeded'|
 *                                    'failed'|'refunded'|'reconciliation_required'
 *   webhookSecretPresent()        -> bool (webhook auth fail-closed)
 *
 * Money rules baked into every implementation:
 *   - provider-treasury funding (createFundingEntry) records provider money
 *     ONLY; it is never a customer deposit and never touches `accounts`.
 *   - no implementation may enable customer-facing fiat flows that the
 *     provider has not approved; surfacing is route-level and gated.
 */

module.exports.getProvider = (name) => {
    if (name !== 'nium') return null; // fail-closed: unknown provider
    return require('./nium');
};
