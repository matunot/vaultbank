# 🏦 VaultBank — Project Context

> The single source of truth for anyone (AI or human) working on this project.
> Read this first, then `MEMORY.md` and the runbooks it links to.
> Last rewritten: 2026-11-05 (previous version described the retired provider era).

---

## 1. What VaultBank is

A banking application built on a **VaultBank-owned double-entry ledger** in
PostgreSQL. Customer money is recorded and moved by VaultBank itself; no
third-party processor is authoritative for a balance.

Two deployment facts override everything else you may read elsewhere:

1. **One origin:** `https://vaultbank-md20.onrender.com` serves both the React
   SPA (`client/dist`) and the API (Render, `workingDirectory: server`).
2. **Native-only in production:** when `NODE_ENV=production`, legacy provider
   money adapters (Stripe deposits/payouts, PayPal, Cashfree, Nium) are
   hard-disabled regardless of environment variables. They fail closed with
   explicit `*_NOT_CONFIGURED` codes.

The Vercel alias (`vaultbank-mu.vercel.app`) is a frozen old frontend. Ignore it.

### Honest boundary

VaultBank is **not** currently authorised to take deposits, issue cards, or lend
in any jurisdiction on the strength of this software. Card and loan applications
are request queues that park at `waiting_for_issuer` / `funding_required`.
Prerequisites are enumerated in [`docs/cards-and-lending-prerequisites.md`](./docs/cards-and-lending-prerequisites.md).
A software licence cannot grant a banking licence.

---

## 2. Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 24 + Express 5 |
| Database | PostgreSQL (Neon cloud) |
| Ledger | VaultBank double-entry journal (`013`/`016` migrations) |
| Frontend | React 19 + TypeScript 7 + Tailwind 4 + Framer Motion |
| Build | Vite 8 + `vite-plugin-singlefile` (single `dist/index.html`) |
| Auth | JWT + email verification + admin-approved KYC |
| Deploy | Render (build also compiles the client) |

---

## 3. What actually works today

### Money movement (real, ledger-backed)

| Flow | Status | Evidence |
| --- | --- | --- |
| User→user transfer (USD, INR) | ✅ Live | atomic `BEGIN…COMMIT`, idempotency key required |
| VBR payment intents (internal only) | ✅ Live | `server/vbr/*`, `payment_intents` |
| Savings vaults (USD/INR) | ✅ Live | ledger postings, no advertised APY |
| Additional currencies (AED GBP EUR CAD AUD SGD NZD CHF HKD) | ⚙️ Registered, **disabled** | needs `VB_MULTICURRENCY_ENABLED=true` + a real receiving account per code; no FX exists |
| Bank-transfer deposits | ⚙️ Code ready, **off** | credit only after admin matches the official bank statement |
| Direct UPI deposits (INR) | ⚙️ Configured, manual verification | admin matches amount + unique UTR |
| Manual bank payouts (INR) | ⚙️ Configured, manual operator transfer | beneficiary details AES-256-GCM encrypted; refund only after evidence |
| USD ACH payout | ⚙️ File export only | no network submission, no ODFI profile |
| USDC/USDT deposits + withdrawals | ❌ 503 | hot wallet unfunded (balance 0, nonce 0) |

### Customer/product surface

- Signup, login, email verification, profile, password change, 2FA code paths.
- Dashboard, transfers, transaction history, notifications (real API-backed).
- KYC upload + review (bytes stored in PostgreSQL, admin-approved).
- Card program requests and loan applications with admin review queues.
- Savings vaults; multi-currency wallets.
- Admin queues for KYC, card/loan applications, bank deposits, direct UPI,
  manual payouts, USD ACH — all mounted inside `PaymentsSection` for admins.

### Deliberately absent

- Card PAN/CVV issuance, card authorisation, credit decisioning, loan
  disbursement, interest accrual on customer credit.
- FX conversion of any kind.
- Automatic external settlement of any kind.
- Investment/trading execution, rewards ledger, budget engine (the UI shows a
  "not connected" notice for these in production).

---

## 4. Verification commands

```powershell
# Backend unit/integration battery (server/)
npm test -- --runInBand --forceExit

# Client typecheck + production build (client/)
npx tsc --noEmit
npm run build

# Live deployment: health + Postgres readiness + SPA + rail readiness + fail-closed webhooks
node scripts/verify-deploy.js
node scripts/verify-deploy.js http://localhost:5000

# Read-only chain readiness (never signs, never prints key material)
node scripts/probe-chain.js base <hot-wallet-address>
```

Baseline after the 2026-11-05 cleanup: **42/42 suites, 396/396 tests** (see
`MEMORY.md` for the exact commit once pushed).

---

## 5. Rules that prevent real losses

1. **`.env` lives at `server/.env`.** Never at the repo root. Template:
   `server/.env.example` (tracked, placeholders only).
2. **PostgreSQL only.** No `.lean()`, `.toObject()`, `._id`. Use `db.query()`
   with `$1, $2` positional parameters.
3. **Transaction types** are constrained by migration `007`
   (`deposit|withdrawal|transfer_in|transfer_out|payment|refund|fee|interest|adjustment|stripe_deposit|stripe_withdrawal|card_charge|card_refund`).
   Never a bare `transfer`.
4. **`audit_logs`** columns: `action, resource_type, resource_id, details,
   ip_address, user_agent, created_at`. No `category`, no `timestamp`.
5. **Debit atomically:**
   `UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING *`
   A missing row means insufficient funds — never compute the new balance in JS
   and write it back.
6. **Ambiguous external outcomes are never auto-refunded.** They become
   `reconciliation_required` and wait for a human with statement evidence.
7. **Idempotency keys belong to one attempt.** Reuse the same key on retry; never
   mint a new one for the same intended transfer.
8. **No secrets in git, memory, graph, or chat.** Real financial details,
   encryption keys, and provider credentials go in the deployment secret store.

---

## 6. Where to look next

| Topic | Document |
| --- | --- |
| Native rails, config, reconciliation rules | `INR_RAILS_RUNBOOK.md` |
| Direct UPI + manual payout pilot controls | `DIRECT_RAILS_RUNBOOK.md` |
| Held funds, incidents, backup/restore, deploy checks | `RECONCILIATION_RUNBOOK.md` |
| Card/lending prerequisites and disabled behaviour | `docs/cards-and-lending-prerequisites.md` |
| Agent working rules | `AGENTS.md` |
| Persistent session memory | `MEMORY.md` |

---

*Created 2026-08-10 · Rewritten 2026-11-05 to reflect native-ledger reality.*
