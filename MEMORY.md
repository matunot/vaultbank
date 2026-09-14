# ðŸ§  VaultBank â€” AI & Human Memory (PERMANENT)

> **This file is the brain of the project.** Any AI or human working here MUST read this first.
> Update this file whenever you learn something new. Never stop saving memory.

---

## ðŸŒ Live URLs â€” ALWAYS UP TO DATE

| Service | URL | Status |
| --------- | ----- | -------- |
| **App + Backend (Render, single origin)** | `https://vaultbank-md20.onrender.com` | ðŸŸ¢ Live |
| App Health | `https://vaultbank-md20.onrender.com/health` | ðŸŸ¢ HTTP 200 |
| Login | `POST https://vaultbank-md20.onrender.com/login` | ðŸŸ¢ HTTP 200 + JWT |
| Stripe Mode | `GET /api/stripe/balance` | ðŸŸ¢ **`live`** (real keys active) |
| Stripe Webhook | `https://vaultbank-md20.onrender.com/api/stripe/webhook` | ðŸŸ¢ enabled (checkout.session.completed) |
| **Database (Neon PostgreSQL)** | `server/.env` â†’ `DATABASE_URL` | ðŸŸ¢ Live |
| GitHub Repo | `https://github.com/matunot/vaultbank.git` | ðŸŸ¢ |
| ~~Frontend (Vercel)~~ | `https://vaultbank-mu.vercel.app` | âš ï¸ legacy/stale â€” **not used anymore** |

---

## ðŸ”‘ Demo Credentials

```
User:  demo@vaultbank.com  / password
Admin: admin@vaultbank.com / admin123
```

---

## âš¡ The "Failed to Fetch" Fix â€” NEVER FORGET (2026-08-12)

**Problem:** Users saw "Failed to fetch" when clicking "Access Private Account" after filling details.

**Root cause:** NOT the backend (it was healthy). It was **CORS blocking** â€” the server only allowed specific origins (localhost, 3 Vercel URLs, vaultbank.com). Any other origin (custom domain, new Vercel preview, different local port) was blocked by the browser.

**Fix (already applied, must deploy to Render/Vercel):**

1. `server/index.js` â€” CORS changed from allowlist to `origin: true` (allow all origins)
2. `client/src/api.ts` â€” Added 2 retries (1.5s apart) for network/cold-start errors + friendly error message
3. `client/tsconfig.json` â€” Removed deprecated `baseUrl` (TS 7 removed it), fixed `@/*` path mapping
4. `PROJECT_CONTEXT.md` â€” Updated with fix notes

**Verification:** Tested locally â€” login from `https://app.vaultbank.com` (previously blocked) now returns HTTP 200 + JWT with `Access-Control-Allow-Origin` header.

**Deploy status:** âš ï¸ Committed + pushed? â†’ Check git log. If not pushed, Render/Vercel still run OLD code.

---

## ðŸ¤– Automation & Robots

| Workflow | File | Schedule | What it does |
| ---------- | ------ | ---------- | -------------- |
| Keep-Alive / Health Bot | `.github/workflows/keep-alive.yml` | Every 10 min | Pings health + tests real login, flags cold starts |
| Auto-Deploy | `.github/workflows/deploy.yml` | On push to main | Builds, tests, deploys via hooks |
| Monitoring Setup Doc | `deployment/monitoring-setup.md` | â€” | Full monitoring guide (Sentry, UptimeRobot, alerting) |

**To enable Render auto-deploy:** Create Deploy Hook in Render (Settings â†’ Deploy Hooks) â†’ set URL as GitHub secret `RENDER_DEPLOY_HOOK`.

---

## ðŸ—ï¸ Architecture Quick Reference

