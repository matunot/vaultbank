# VaultBank — Money-Movement Operations Runbook

Covers the processes that can hold or move money, the tooling that keeps them
reconciled, and the checks to run after every deploy. Everything here reflects
the code as of commit `0babcfd` (and later).

---

## 1. Where money can sit in an ambiguous state

| Rail | Hold status | What it means | Customer funds debited? |
|---|---|---|---|
| Chain withdrawal (`usdc_withdrawals`) | `reconciliation_required` | Broadcast went out but the outcome could not be proven (RPC died, unknown error, already-known tx). Auto-refund is FORBIDDEN here — a double payout is possible if the tx actually mined. | Yes |
| Provider payout (`provider_payouts`) | `reconciliation_required` | Provider returned unknown status, or a partial return was reported. | No (provider-money rows; the `accounts` ledger is never touched by webhook processing) |

A normal successful withdrawal rests in `broadcast` (tx hash persisted) until
an operator confirms the mined receipt via the reconciler (`--apply` marks it
`succeeded`). This is expected state, not an incident.

## 2. Operator alerting (armed automatically in production)

- Hot-wallet low-balance loop — every 30 min, prod only.
- Held-funds loop (`monitorWithdrawalHolds`, `server/routes/usdc-withdrawals.js`)
  — every 30 min, prod only, pages every admin once per unresolved row per
  process lifetime (dedupe is in-memory; a restart re-alerts once).
- TEST MODE never pages and never queries the production tables.
- Boot log confirms arming: `HOT-WALLET + HELD-FUNDS MONITORS ARMED`.

Queue checks (read-only, run against production):

```sql
SELECT id, user_id, amount, token, network, tx_hash, created_at
FROM usdc_withdrawals WHERE status = 'reconciliation_required' ORDER BY created_at;

SELECT provider, request_id, payment_id, status, sub_status, rfi_open, last_event_at
FROM provider_payouts WHERE status = 'reconciliation_required' ORDER BY last_event_at;
```

## 3. Reconciling chain withdrawal holds

`server/scripts/reconcile-withdrawals.js` — dry-run by default; refuses to run
in test mode; production table only. From `server/`:

```powershell
# 1. REVIEW (default): fetches receipt evidence for held/mined rows, prints
#    APPLY / REFUND CANDIDATE verdicts, writes nothing.
node scripts/reconcile-withdrawals.js

# 2. CONFIRM mined rows: every held row whose on-chain receipt status === 1
#    is marked 'succeeded' (money legitimately left the hot wallet).
node scripts/reconcile-withdrawals.js --apply

# 3. REFUND a row whose broadcast provably never landed:
node scripts/reconcile-withdrawals.js --refund-id <withdrawal-uuid>
```

Guard rails enforced by the script and by `--refund-id`:

- refuses any row whose tx hash shows a mined receipt (use `--apply` instead);
- refuses any row that already has a ledger withdrawal entry (checks by tx
  hash to survive manual fixes);
- refund ledger writes are idempotent (`recon:<withdrawalId>` external
  reference) so a re-run cannot double-refund;
- every action is audit-logged (`usdc_withdrawal_reconciliation`, `_refund`).

Decision rule: receipt mined → `--apply`; no receipt AND no ledger entry →
`--refund-id`. Anything between (e.g. receipt status not 0x1, RPC unreachable)
stays held — escalate to the provider/infra owner, never guess.

## 4. Provider payout failure recovery (Nium)

Webhook processing (`server/routes/provider-webhooks.js`) is authenticated
(`x-api-key`, constant-time, checked before any DB work), deduplicated on
`(provider, event_id)`, and guarded by a monotonic rank map so a payout can
never regress out of a terminal state:

```
pending(1) < processing(2) < succeeded/failed/refunded(4) < reconciliation_required(5)
```

Same-rank movement is limited to in-place refreshes, or refunded /
reconciliation-after-paid. `partial_return_details` on `RETURNED` forces
`reconciliation_required` (money split back to treasury — an operator decides);
a plain `RETURNED` is a full return → `refunded`; `REJECTED`/`CANCELLED` →
`failed`/`refunded`; `rfi_open` is set on `INFO_REQUESTED`.

Remediation for provider holds (no customer balances involved):

1. Pull the payout from the provider's dashboard/API (`GET /api/v1/payments/id/{id}`)
   and compare with `provider_webhook_events` for that `payment_id`.
2. Record the corrected status with the provider event that justifies it
   (their dashboard actions normally generate authoritative webhooks).
3. Investigate unknown-status events before trusting corrections; an
   unrecognized status is held, never auto-terminalized.
4. Treasury funding (`POST /api/v1/fund/create`, `providers/nium.js`)
   exists for operator funding entries only — never for customer records.

## 5. Backup & restore

```powershell
# Back up (writes backups\backup-<timestamp>.sql(.gz); needs pg_dump local)
cd server; node scripts/backup.js

# Restore — DESTRUCTIVE, requires explicit confirmation; aborts on the first
# failed SQL statement (ON_ERROR_STOP), so partial restores never report success.
node scripts/restore.js backups\backup-<timestamp>.sql.gz --yes
```

Pre-restore discipline: take a fresh backup first, stop writers (Render
service on any replica), verify psql exists, and restore into a scratch
destination/environment before the final prod restore. Restore correctness
is not covered by automated tests — every real restore must be verified with
the row-count spot-checks below:

```sql
SELECT count(*) FROM accounts;
SELECT count(*) FROM transactions;
SELECT count(*) FROM usdc_withdrawals WHERE status IN ('broadcast','reconciliation_required');
```

## 6. Deploy verification

After every deploy (Render auto-deploys on push; cold start 30–60 s):

```powershell
node scripts/verify-deploy.js                          # live deployment
node scripts/verify-deploy.js http://localhost:5000    # local instance
```

PASS = health 200 with `authProbe: ok`, SPA shell served, and the provider
webhook route rejecting an unsigned POST with 401 (fail-closed posture; a 404
means an old build without the provider surface).

## 7. Nium sandbox smoke (when credentials exist)

```powershell
cd server
node scripts/nium-sandbox-smoke.js --app-url https://<deploy-url>
```

Refuses to run unless `NIUM_ENV=sandbox` plus a credential pair (never
exercises live money). Steps printed with exact provider responses: auth →
sample payout create → status poll → webhook pipeline against the app
(wrong-key 401, valid accept, replay dedupe, terminal) → `provider_payouts`
persistence check. Exit 0 all green, 2 partial (app/DB steps unavailable),
1 provider rejected a payload (read its validation message verbatim).

## 8. Ops cadence

- **Every deploy:** run `verify-deploy.js`; confirm boot log shows both
  monitors armed.
- **Daily:** zero open rows in the two hold queues of §2; if non-zero, §3/§4.
- **Weekly:** skim audit actions `usdc_withdrawal_*` in `audit_logs` and
  `provider_webhook_events` foreign/partition patterns; confirm no held row
  older than one week without an owners decision.
- **Before enabling live payouts:** explicit operator switch (provider envs),
  contract review, and a signed sign-off that VaultBank's business model is
  approved by the provider — credentials alone are not authorization.
