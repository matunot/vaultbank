# INR Rails Runbook — Cashfree Collections + Payouts

Last updated: 2026-10-25. Scope: the real INR rails implemented in
`server/collections/` and `server/payouts/` and their routes. This runbook is
written so an operator can configure, verify, reconcile and disable the rails
without guessing. It contains no credentials, bank details or customer data.

## Honest status (read this first)

| Item | Status |
|---|---|
| Code, mock tests, isolated PostgreSQL tests | Verified in this repo. |
| Production schema 001–012 | Verified read-only: all 12 recorded; core tables/indexes present. |
| `virtual_accounts` / `collection_events` | Created lazily on first collections use; absent in the production database today. This is expected. |
| Cashfree sandbox end-to-end | **Not verified** — no sandbox credentials were used. |
| Cashfree live settlement | **Not verified** — no live credentials, no real payouts, no real money. |
| Payout webhook | **Not implemented.** Terminal payout state is pulled from the status API. |
| Automatic payout reconciler | **Not implemented.** A user or admin must call the reconcile endpoint. |

`providerLive:true` is never inferred from environment variables. It requires
`CASHFREE_ENV=live` **and** a successful safe credential probe (payouts only).
`liveSettlementVerified` stays false until a real settled transaction has been
observed.

A service running with `NODE_ENV=production` refuses sandbox mode entirely:
both rails report `reason:"sandbox-refused-in-production"`, `available:false`,
and every money/webhook route answers 503. This is deliberate: sandbox credits
and payouts must never move a real production ledger. Run sandbox acceptance on
a separate staging service with `NODE_ENV=staging` (or locally), never on the
live service.

## Exact Render environment variables

Set these in the Render dashboard for the `vaultbank-backend` service. The
names are also declared in `render.yaml`; values marked `sync: false` must be
entered manually.

| Variable | Purpose |
|---|---|
| `VB_COLLECTIONS_PROVIDER` | `cashfree` enables the inbound VBA rail. Unset/blank disables it (503). |
| `VB_PAYOUT_PROVIDER` | `cashfree` enables the outbound payout rail. Unset/blank disables it (503). |
| `CASHFREE_ENV` | `sandbox` (default when unset) or `live`. Any other value is a hard misconfiguration (`provider-misconfigured`). `render.yaml` leaves this `sync:false` so a Blueprint sync cannot flip a live service back to sandbox. |
| `CASHFREE_CLIENT_ID` | Auto Collect client ID. |
| `CASHFREE_CLIENT_SECRET` | Auto Collect client secret. This integration also uses it as the webhook HMAC secret; it must exactly match the secret Cashfree signs VBA webhooks with. |
| `CASHFREE_PAYOUTS_CLIENT_ID` | Payouts client ID. |
| `CASHFREE_PAYOUTS_CLIENT_SECRET` | Payouts client secret. |
| `CASHFREE_HTTP_TIMEOUT_MS` | Optional; 1000–60000, default 15000. |

Never commit these values. Use the Render dashboard (or the approved local
secret store). Rotate by updating both the Cashfree dashboard and Render.

## Configuration procedure

1. **Activate both products with Cashfree.** Auto Collect (virtual bank
   accounts) and Payouts are separate activations. Do not configure payouts
   until Cashfree has issued the payout account and beneficiary API access.
2. **Start in sandbox on a staging service.** Set `CASHFREE_ENV=sandbox`, the
   sandbox client credentials, and both `VB_*_PROVIDER=cashfree` values on a
   service running with `NODE_ENV=staging`. Do **not** use the live production
   service for sandbox testing: it refuses sandbox mode by design.
3. **Configure the collections webhook** in Cashfree:
   - URL: `https://<staging-service>/api/collections/webhook/cashfree`
   - Event: `PAYMENT_SUCCESS_WEBHOOK` (new integrations). The legacy
     `VBA_TRANSFER_SUCCESS_PAYMENT` / `AMOUNT_COLLECTED` payload is parsed for
     compatibility, but this integration verifies the `x-webhook-timestamp` +
     `x-webhook-signature` headers. Do not enable a legacy webhook if it does
     not send those headers; escalate before going live.
   - The HMAC secret is `CASHFREE_CLIENT_SECRET`. If Cashfree shows a separate
     webhook secret, this adapter needs a code change; do not assume it matches.