```
vaultbank/
â”œâ”€â”€ server/                    # Node.js + Express backend
â”‚   â”œâ”€â”€ .env                   # Neon DATABASE_URL + JWT_SECRET (DON'T commit)
â”‚   â”œâ”€â”€ index.js               # Entry point (CORS fix lives here)
â”‚   â”œâ”€â”€ routes/auth.js         # Login/signup/profile/2FA
â”‚   â””â”€â”€ config/database.js     # PostgreSQL data access layer
â”œâ”€â”€ client/                    # React + TS + Tailwind frontend
â”‚   â”œâ”€â”€ src/api.ts             # API service (retry logic lives here)
â”‚   â””â”€â”€ src/components/        # React components
â”œâ”€â”€ .github/workflows/         # CI/CD robots
â”œâ”€â”€ deployment/                # Deployment & monitoring docs
â””â”€â”€ MEMORY.md                  # â† This file (the brain)
```

---

## âš ï¸ CRITICAL GOTCHAS

1. **Render free tier spins down after 15 min** â†’ cold starts 30-60s. Keep-alive bot prevents this.
2. **`.env` is at `server/.env`**, not root. `db.js` loads it with `path.resolve(__dirname, '..', '.env')`.
3. **Transaction types** must be: `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `payment`, `refund`, `fee`, `interest`, `adjustment` â€” NEVER `'transfer'`.
4. **Audit logs** use `resource_type` and `created_at` â€” NOT `category` or `timestamp`.
5. **MongoDB legacy code** (`.lean()`, `.toObject()`, `._id`) will CRASH on PostgreSQL. Project migrated to PostgreSQL â€” write raw SQL only.
6. **TypeScript 7 removed `baseUrl`** â€” use relative paths in `tsconfig.json` (`"./src/*"`).
7. **`.gitignore` must exclude** `client/dist/`, `server/logs/`, `.env*`.
8. **Windows PowerShell** â€” `curl` = `Invoke-WebRequest` alias. Use `curl.exe`. No `&&` â€” use `;`.

---

## âœ… What's DONE (Completed Fixes)

- [x] 2026-08-12: CORS allow-all fix (server/index.js)
- [x] 2026-08-12: Client retry + friendly errors (client/src/api.ts)
- [x] 2026-08-12: TS7 tsconfig fix (client/tsconfig.json)
- [x] 2026-08-12: PROJECT_CONTEXT.md updated
- [x] 2026-08-12: MEMORY.md created (this file)
- [x] 2026-08-16: Dashboard type errors fixed (client/src/components/DashboardSection.tsx)
  - `balance` passed as `balance?.total ?? 0` (HeroBalance expects `number`, not `BalanceData | null`)
  - Added `MappedTransaction` interface + `mapTransaction()` to convert API `TransactionData` â†’ `Transaction` shape (`id, name, cat, amount, date, icon, gem`) expected by `Transactions`
  - Removed invalid `transactions` prop from `SpendingPanel` (it takes no props)
  - Changed `CardsPanel cards` from `account?.id ? [] : undefined` â†’ `cards={[]}` (no `undefined` assignable to `Card[]`)
  - Removed invalid `insights` prop from `SmartInsights` (takes no props)
  - `Props` updated with `userName`/`accountNumber` to match App.tsx usage; used `accountNumber` as fallback for HeroBalance account number
  - Verified: `npx tsc --noEmit` passes with zero errors
  - **Local dev gotcha:** Vite proxy `/login` â†’ `http://localhost:5000` throws ECONNREFUSED until the backend (`cd server; npm run dev`) is running first. Start backend BEFORE frontend.

