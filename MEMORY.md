# 🧠 VaultBank — AI & Human Memory (PERMANENT)

> **This file is the brain of the project.** Any AI or human working here MUST read this first.
> Update this file whenever you learn something new. Never stop saving memory.

---

## 🌐 Live URLs — ALWAYS UP TO DATE

| Service | URL | Status |
| --------- | ----- | -------- |
| **Backend (Render)** | `https://vaultbank-md20.onrender.com` | 🟢 Live |
| Backend Health | `https://vaultbank-md20.onrender.com/health` | 🟢 HTTP 200 |
| **Frontend (Vercel)** | `https://vaultbank-hha0sj6he-matus-projects-c3e42681.vercel.app` | 🟢 Live |
| Frontend Alias | `https://vaultbank-mu.vercel.app` | 🟢 Live |
| **Database (Neon PostgreSQL)** | `server/.env` → `DATABASE_URL` | 🟢 Live |
| GitHub Repo | `https://github.com/matunot/vaultbank.git` | 🟢 |

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
- [ ] ⚠️ **USER ACTION NEEDED — Stripe keys to activate real money:**
  1. Stripe dashboard → copy `sk_test_...` secret + create webhook `https://vaultbank-md20.onrender.com/api/stripe/webhook` (event: `checkout.session.completed`) → copy `whsec_...`
  2. Render dashboard → Environment → add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLIENT_URL=https://<vercel-url>`
  3. Test deposit with card `4242 4242 4242 4242` (any future date, any CVC)
  4. Go live: activate Stripe account → swap to `sk_live_` keys
  - Withdrawals additionally need Stripe Connect (`user.stripe_connect_account_id`) — see stripe-payments.js withdraw route

---

## 📅 What's NEXT (To Do)

- [x] Push all fixes to GitHub → auto-deploy triggers (repo in sync with `origin/main`)
- [ ] Create Render Deploy Hook + set `RENDER_DEPLOY_HOOK` GitHub secret
- [ ] Verify live sites after latest deployment
- [ ] Paste real Stripe/PayPal API keys into Render env (payment code auto-activates — see PROJECT_CONTEXT.md §4)
- [ ] (Optional) Set up UptimeRobot / Sentry for extra monitoring

---

*Created: 2026-08-12 | Last updated: 2026-09-02 | Never forget: read this first, update it often.*