4. **Verify readiness** (public, no secrets):
   `curl.exe https://<staging-service>/api/payments/readiness`
   Expected staging/sandbox state with credentials present:
   - `inr.collectionsConfigured: true`
   - `inr.collectionsCredentialValid: "unverified"` (no safe probe exists)
   - `inr.collectionsWebhookReady: true`
   - `inr.collectionsProviderLive: false`
   - `inr.collectionsLiveSettlementVerified: false`
   - `inr.payoutsConfigured: true`
   - `inr.payoutsCredentialValid: "unverified"` until the admin probe runs
   - `inr.payoutsWebhookReady: false`
   - `inr.payoutsReconciliation: "pull-status-api"`
   - `inr.payoutsProviderLive: false`
5. **Probe payout credentials (read-only):** as an admin,
   `GET /api/payments/admin/readiness?probe=1` with a Bearer admin token.
   This calls `POST /payout/v1/authorize` only; it moves no money. A failure
   reports `payoutsCredentialValid: "invalid"` for 10 minutes, not
   `"unverified"`.
6. **Sandbox acceptance test (synthetic data only):**
   - Open an INR account (`POST /api/account/open-inr`), then call
     `GET /api/collections/my-details`. Confirm the returned account number and
     IFSC are provider-issued and non-empty. Never invent or edit them.
   - Send a sandbox test payment to that VBA using the Cashfree sandbox
     mechanism. Confirm the signed webhook credits the INR account exactly
     once, writes one `deposit` transaction with the UTR as
     `external_reference`, and marks the `collection_events` row `credited`.
   - Replay the same webhook. Confirm `duplicate:true` and no second credit.
   - Send a payout of `10.00` INR to the **Cashfree sandbox test beneficiary**
     (not a real person). Reconcile it and confirm the DB status and ledger.
   - Test a safe rejection (sandbox bank rejection) and confirm the refund row
     `VBPO-…-REFUND` and `failed_refunded` state.
7. **Live cutover.** Only after sandbox acceptance:
   - Replace the four Cashfree credentials with live values.
   - Change `CASHFREE_ENV` to `live`.
   - Point the Cashfree collections webhook at the live service:
     `https://vaultbank-md20.onrender.com/api/collections/webhook/cashfree`.
   - Deploy, re-run the admin probe, and confirm `payoutsProviderLive:true`.
   - `collectionsCredentialValid` remains `"unverified"` by design; the first
     real signed collection is the first proof. `liveSettlementVerified`
     remains false until an operator records an observed settlement.
   - Do not flip `CASHFREE_ENV` while any payout is non-terminal. Live and
     sandbox hosts have separate transfer IDs and status records.

## Schema check (read-only)

From `server/`:

```
npm run check:schema
```

It prints only database name, migration filenames, object-presence and
index-uniqueness booleans. It exits `0` only when migrations, all core and lazy
tables, all required indexes and columns exist, and every idempotency arbiter
index is actually `UNIQUE` in `pg_index` (a same-named non-unique index fails).

Current production result (2026-10-25, read-only): all 12 migrations recorded;
`users`, `accounts`, `transactions`, `transfers`, `transfer_idempotency`,
`payment_intents`, `payout_requests` present; the core idempotency indexes
(`ux_transfer_idempotency_user_key`, `payment_intent_idempotency_key`,
`payout_idempotency_user_key`) are verified `UNIQUE`. `virtual_accounts` and
`collection_events` are absent, so overall `ready:false`. This is expected
before the first collections request. The collections route creates the two
lazy tables and verifies their unique indexes; if that fails it returns 503.

Migration runner behavior was verified on an isolated scratch database:

- First `node scripts/run-migrations.js`: applied all 12, exit 0.
- Second run: skipped all 12, no new `_migrations` rows, exit 0.
- Injected failing migration: exit 1 and no `_migrations` row.

Never rerun 007 or any destructive migration manually against production. The
runner skips already-recorded files; do not delete `_migrations` rows to force
a rerun.

## Collections operations

- Endpoint: `GET /api/collections/my-details` (auth). It provisions one VBA per
  user, deterministically. The customer must have a full name, email and phone
  on their profile; missing data returns `400
  COLLECTIONS_CUSTOMER_DETAILS_REQUIRED` instead of sending invented identity
  data to Cashfree. The provider ID is `VB` + 18 uppercase hex chars = 20
  characters (Cashfree's maximum). Do not lengthen it.
- Webhook: `POST /api/collections/webhook/cashfree`. Signature is verified over
  the exact raw bytes **before any DB write**. Amount precision is strict
  (max 2 decimals), currency is INR-only, duplicate event IDs and duplicate
  UTRs never double-credit. A signed payment is credited even if the local VBA
  row is `conflict`/`error` (provider issued it; the signed event proves the
  money arrived); only `disabled` is refused.
- If a create response is lost, the next `my-details` retry gets Cashfree's 409
  and fetches the existing VBA via `GET /pg/vba/{virtual_account_id}`. If that
  fetch also fails, the row stays `conflict` for operator review — do not invent
  account details.
- Responses that make Cashfree retry:
  - `500 COLLECTIONS_VA_UNMATCHED` — VBA not mapped/disabled or account frozen.
  - `500 COLLECTIONS_ACCOUNT_MISSING` — owning account missing.
  - `500` — any mid-flow failure; the whole transaction rolled back.
- `400 COLLECTIONS_EVENT_INVALID` — signed payload was unparseable or had a
  missing/invalid amount or identity. The event is recorded as `failed` (with
  an `invalid:` event ID) for operator review, never silently acked.
- `200` with `currency_rejected` — signed non-INR event committed, no credit.
- `200 duplicate:true` — already credited; safe.
- Admin overview: `GET /api/collections/admin/overview` (Bearer admin token;
  returns 401 without one). Account numbers are masked; use the provider VBA
  ID/UTR for reconciliation. The stored webhook payload contains remitter PII;
  apply the bank's retention policy and never export it to logs or tickets.

## Payout operations

- Create: `POST /api/payouts/requests` with header `Idempotency-Key` (8–100
  characters; shorter/longer is rejected, never truncated). Amount is INR 10 to
  5,00,000; IFSC and 6–20 digit account are validated. The full bank account is
  sent to Cashfree but only a masked form is stored. `beneId` is
  `VBU-` + SHA-256(user + account + IFSC), first 32 hex uppercase.
- Before funds are reserved, the user profile must contain a real full name,
  valid email and phone, and the payout request must include the user's real
  street address, city, state and six-digit PIN code. Missing values return
  `400` before any debit; the adapter independently validates them before
  contacting Cashfree. No placeholder phone, email or address is sent.
- The Withdraw INR UI stays disabled until the public readiness response reports
  `payoutsMode:"live"` and `payoutsProviderLive:true`. An admin must first run
  the safe `GET /api/payments/admin/readiness?probe=1` credential probe.
  The Deposit UI shows only Cashfree INR receiving and explicitly configured
  manual bank-transfer options; Stripe, PayPal and crypto are not offered there.
- Reservation is atomic: claim + debit + `withdrawal` ledger row in one DB
  transaction, provider call after commit. A safe provider rejection refunds
  atomically. An ambiguous outcome holds the debit in
  `reconciliation_required` and **never** auto-refunds.
- Reconcile: `POST /api/payouts/requests/:id/reconcile`. Owners may reconcile
  their own payout; an admin token may reconcile any payout (for the admin
  queue). There is no background job; poll open payouts on your ops cadence.
- Provider terminal statuses are `SUCCESS`, `ERROR`, `FAILED`, `REJECTED`,
  `REVERSED`. The status amount and currency must match the reserved payout;
  a mismatch returns `409 PAYOUT_STATUS_AMOUNT_MISMATCH` /
  `PAYOUT_STATUS_CURRENCY_MISMATCH` and changes nothing — investigate by
  transfer ID, do not force a refund.
- `SUCCESS → REVERSED` is a documented Cashfree lifecycle. A reconcile of a
  `succeeded` payout that sees `REVERSED` atomically refunds the user, marks the
  payout `failed_refunded`, marks the withdrawal `reversed`, and writes a
  `…-REFUND` credit. A `FAILED`/`REJECTED`/`ERROR` after success is
  contradictory and returns `409 PAYOUT_STATUS_INCONSISTENT`; do not refund it
  automatically.
- If the refund account is missing, the route returns
  `500 PAYOUT_REFUND_ACCOUNT_MISSING`, rolls the claim back, and leaves the
  payout held. Restore the account (or repair the row), then reconcile again.
  Never mark it refunded by hand without a matching credit.
- Status meanings:
  - `reserving` / `reserved` — inside the submit route; owner reconcile returns
    202. If the process died after the reservation commit, an **admin** may
    reconcile a `reserved` row older than one hour; provider 404 releases the
    hold (refund + `failed_refunded`, withdrawal `cancelled`), provider record
    advances it normally. Never force this from a non-admin account.
  - `submitted` — provider accepted; poll. Provider 404 is not auto-refunded;
    verify the transfer ID in the provider dashboard before any manual action.
  - `succeeded` — completed; still eligible for a later reversal check.
  - `failed_refunded` — refunded and terminal.
  - `failed_unreserved` — debit never committed; terminal.
  - `reconciliation_required` — ambiguous; funds held; operator action needed.
- Admin queue: `GET /api/payouts/admin/requests?status=reconciliation_required`
  (Bearer admin token; returns 401 without one). Returns masked destinations and
  provider references. Use the reconcile endpoint with the admin token; do not
  edit balances directly.
- No payout webhook is implemented. Cashfree may offer payout webhooks, but
  enabling one will not update this system. Use the pull status API until a
  signature-verified, idempotent payout webhook is implemented and tested.

## Disable / rollback

Fastest safe disable (no data loss):

1. Remove `VB_COLLECTIONS_PROVIDER` and/or `VB_PAYOUT_PROVIDER` (or remove the
   corresponding client credentials) in Render and redeploy. Routes fail closed
   with 503; no new VBA or payout is issued.
2. Disable the collections webhook in Cashfree to stop retries. Existing
   `virtual_accounts`, `collection_events`, `payout_requests` and ledger rows
   stay intact.
3. Reconcile all non-terminal payouts before changing `CASHFREE_ENV`.
4. Code rollback: deploy the previous commit. All INR schema changes are
   additive; there is no down migration and no need to drop tables.
5. Do not delete `_migrations` rows, payout rows, collection events, or refund
   rows to "reset" a rail. That destroys the audit trail and can cause a second
   payout.

## Known limits / owner actions

- Cashfree sandbox and live onboarding are not complete; live settlement is
  unverified. The owner must activate both products, supply credentials, and
  run the sandbox acceptance test above before any live payout.
- No automatic payout reconciler or payout webhook. Add a scheduled reconciler
  (or an ops rota) before volume grows; the current endpoint is manual. The only
  automated stale-hold action is the admin-triggered one-hour `reserved` rule.
- A production service refuses sandbox credentials; sandbox acceptance requires
  a separate `NODE_ENV=staging` service. Do not remove this guard to "test" on
  production — sandbox ledger credits/payouts are not real money.
- Collections has no safe credential probe; `credentialValid` stays
  `"unverified"` until a real signed event is observed.
- The webhook does not enforce a timestamp freshness window. Replay is
  financially safe because event IDs and UTRs are unique and credits are
  guarded, but a captured event can still cause harmless duplicate DB work.
- The admin collections overview masks account numbers; if an operator needs
  the full provider-issued number, read it from Cashfree's dashboard, not from
  logs or tickets.