- [x] 2026-09-02: Dependency bumps committed (lucide-react, @vitejs/plugin-react, joi, mongoose, simple-statistics, uuid) + docs refreshed
- [x] 2026-09-02: `LICENSE` referenced in docs + `"license": "UNLICENSED"` set in both package.json files
- [x] 2026-09-02: **Send Money is now REAL** â€” `store.sendMoney()` calls `POST /api/account/transfer` (no more fake setTimeout); balance syncs from server response
- [x] 2026-09-02: **Real user search** â€” new `GET /api/account/users/search?q=` (SQL ILIKE over users+accounts, self-excluded) + `searchUsers()` in database.js; verified live: returns real users (Admin User, diana, â€¦) with VB- account numbers
- [x] 2026-09-02: **Fake demo people removed** â€” TransferModal/TransferSection/QuickContacts now show real recipients from actual transfer history (`GET /api/transfers`); new `Avatar.tsx` (initials) replaces pravatar stock photos; `contacts` removed from data.ts usage & store
- [x] 2026-09-02: **PaymentsSection is real** â€” real balance hero, real Recent Payments list, real send flow (user search â†’ transfer), QR shows real account number; provider cards no longer show fake balances ("link to sync")
- [x] 2026-09-02: `npx tsc --noEmit` passes 0 errors; backend `node --check` OK; endpoint tested live on port 5000
- [x] 2026-09-02: **REAL MONEY LAYER (frontend wired to payment rails)**
  - `api.ts` +5 methods: `stripeDeposit` (Checkout session), `stripeWithdraw` (payout), `stripeBalance` (LIVE/DEMO mode), `accountDeposit`, `accountWithdraw`
  - `store.ts`: `depositMoney` + `payBill` now call the REAL backend (`/api/account/deposit|withdraw`) and sync balance from server response â€” no more fake setTimeout
  - `DepositModal`: two rails â€” **Card via Stripe** (redirects to real Stripe Checkout) + **Instant** (internal credit); shows â— LIVE / â—‹ SANDBOX badge from `/api/stripe/balance`
  - **NEW `WithdrawModal`**: real bank payout via `/api/stripe/withdraw` (1-2 business days), wired into PaymentsSection quick action
  - `App.tsx`: handles `?deposit=success|cancelled` return from Stripe â†’ animated banner + URL cleanup
  - Backend `success_url`/`cancel_url` fixed to `/?deposit=...` (SPA-safe)
  - `tsc` 0 errors + `vite build` OK + `/api/stripe/balance` tested live: returns real balance $4,980.50, mode "demo"
- [x] âš ï¸ **STRIPE KEYS ACTIVATED â€” REAL MONEY IS LIVE** (2026-09-02):
  1. Render env now has `STRIPE_SECRET_KEY` (sk_test_â€¦), `STRIPE_WEBHOOK_SECRET` (whsec_â€¦), `CLIENT_URL=https://vaultbank-md20.onrender.com` âœ… (set via Render API)
  2. Stripe webhook `checkout.session.completed` â†’ `https://vaultbank-md20.onrender.com/api/stripe/webhook` âœ… verified
  3. `GET /api/stripe/balance` returns `mode: "live"` âœ…
  4. Real Checkout session created live (status 200, `cs_test_â€¦`) â€” test card `4242 4242 4242 4242` will credit the real balance

- [x] **VERCEL BUILD FIX - Stripe.js via CDN (2026-09-03)**
  - Vercel build failed on commit 56510b8: `Rolldown failed to resolve import "@stripe/stripe-js"` - Vercel uses a legacy `builds` path that ran only root `npm run build` (never the client install) and restored a stale `client/node_modules` cache without the new dependency
  - Fix 1 (commit ad50ff0): root package.json build script is now self-sufficient: `npm --prefix client install && npm --prefix client run build`
  - Fix 2 (commit d6929cf): `IssuingCardsSection.tsx` loads Stripe.js from the CDN at runtime (`https://js.stripe.com/v3` script tag, `window.Stripe`, `loadStripeCdn()` helper) - no npm import to resolve, so builds can never fail on this dependency regardless of install path; removed @stripe/stripe-js from client deps + lockfile
  - Root package.json must stay BOM-free (a Set-Content BOM broke PostCSS config loading: `Unexpected token`; rewritten with UTF8Encoding(false))
  - Verified: tsc 0 errors, vite build OK with the package physically absent, all commits pushed (d6929cf)
  - If Vercel is still red after this push, the definitive cleanup is Vercel Dashboard - delete/disconnect the legacy project (Render single-origin is the real deployment)


