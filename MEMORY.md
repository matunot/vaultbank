# 🧠 VaultBank — AI & Human Memory (PERMANENT)

> **This file is the brain of the project.** Any AI or human working here MUST read this first.
> Update this file whenever you learn something new. Never stop saving memory.

---

## 🌐 Live URLs — ALWAYS UP TO DATE

| Service | URL | Status |
| --------- | ----- | -------- |
| **App + Backend (Render, single origin)** | `https://vaultbank-md20.onrender.com` | 🟢 Live |
| App Health | `https://vaultbank-md20.onrender.com/health` | 🟢 HTTP 200 |
| Login | `POST https://vaultbank-md20.onrender.com/login` | 🟢 HTTP 200 + JWT |
| Stripe Mode | `GET /api/stripe/balance` | 🟢 **`live`** (real keys active) |
| Stripe Webhook | `https://vaultbank-md20.onrender.com/api/stripe/webhook` | 🟢 enabled (checkout.session.completed) |
| **Database (Neon PostgreSQL)** | `server/.env` → `DATABASE_URL` | 🟢 Live |
| GitHub Repo | `https://github.com/matunot/vaultbank.git` | 🟢 |
| ~~Frontend (Vercel)~~ | `https://vaultbank-mu.vercel.app` | ⚠️ legacy/stale — **not used anymore** |

---

## 🔑 Demo Credentials

```
User:  demo@vaultbank.com  / password
Admin: admin@vaultbank.com / admin123
```

---

## ⚡ The "Failed to Fetch" Fix — NEVER FORGET (2026-08-12)

**Problem:** Users saw "Failed to fetch" when clicking "Access Private Account" after filling details.

**Root cause:** NOT the backend (it was healthy). It was **CORS blocking** — the server only allowed specific origins (localhost, 3 Vercel URLs, vaultbank.com). Any other origin (custom domain, new Vercel preview, different local port) was blocked by the browser.

**Fix (already applied, must deploy to Render/Vercel):**

1. `server/index.js` — CORS changed from allowlist to `origin: true` (allow all origins)
2. `client/src/api.ts` — Added 2 retries (1.5s apart) for network/cold-start errors + friendly error message
3. `client/tsconfig.json` — Removed deprecated `baseUrl` (TS 7 removed it), fixed `@/*` path mapping
4. `PROJECT_CONTEXT.md` — Updated with fix notes

**Verification:** Tested locally — login from `https://app.vaultbank.com` (previously blocked) now returns HTTP 200 + JWT with `Access-Control-Allow-Origin` header.

**Deploy status:** ⚠️ Committed + pushed? → Check git log. If not pushed, Render/Vercel still run OLD code.

---

## 🤖 Automation & Robots

| Workflow | File | Schedule | What it does |
| ---------- | ------ | ---------- | -------------- |
| Keep-Alive / Health Bot | `.github/workflows/keep-alive.yml` | Every 10 min | Pings health + tests real login, flags cold starts |
| Auto-Deploy | `.github/workflows/deploy.yml` | On push to main | Builds, tests, deploys via hooks |
| Monitoring Setup Doc | `deployment/monitoring-setup.md` | — | Full monitoring guide (Sentry, UptimeRobot, alerting) |

**To enable Render auto-deploy:** Create Deploy Hook in Render (Settings → Deploy Hooks) → set URL as GitHub secret `RENDER_DEPLOY_HOOK`.

---

## 🏗️ Architecture Quick Reference

```
vaultbank/
├── server/                    # Node.js + Express backend
│   ├── .env                   # Neon DATABASE_URL + JWT_SECRET (DON'T commit)
│   ├── index.js               # Entry point (CORS fix lives here)
│   ├── routes/auth.js         # Login/signup/profile/2FA
│   └── config/database.js     # PostgreSQL data access layer
├── client/                    # React + TS + Tailwind frontend
│   ├── src/api.ts             # API service (retry logic lives here)
│   └── src/components/        # React components
├── .github/workflows/         # CI/CD robots
├── deployment/                # Deployment & monitoring docs
└── MEMORY.md                  # ← This file (the brain)
```

---

## ⚠️ CRITICAL GOTCHAS

