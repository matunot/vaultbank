# Lightspark Grid — international payouts integration

Status: **engineering-complete, live money movement disabled by default**.
This document is the operational contract for enabling it.

## 1. What was built

A dedicated backend integration layer under `server/services/lightsparkGrid/`
plus a dedicated router at `server/routes/lightspark-grid.js`. It uses the
existing VaultBank double-entry ledger, authentication, audit logging and
PostgreSQL configuration. No existing payment flow was replaced or removed.

| Area | Files |
| --- | --- |
| Configuration | `server/config/lightsparkGrid.js`, `server/.env.example` |
| HTTP transport | `server/services/lightsparkGrid/client.js`, `errors.js` |
| Capability discovery | `server/services/lightsparkGrid/platform.js` |
| Customer / consent / KYC | `server/services/lightsparkGrid/customers.js` |
| Internal accounts / beneficiaries | `server/services/lightsparkGrid/accounts.js` |
| Quotes | `server/services/lightsparkGrid/quotes.js` |
| Payments / reconciliation | `server/services/lightsparkGrid/payments.js` |
| Webhooks | `server/services/lightsparkGrid/webhooks.js`, `server/middleware/rawBody.js` |
| Persistence | `server/services/lightsparkGrid/store.js`, `server/migrations/017_lightspark_grid.sql` |
| Routes | `server/routes/lightspark-grid.js`, `server/index.js`, `server/middleware/rateLimiter.js` |
| Frontend | `client/src/components/InternationalPayouts.tsx`, `client/src/api.ts`, `client/src/App.tsx`, `client/src/data.ts`, `client/src/components/Sidebar.tsx` |
| Tests | `server/__tests__/lightspark-grid-*.test.js` |

Grid API version `2025-10-13`; base URL `https://api.lightspark.com/grid/2025-10-13`.
Request shapes were taken from the current `lightsparkdev/grid-api` OpenAPI
specification (`openapi.yaml`) rather than inferred.

## 2. Fail-closed defaults

`LIGHTSPARK_GRID_ENABLED` defaults to absent/false. Even when set to `true`,
the integration stays disabled unless **all** of these are valid:

- credentials (`LIGHTSPARK_GRID_CLIENT_ID`, `LIGHTSPARK_GRID_CLIENT_SECRET`);
- webhook public key (`LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY`, PEM SPKI);
- AES key (`VB_LIGHTSPARK_GRID_ENCRYPTION_KEY`, 64 hex characters);
- explicit mode (`sandbox` or `production`) and, for production,
  `LIGHTSPARK_GRID_PRODUCTION_ACKNOWLEDGED=true`;
- an allowlisted HTTPS base URL (`api.lightspark.com` only).

Customer-facing operations additionally require
`LIGHTSPARK_GRID_CUSTOMER_ACCESS_ENABLED=true`. With the integration disabled,
`GET /api/lightspark-grid/availability` returns `{ enabled: false,
supportedCurrencies: [], agreements: [] }` and every other endpoint returns 503.
The UI shows an honest "not enabled" notice and never renders sample corridors,
quotes or balances.

## 3. Financial state machine

Outgoing payout:

1. Validate a stable client idempotency key; replay an existing payment instead
   of reserving twice.
2. In one DB transaction: lock the user's account, verify funds atomically,
   debit `balance`/`available_balance` and `verified_available_balance`, insert
   the `withdrawal` transaction row and the `grid_payments` record, and post a
   balanced `payout_reserved` journal (customer → `OUTBOUND_PAYOUTS_PAYABLE`).
3. Execute the provider-locked quote with a Grid `Idempotency-Key`.
4. `COMPLETED` webhook → `payout_settled` journal
   (`OUTBOUND_PAYOUTS_PAYABLE` → `BANK_SETTLEMENT_ASSET`), payment completed.
5. `FAILED` / `REJECTED` / `REFUND_COMPLETED` → `payout_refund` journal and
   atomic balance restoration, payment failed/refunded.
6. Timeout, ambiguous 5xx or any unknown terminal state → **retain the
   reservation**, set `reconciliation_required`, and record evidence. A
   timeout is never interpreted as proof that money did not move.

Incoming payment:

1. A webhook alone credits nothing. The transaction is fetched from Grid and
   must be `COMPLETED` **and** `CREDIT`.
2. In one DB transaction, an existing `deposit` row with the same provider
   transaction reference blocks a duplicate credit; otherwise a balanced
   `deposit_settled` journal posts
   (`INBOUND_SETTLEMENT_ASSET` → customer) and the account is credited.
3. Pending, failed, unmapped or unconfirmed transactions are recorded for
   reconciliation with no balance change.

## 4. Precision and capability policy

- The ledger stores two decimal places. Currencies whose Grid `Currency.decimals`
  is not `2` are filtered out of capability discovery and rejected on quote.
- Currencies are advertised only when Grid's platform config lists them with
  `INCOMING`/`OUTGOING` enabled; corridors, rails, rates, limits and fees come
  only from `GET /exchange-rates` and receiver lookups. VaultBank's own currency
  registry is never used to enable Grid currencies.
- Beneficiary `accountInfo` accepts only the documented variants implemented
  here (`USD_ACCOUNT`, `EUR_ACCOUNT`, `GBP_ACCOUNT`, `INR_ACCOUNT`,
  `SWIFT_ACCOUNT`) with field-level validation from the spec; other types are
  rejected rather than passed through.