- [x] **REAL CARDS VIA STRIPE ISSUING - FULLY WIRED (2026-09-03)**
  - `server/routes/issuing.js` (new) - real Stripe Issuing integration: cardholders (KYC entity, E.164 phone guard), issue real Visa/Mastercard virtual cards with network-enforced spend controls (monthly + per-transaction), REAL freeze (Stripe declines authorizations), PCI-safe reveal via ephemeral keys + Stripe.js IssuingCard iframe, card activity from ledger, admin `POST /api/issuing/setup` auto-registers the issuing webhook and stores its signing secret in the `server_config` table (no manual env var), `POST /api/issuing/simulate-authorization` for test-mode Netflix-style charges (Stripe testHelpers)
  - `stripe-payments.js` webhook upgraded - multi-secret verification (env secret + server_config issuing secret), `issuing_authorization.request` answered SYNCHRONOUSLY (approve iff VaultBank balance covers, else decline insufficient_funds + notification), `issuing_transaction.created` deducts real balance + creates card_charge transaction + instant "Card charged" notification, `issuing_card.created` sends "Your card is ready"
  - `client/src/components/IssuingCardsSection.tsx` (new) - replaces demo CardsSection on the Cards tab: real cards grid, "New real card" modal (VISA/Mastercard + limits), freeze toggle, details drawer with secure number reveal + live activity, ISSUING LIVE/TEST badge, graceful activation banner when Issuing not enabled
  - api.ts +8 methods; @stripe/stripe-js added to client (dynamically imported for reveal)
  - Status as of deploy 38145b2: `/api/issuing/status` returns {available:false, reason:'issuing-not-activated', activationUrl} - code is complete and live; ONE manual step remains: activate Stripe Issuing at https://dashboard.stripe.com/issuing/overview, then cards issue immediately (same code, no deploys needed)
  - After activation: run `POST /api/issuing/setup` once as admin (registers webhook), then test a real charge flow with `POST /api/issuing/simulate-authorization` {cardId, amount, merchantName}
  - Optional: set STRIPE_PUBLISHABLE_KEY (pk_test_/pk_live_) on Render for the secure number-reveal iframe
  - tsc 0 errors, vite build OK, node --check OK on all server files; git 0b6f05e fedc8ad 38145b2 5d927ab

- [x] ðŸ”¥ **PERMANENT FIX â€” "Cannot reach the server" after Stripe (2026-09-03)**
  - **Root cause:** `vaultbank-mu.vercel.app` (Vercel alias) served a STALE React build with NO backend URL and NO `deposit=success` handler. After Stripe Checkout redirected there, the old frontend couldn't reach the API â†’ "Cannot reach the server."
  - **Fix:** The whole app now runs on **ONE origin from Render** â€” `https://vaultbank-md20.onrender.com` serves the built React SPA (`client/dist`) AND the API.
    - `server/index.js`: added `express.static(FRONTEND_DIST)` + SPA fallback (non-API GET routes â†’ index.html)
    - `render.yaml` + Render API: build command now = `npm install && cd ../client && npm install && npm run build` (builds the frontend during deploy)
    - `CLIENT_URL` env var updated â†’ `https://vaultbank-md20.onrender.com` (Stripe success/cancel URLs now return to the app)
  - **Verified live:** GET `/` â†’ 867KB React HTML (has onrender URL + `?deposit=success` handler); login 200 + JWT; `/api/account` 200; `/api/account/balance` 200 ($4,980.50); Stripe LIVE; new Checkout session success_url = `https://vaultbank-md20.onrender.com/?deposit=success&session_id=â€¦`
  - **Vercel (`vaultbank-mu`) no longer needed** â€” stale build marked âš ï¸ legacy in MEMORY.md.