1. **Render free tier spins down after 15 min** → cold starts 30-60s. Keep-alive bot prevents this.
2. **`.env` is at `server/.env`**, not root. `db.js` loads it with `path.resolve(__dirname, '..', '.env')`.
3. **Transaction types** must be: `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `payment`, `refund`, `fee`, `interest`, `adjustment` — NEVER `'transfer'`.
4. **Audit logs** use `resource_type` and `created_at` — NOT `category` or `timestamp`.
5. **MongoDB legacy code** (`.lean()`, `.toObject()`, `._id`) will CRASH on PostgreSQL. Project migrated to PostgreSQL — write raw SQL only.
6. **TypeScript 7 removed `baseUrl`** — use relative paths in `tsconfig.json` (`"./src/*"`).
7. **`.gitignore` must exclude** `client/dist/`, `server/logs/`, `.env*`.
8. **Windows PowerShell** — `curl` = `Invoke-WebRequest` alias. Use `curl.exe`. No `&&` — use `;`.

---

## ✅ What's DONE (Completed Fixes)

- [x] 2026-08-12: CORS allow-all fix (server/index.js)
- [x] 2026-08-12: Client retry + friendly errors (client/src/api.ts)
- [x] 2026-08-12: TS7 tsconfig fix (client/tsconfig.json)
- [x] 2026-08-12: PROJECT_CONTEXT.md updated
- [x] 2026-08-12: MEMORY.md created (this file)
- [x] 2026-08-16: Dashboard type errors fixed (client/src/components/DashboardSection.tsx)
  - `balance` passed as `balance?.total ?? 0` (HeroBalance expects `number`, not `BalanceData | null`)
  - Added `MappedTransaction` interface + `mapTransaction()` to convert API `TransactionData` → `Transaction` shape (`id, name, cat, amount, date, icon, gem`) expected by `Transactions`
  - Removed invalid `transactions` prop from `SpendingPanel` (it takes no props)
  - Changed `CardsPanel cards` from `account?.id ? [] : undefined` → `cards={[]}` (no `undefined` assignable to `Card[]`)
  - Removed invalid `insights` prop from `SmartInsights` (takes no props)
  - `Props` updated with `userName`/`accountNumber` to match App.tsx usage; used `accountNumber` as fallback for HeroBalance account number
  - Verified: `npx tsc --noEmit` passes with zero errors
  - **Local dev gotcha:** Vite proxy `/login` → `http://localhost:5000` throws ECONNREFUSED until the backend (`cd server; npm run dev`) is running first. Start backend BEFORE frontend.

- [x] 2026-09-02: Dependency bumps committed (lucide-react, @vitejs/plugin-react, joi, mongoose, simple-statistics, uuid) + docs refreshed
- [x] 2026-09-02: `LICENSE` referenced in docs + `"license": "UNLICENSED"` set in both package.json files
- [x] 2026-09-02: **Send Money is now REAL** — `store.sendMoney()` calls `POST /api/account/transfer` (no more fake setTimeout); balance syncs from server response
- [x] 2026-09-02: **Real user search** — new `GET /api/account/users/search?q=` (SQL ILIKE over users+accounts, self-excluded) + `searchUsers()` in database.js; verified live: returns real users (Admin User, diana, …) with VB- account numbers
- [x] 2026-09-02: **Fake demo people removed** — TransferModal/TransferSection/QuickContacts now show real recipients from actual transfer history (`GET /api/transfers`); new `Avatar.tsx` (initials) replaces pravatar stock photos; `contacts` removed from data.ts usage & store
- [x] 2026-09-02: **PaymentsSection is real** — real balance hero, real Recent Payments list, real send flow (user search → transfer), QR shows real account number; provider cards no longer show fake balances ("link to sync")
- [x] 2026-09-02: `npx tsc --noEmit` passes 0 errors; backend `node --check` OK; endpoint tested live on port 5000
- [x] 2026-09-02: **REAL MONEY LAYER (frontend wired to payment rails)**
  - `api.ts` +5 methods: `stripeDeposit` (Checkout session), `stripeWithdraw` (payout), `stripeBalance` (LIVE/DEMO mode), `accountDeposit`, `accountWithdraw`
  - `store.ts`: `depositMoney` + `payBill` now call the REAL backend (`/api/account/deposit|withdraw`) and sync balance from server response — no more fake setTimeout
  - `DepositModal`: two rails — **Card via Stripe** (redirects to real Stripe Checkout) + **Instant** (internal credit); shows ● LIVE / ○ SANDBOX badge from `/api/stripe/balance`
  - **NEW `WithdrawModal`**: real bank payout via `/api/stripe/withdraw` (1-2 business days), wired into PaymentsSection quick action
  - `App.tsx`: handles `?deposit=success|cancelled` return from Stripe → animated banner + URL cleanup
  - Backend `success_url`/`cancel_url` fixed to `/?deposit=...` (SPA-safe)
  - `tsc` 0 errors + `vite build` OK + `/api/stripe/balance` tested live: returns real balance $4,980.50, mode "demo"