- Amounts cross the boundary as integer minor units and are converted to exact
  two-decimal strings for the ledger.

## 5. Webhook security

Endpoint: `POST /api/webhooks/lightspark/grid`

- `middleware/rawBody.js` preserves the exact bytes for this route in addition
  to the existing Cashfree route.
- `X-Grid-Signature` is accepted as `{"v":1,"s":"<base64>"}` or plain base64.
  It is verified with `crypto.createVerify('SHA256')` over the raw bytes using
  the configured P-256 SPKI public key. Invalid or missing signatures are
  rejected before parsing and never credit anything.
- Verified deliveries are persisted with the event id as primary key. Duplicates
  return 409 (Grid does not retry those); unknown types are stored and ignored;
  processing failures return 500 so Grid redelivers.
- Out-of-order terminal events are recorded as reconciliation evidence rather
  than reversing settled state.

## 6. Security controls

- Every money endpoint requires `authenticateToken`; reads are filtered by
  `user_id`, admin reconciliation routes additionally require `requireAdmin`
  plus `adminLimiter`, and customer payout routes use `transferLimiter`.
- The webhook has its own limiter and is skipped by the browser-facing general
  limiter; it cannot be used to bypass rate limits on other endpoints.
- Beneficiary details are encrypted at rest with AES-256-GCM
  (`v1:iv:tag:ciphertext`) and a keyed HMAC fingerprint; only masked details
  are returned by the API. The acceptance IP is taken from the server request,
  never the client body.
- HTTP transport uses Basic auth over a fixed HTTPS host, `redirect: 'manual'`,
  no user-controlled URLs, timeouts, and retries only for GET or requests with
  an idempotency key. Logs and errors contain no credentials, bodies or bank
  details.
- Every customer and payout action writes to existing `audit_logs`.

## 7. Tests

Run:

```powershell
cd server
npx --yes jest@30.5.2 __tests__/lightspark-grid-*.test.js --runInBand
cd ../client
npx tsc --noEmit
```

Coverage in the new suites: fail-closed config and secret redaction, Basic auth
and idempotency headers, safe retries, ambiguous timeouts, signature
verification (both encodings), tampering, malformed payloads, dedupe, unknown
event types, out-of-order events, precision rejection, provider-derived
capabilities, atomic reservation, insufficient funds, reservation release on
definite failure, no release on ambiguity, incoming pending vs confirmed
credit, and disabled-route behaviour.

Sandbox UAT with real Grid credentials has **not** been performed (no
credentials are present in this environment). Unit tests use injected fake
transports and never contact Grid.

## 8. Render environment variables required before any enablement

```
LIGHTSPARK_GRID_ENABLED=false                 # last flag to flip
LIGHTSPARK_GRID_MODE=sandbox
LIGHTSPARK_GRID_API_BASE_URL=https://api.lightspark.com/grid/2025-10-13
LIGHTSPARK_GRID_CLIENT_ID=<from Grid dashboard>
LIGHTSPARK_GRID_CLIENT_SECRET=<from Grid dashboard>
LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY=<PEM SPKI from Grid dashboard>
LIGHTSPARK_GRID_PRODUCTION_ACKNOWLEDGED=false # only true for production mode
LIGHTSPARK_GRID_CUSTOMER_ACCESS_ENABLED=false
LIGHTSPARK_GRID_REQUIRED_AGREEMENTS=LIGHTSPARK_END_USER_TERMS,LIGHTSPARK_E_SIGN_CONSENT,LIGHTSPARK_PRIVACY_POLICY
LIGHTSPARK_GRID_KYC_REDIRECT_URI=https://<public-origin>/kyo/complete
VB_LIGHTSPARK_GRID_ENCRYPTION_KEY=<64 hex chars, 32 random bytes>
```

The agreement types above are examples and must be confirmed against
`GET /customers/agreements` for the actual platform. The webhook URL registered
with Lightspark must be
`https://vaultbank-md20.onrender.com/api/webhooks/lightspark/grid`.

## 9. Outstanding provider approval requirements (from Lightspark's launch checklist)

- Executed contract, completed KYB and UBO verification.
- Lightspark sign-off on funds flows for every launched product.
- Legal approval of the consent screen and each linked agreement.
- Current agreement versions captured per customer with affirmative consent.
- Reg E pre-transaction disclosure, receipts and periodic statements.
- Webhook registration, idempotency, error handling, reconciliation and
  monitoring verified in sandbox UAT (including a recorded end-to-end flow).

## 10. Production readiness blockers

1. No Grid production access, credentials, webhook key or approved platform
   configuration has been supplied.
2. Sandbox UAT and real settlement verification have not run.
3. Required consent agreements and disclosures have not been approved by
   Lightspark Legal; `LIGHTSPARK_GRID_REQUIRED_AGREEMENTS` is therefore unset
   and customer creation fails closed.
4. Encryption key and agreement/DDPA decisions require operator ownership.
5. Merge/deploy requires human review per the repository Definition of Done.

**Exact next operational action:** obtain sandbox credentials and the webhook
public key from Lightspark, set them in Render with the values above while
keeping `LIGHTSPARK_GRID_ENABLED=false`, run the Grid dashboard's test webhook
against the deployed endpoint, and execute the documented sandbox UAT flow. Only
after signed settlement evidence and legal approval should the enabled flag be
flipped in a reviewed change.