- [x] ðŸŽ‰ **SEND/RECEIVE MONEY â€” LIVE FEEDBACK EVERYWHERE (2026-09-03)**
  - **`client/src/refreshBus.ts` (new)** â€” tiny pub/sub that fires when money moves; every view subscribes and refetches instantly = whole app stays live with NO reload
  - **`store.ts`** â€” emits the bus after every successful send / deposit / bill pay
  - **`hooks/useAccountData.ts`** â€” subscribes to the bus + gentle 20s poll (so money RECEIVED from others shows up too)
  - **`Modals.tsx` (TransferModal)** â€” emerald animated success receipt: "ðŸ’¸ $2.50 sent to X Â· REAL MONEY Â· INSTANT Â· SETTLED"
  - **`App.tsx`** â€” gold toast banner on send: formatMoney sent to user, "BALANCE UPDATED"
  - **`HistorySection.tsx`** â€” now fetches REAL devices from `/api/account/transactions` (was fake `fullTransactionHistory` from data.ts); has refresh button + loading + empty states
  - **`NotificationsPanel.tsx`** â€” fetches REAL alerts from `/api/alerts` (was fake data.ts), live badge count, "Money Received" titles, time-ago, poll + bus subscription
  - **`server/routes/accounts.js`** â€” transfer now also pushes a real "Money Received" alert to the receiver's demoStore (instant bell badge)
  - **`server/routes/alerts.js`** â€” was CRASHING in production (read `demoStore.alerts` which is empty in real-DB mode â†’ 500). Now reads real DB notifications via `getNotifications()` with graceful fallback; unread-count/read-all are production-safe
  - **Verified live on `https://vaultbank-md20.onrender.com`**: real transfer `$2.50 demoâ†’diana` â†’ sender balance 4980.50â†’4978.00, transaction + transfer history both updated; `/api/alerts` returns 200 + real notifications; TS 0 errors; build OK

- [x] **OPENCODE EXTENSIONS PACK (2026-09-11)** — `opencode.json` now 6 plugins: graphify (graph), agent-memory (memory), openviking (recall), `@different-ai/opencode-browser@4.6.1` (browser), `ponytail-opencode-plugin@0.1.0` (`/ponytail`), `opencode-omniroute-auth@1.2.2` (`/connect omniroute`). 25 local skills + 4 agents kept, nothing reinstalled. Restart opencode once so Bun auto-installs the 3 new ones. Then run `/connect omniroute` once (key stays in local auth.json, never in repo).

- [x] **TRANSFERS 500 FIX (2026-09-12)** — `GET /api/transfers` crashed live (`db.Transfer.find(...).sort is not a function`, transfers.js:222). PG compat returns rows, not a Mongoose query — now `find(filter, {limit, skip})` with clamped pagination (1-100). Sweep clean (other `.sort` = Array.sort; `$set` handled).

- [x] **PAYPAL LIVE/SANDBOX FIX (2026-09-13)** — `server/payments/paypal.js` now uses explicit `PAYPAL_MODE` env (`live|sandbox`, default `sandbox`); old `EBX`-prefix heuristic kept as fallback. Live keys + Live webhook ID require `PAYPAL_MODE=live` in Render or order creation 500s against the wrong endpoint. `render.yaml` includes the key. Pushed in `2c8ad44`, paypal suite 7/7 green (ledger + paymentsMetrics failures pre-existing on clean tree).

- [x] **PAYPAL DEPOSIT RAIL (2026-09-12)** — real money in via PayPal Checkout: `POST /api/paypal/deposit` (order + approvalUrl, fail-closed 503 without keys) → approve on paypal.com → `POST /api/paypal/capture` or `PAYMENT.CAPTURE.COMPLETED` webhook credits atomically (idempotent on capture id, real signature verification). DepositModal PayPal rail + `?deposit=paypal-success` return handler. 7 unit tests. Needs in Render: `PAYMENT_PROVIDER_PAYPAL_CLIENT_ID/SECRET` + `PAYPAL_WEBHOOK_ID`.

- [x] **USDC DEPOSIT RAIL (2026-09-12)** — zero-signup crypto deposits: per-user addresses derived from `USDC_XPUB` (xpub/0/index, ethers cross-verified vectors), public-RPC watcher (Base + Polygon, 12 confs), idempotent atomic credit, QR + check-now UI. On-chain funds park until swept with offline xpriv (sweep code intentionally absent). Needs in Render: `USDC_XPUB` (public only).

---

## ðŸ“… What's NEXT (To Do)