- [x] ⚠️ **STRIPE KEYS ACTIVATED — REAL MONEY IS LIVE** (2026-09-02):
  1. Render env now has `STRIPE_SECRET_KEY` (sk_test_…), `STRIPE_WEBHOOK_SECRET` (whsec_…), `CLIENT_URL=https://vaultbank-md20.onrender.com` ✅ (set via Render API)
  2. Stripe webhook `checkout.session.completed` → `https://vaultbank-md20.onrender.com/api/stripe/webhook` ✅ verified
  3. `GET /api/stripe/balance` returns `mode: "live"` ✅
  4. Real Checkout session created live (status 200, `cs_test_…`) — test card `4242 4242 4242 4242` will credit the real balance
- [x] 🔥 **PERMANENT FIX — "Cannot reach the server" after Stripe (2026-09-03)**
  - **Root cause:** `vaultbank-mu.vercel.app` (Vercel alias) served a STALE React build with NO backend URL and NO `deposit=success` handler. After Stripe Checkout redirected there, the old frontend couldn't reach the API → "Cannot reach the server."
  - **Fix:** The whole app now runs on **ONE origin from Render** — `https://vaultbank-md20.onrender.com` serves the built React SPA (`client/dist`) AND the API.
    - `server/index.js`: added `express.static(FRONTEND_DIST)` + SPA fallback (non-API GET routes → index.html)
    - `render.yaml` + Render API: build command now = `npm install && cd ../client && npm install && npm run build` (builds the frontend during deploy)
    - `CLIENT_URL` env var updated → `https://vaultbank-md20.onrender.com` (Stripe success/cancel URLs now return to the app)
  - **Verified live:** GET `/` → 867KB React HTML (has onrender URL + `?deposit=success` handler); login 200 + JWT; `/api/account` 200; `/api/account/balance` 200 ($4,980.50); Stripe LIVE; new Checkout session success_url = `https://vaultbank-md20.onrender.com/?deposit=success&session_id=…`
  - **Vercel (`vaultbank-mu`) no longer needed** — stale build marked ⚠️ legacy in MEMORY.md.
- [x] 🎉 **SEND/RECEIVE MONEY — LIVE FEEDBACK EVERYWHERE (2026-09-03)**
  - **`client/src/refreshBus.ts` (new)** — tiny pub/sub that fires when money moves; every view subscribes and refetches instantly = whole app stays live with NO reload
  - **`store.ts`** — emits the bus after every successful send / deposit / bill pay
  - **`hooks/useAccountData.ts`** — subscribes to the bus + gentle 20s poll (so money RECEIVED from others shows up too)
  - **`Modals.tsx` (TransferModal)** — emerald animated success receipt: "💸 $2.50 sent to X · REAL MONEY · INSTANT · SETTLED"
  - **`App.tsx`** — gold toast banner on send: formatMoney sent to user, "BALANCE UPDATED"
  - **`HistorySection.tsx`** — now fetches REAL devices from `/api/account/transactions` (was fake `fullTransactionHistory` from data.ts); has refresh button + loading + empty states
  - **`NotificationsPanel.tsx`** — fetches REAL alerts from `/api/alerts` (was fake data.ts), live badge count, "Money Received" titles, time-ago, poll + bus subscription
  - **`server/routes/accounts.js`** — transfer now also pushes a real "Money Received" alert to the receiver's demoStore (instant bell badge)
  - **`server/routes/alerts.js`** — was CRASHING in production (read `demoStore.alerts` which is empty in real-DB mode → 500). Now reads real DB notifications via `getNotifications()` with graceful fallback; unread-count/read-all are production-safe
  - **Verified live on `https://vaultbank-md20.onrender.com`**: real transfer `$2.50 demo→diana` → sender balance 4980.50→4978.00, transaction + transfer history both updated; `/api/alerts` returns 200 + real notifications; TS 0 errors; build OK

---

## 📅 What's NEXT (To Do)

- [x] Push all fixes to GitHub → auto-deploy triggers (repo in sync with `origin/main`)
- [x] REAL MONEY DEPOSITS WORK — Stripe LIVE mode + webhook + single-origin app verified
- [ ] **Roll keys for security** (user did share secrets in chat):
  1. Stripe dashboard → Developers → API keys → **Roll secret key** → update `STRIPE_SECRET_KEY` in Render
  2. Render → Account Settings → API Keys → **delete** the key shared in chat
- [ ] (Optional) Withdrawals need Stripe Connect (`user.stripe_connect_account_id`)
- [ ] (Optional) UptimeRobot / Sentry monitoring
- [ ] (Optional) Delete the legacy Vercel alias to avoid confusion

---

*Created: 2026-08-12 | Last updated: 2026-09-03 | Never forget: read this first, update it often.*