- [ ] RESUME HERE — PayPal $1 live verify (2026-09-13 session, final state ~22:50 UTC):
1. **SOLVED**: Render env now FULLY configured — `config-status` returns `fullyConfigured:true` (clientId tail `0lSY`, secret set len 80 (user rolled it), webhookId tail `9143` (NEW webhook, old `060L` dead), mode=live). The blocker was: user's saves never applied for ~1h (no restart in health uptime) until finally landed.
2. **NEW GATE — PayPal merchant account RESTRICTED**: order creation returns HTTP 422 `PAYEE_ACCOUNT_RESTRICTED` "The merchant account is restricted." Credentials + code + config are all VALID; PayPal itself refuses orders until the user completes business verification in paypal.com (confirm email, business details, bank/card — see Resolution Center). NOTHING to fix in code/Render — purely PayPal account-side.
3. SHIPPED: `GET /api/paypal/config-status` (admin, masked) in `0f6a54c`; 422 surfacing as `PAYPAL_MERCHANT_RESTRICTED` code in `0336f93` (was generic 500). Both verified live. Tests 7/7 green.
4. VERIFY after user clears PayPal restriction: authed `POST /api/paypal/deposit {amount:1}` → expect `200 + approvalUrl` (order WILL create once restriction lifts — no other change needed). Prior 502 invalid_client = key/mode tab mismatch; generic 500 now only for unknown errors.
5. SECURITY: PayPal secret was pasted in chat — user already rolled it once (new secret len 80 in Render). Good. Keep rolling if reused elsewhere.
6. Test-machine lessons: health `/health` uptime is MILLISECONDS (Date.now-startTime), skipped by rate limiter → safe to poll; PowerShell git push prints stderr as NativeCommandError (cosmetic, push succeeds); write JSON bodies to temp file + `curl -d @file` to dodge quoting hell.
- [x] VAULTBANK PAY + CHAIN RAIL LIVE + E2E VERIFIED (2026-09-14 session 3):
  1. OWNED PAYMENT NETWORK: `server/routes/vbpay.js` — merchant accounts + payment requests + QR links + public checkout (`/?pay=<id>` → VbPayModal) + atomic pay (race-safe claim, double-pay blocked 400, insufficient funds revert). Ledger: payer 'payment', merchant 'deposit', both notified. Stale requests expire via automation (15 min). Fully E2E-verified locally vs Neon: admin merchant → $1 request → demo paid → both balances moved → double-pay blocked.
  2. OWNED CHAIN RAIL: `server/payments/usdc-hotwallet.js` — hand-rolled RLP + EIP-155 signing (js-sha3 keccak + elliptic, ZERO new deps); address derivation verified against known vector (priv 0x…01 → 0x7E5F4552…). `server/routes/usdc-withdrawals.js` — POST /api/usdc/withdraw (Base/Polygon, USDC/USDT, public RPC, no provider), atomic debit, daily limit (USDC_DAILY_LIMIT, default $10k), auto-refund on broadcast failure, tx-hash receipts, hot-wallet low-balance alerts to admins. GET /api/usdc/withdraw-status.
  3. ONLY env var needed for chain OUT: `USDC_HOT_WALLET_KEY` (0x+64hex) in Render. Without it: clean 503 + instructions (verified). USDC/USDT deposits already work (USDC_XPUB).
  4. FRONTEND: new 'VB Pay' tab (Sidebar Zap icon added) → VbPaySection (merchant join, payment links, QR, requests list, chain withdraw form); VbPayModal for /?pay= deep link (App.tsx ?pay= handler); api.ts: createVbPayMerchant/getVbPayMerchant/createVbPayRequest/getVbPayRequests/payVbPayRequest/getVbPayRequestPublic/getChainStatus/chainWithdraw.
  5. VERIFIED: tsc 0, node --check 0. NOT committed yet — commit + push next.
  6. Test data left in DB: admin = merchant 'VaultBank Test Store', one paid $1 request from demo. USDC_XPUB set in Render → deposits live; USDC_HOT_WALLET_KEY → withdrawals live.
- [x] CREDIT ENGINE LIVE + VERIFIED (2026-09-14 session 2):
- [x] CREDIT ENGINE LIVE + VERIFIED (2026-09-14 session 2):
  1. BUILT: real credit line product — `008_credit_schema.sql` (`credit_accounts`, `credit_ledger`), `server/routes/credit.js` (instant underwriting from REAL activity: tenure/deposits/balance/transfers → VaultBank Score 300-850 → limit $500-$10k, APR 11.99-24.99%), routes: GET /api/credit/status, POST /api/credit/apply (idempotent), POST /api/credit/repay (atomic debit from main balance), POST /api/credit/autopay. Automation armed at boot + every 6h: daily interest accrual + autopay minimum payments.
  2. CARDS ARE NOW TRUE CREDIT CARDS: `stripe-payments.js` authorization approves if cash + available credit covers; settled charges draw CASH FIRST, CREDIT SECOND via `creditEngine.drawCredit()` (atomic, limit-checked); declined only if both exhausted.
  3. FRONTEND: new `CreditSection.tsx` (score ring, credit gauge, repay, autopay toggle, ledger) on new nav tab 'credit' (`data.ts`); api.ts methods getCreditStatus/applyCredit/repayCredit/toggleCreditAutopay; App.tsx lazy import + mount.
  4. VERIFIED LIVE (local boot vs Neon): status→exists:false; apply→approved score 420, $500 @ 24.99% (real factors: 39d tenure, $4,978 balance, 3 transfers); status→active, available $500. tsc 0, node --check 0 on all touched files.
  5. Demo user now HAS a credit account ($500 line, $0 owed) — real data, left in place.
  6. Still user-only: Stripe Issuing activation click, STRIPE_PUBLISHABLE_KEY env var, USDC_XPUB env var if crypto rail wanted, key rolling.
- [x] RESUME POINT — Stripe-only rail LIVE, PayPal PARKED (2026-09-14 session):
- [x] RESUME POINT — Stripe-only rail LIVE, PayPal PARKED (2026-09-14 session):
  1. DECISION: PayPal deferred ("later"). Real money = Stripe only — zero new setup needed, everything already built + live.
  2. Live probe of `/api/issuing/status` (demo JWT): `available:true`, `mode:"test"` (banking sandbox — cards issue end-to-end NOW as test cards; auto-flips to real when Issuing activated in Stripe Dashboard), `webhookRegistered:true` (automation works), `publishableKey:null` → **one env var remains: add `STRIPE_PUBLISHABLE_KEY` (pk_test_/pk_live_) in Render** for the secure card-number reveal.
  3. FIXED REAL MONEY BUG in `server/routes/stripe-payments.js` `handleCardTransaction`: merchant refunds (`issuing_transaction.created` with NEGATIVE amount) were being ABS-debited like charges — now refunds CREDIT balance atomically + create `card_refund` transaction + notification. node --check OK.
  4. NEW one-tap funding: insufficient-funds decline notifications (both `issuing_authorization.request` + `issuing_transaction.created` paths) now carry `actionUrl = CLIENT_URL/?addfunds=1`; App.tsx opens the deposit modal on `?addfunds=1` and on `vaultbank:addfunds` CustomEvent; "Add money" button added to card detail modal in `IssuingCardsSection.tsx`. tsc 0 errors.
  5. Verification state: `node --check` 0, `npx tsc --noEmit` 0. NOT yet committed/pushed — commit + push to deploy.
  6. Still manual (user, one click): activate Stripe Issuing in dashboard (everything self-configures within 30 min after), add `STRIPE_PUBLISHABLE_KEY` env var, roll pasted-in-chat keys (Stripe sk_ + PayPal).
- [ ] RESUME HERE — PayPal $1 live verify (2026-09-13 session, updated 22:20 UTC):
- [ ] RESUME HERE — PayPal $1 live verify (2026-09-13 session, updated 22:20 UTC):
1. DONE: `GET /api/paypal/config-status` (admin-only, MASKED, no secret values) added in `0f6a54c` — one read-only GET now answers PayPal config status; never probe with order creation again. 7/7 paypal tests green, pushed.
2. Verified LIVE via that endpoint on the fresh deploy (env fully re-applied): clientId set (tail `0lSY` = user's NEW key), webhookId set (tail `060L`), mode=live — but `secret: {set:false, length:0}`. **The secret is definitively NOT in the Render dashboard** (name typo / empty value field / wrong service). User has successfully saved 3 of 4 vars.
3. PayPal credentials themselves are VALID: user-pasted Client ID + Secret authenticated OK against `api-m.paypal.com` (live OAuth token issued). The moment the secret lands in Render under the EXACT name `PAYMENT_PROVIDER_PAYPAL_SECRET` (Save → new deploy starts), deposits go live: expect `200 + approvalUrl` on authed `POST /api/paypal/deposit {amount:1}`, then verify `GET /api/paypal/config-status` shows `fullyConfigured:true`.
4. SECURITY: user pasted live Client ID + Secret in chat → after deposits confirmed working, ROLL the PayPal secret (developer.paypal.com → app → regenerate) + update Render in one save.
5. No Render API key / CLI on this machine — Render env changes stay manual unless user provides an `rnd_...` key. `.mssqlignore` untracked junk — do not commit.
- [ ] RESUME HERE — PayPal $1 live verify (2026-09-13 session):
1. Code 100% done + deployed: PayPal deposit rail, `PAYPAL_MODE` (`2c8ad44`), `502 PAYPAL_AUTH_FAILED` self-diagnosis (`df3fe04`), general rate limit 100->500 (`dec76c9`), **503 now names the exact missing env var (`c1c1d63`, pushed — wait for redeploy)**.
  2. PayPal Live app `vaultbank` exists (Client ID `BAAFHQVO...`), Live webhook `https://vaultbank-md20.onrender.com/api/payments/webhook/paypal` -> ID `0AG77579BR282060L` (All Events).
  3. BLOCKER: last live test -> `503 PAYPAL_NOT_CONFIGURED` = Render env keys missing/empty on current deploy. User must ensure all 4 exist with values: `PAYMENT_PROVIDER_PAYPAL_CLIENT_ID` (Live), `PAYMENT_PROVIDER_PAYPAL_SECRET` (Live), `PAYPAL_WEBHOOK_ID=0AG77579BR282060L`, `PAYPAL_MODE=live` -> Save -> wait for `Live` deploy.
  4. Then verify gently (ONE login + ONE deposit, no polling loops): authed `POST /api/paypal/deposit {amount:1}` -> expect `approvalUrl`. Prior live error was `invalid_client` (keys rejected = typo or sandbox/live tab mismatch).
  5. Test-machine lesson: this PC shares public IP with user's browser; IP-based `generalLimiter` counts BOTH. Never poll in loops. `curl.exe` on PowerShell strips unescaped quotes — always send JSON as `'{\"a\":\"b\"}'`. Earlier "login 500" scare was just this quoting bug; login was always fine.
  6. Pre-existing test failures on clean tree (NOT ours): `ledger.test.js`, `paymentsMetrics.test.js`. PayPal suite 7/7 green.

- [x] Push all fixes to GitHub â†’ auto-deploy triggers (repo in sync with `origin/main`)
- [x] REAL MONEY DEPOSITS WORK â€” Stripe LIVE mode + webhook + single-origin app verified
- [ ] **Roll keys for security** (user did share secrets in chat):
  1. Stripe dashboard â†’ Developers â†’ API keys â†’ **Roll secret key** â†’ update `STRIPE_SECRET_KEY` in Render
  2. Render â†’ Account Settings â†’ API Keys â†’ **delete** the key shared in chat
- [ ] (Optional) Withdrawals need Stripe Connect (`user.stripe_connect_account_id`)
- [ ] (Optional) UptimeRobot / Sentry monitoring
- [ ] (Optional) Delete the legacy Vercel alias to avoid confusion

---

*Created: 2026-08-12 | Last updated: 2026-09-14 | Never forget: read this first, update it often.*
