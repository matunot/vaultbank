# VaultBank — mobile performance & production hardening

Branch: `perf/mobile-hardening`, rebased onto `d5a8d25` (current `origin/main`).
Scope: mobile-first performance, resilience, accessibility, observability, and deployment
safety. No schema changes, no destructive SQL, no infrastructure moves.

> `origin/main` advanced by three commits while this work was in progress (legacy payment
> gateways and UPI retired). The branch was rebased onto `d5a8d25` and every number below
> was re-measured against a fresh build of that commit, which is the build currently live
> (`index-DlR_2GWW.js`). Nothing from the retirement commits was reintroduced.

Status: **verified locally, awaiting human review before merge/deploy** (repo Definition
of Done requires owner approval). Production database diagnostics are **blocked** — see
§8.

---

## 1. Results at a glance

| Metric | Before (`d5a8d25`, live build) | After | Change |
| --- | --- | --- | --- |
| Initial JS, raw | 362.83 KB | 320.92 KB | −11.6% |
| Initial JS, gzip | 102.79 KB | 94.50 KB | **−8.1%** |
| Initial CSS, gzip | 17.59 KB | 19.29 KB | +1.7 KB |
| Initial JS+CSS, gzip | 120.38 KB | **113.79 KB** | **−5.5%** |
| Framer Motion in initial chunk | yes | no — lazy `proxy-*.js` only | critical path freed |
| Dashboard bootstrap API calls | 3 (`/account`, `/account/balance`, `/account/transactions`) | **2** (`/account`, `/account/transactions`) | −33% |
| Static asset caching | `public, max-age=0` | `public, max-age=31536000, immutable` | repeat visits ≈ 0 bytes |
| Origin compression | none (320,908 B identity) | gzip (96,762 B) | −70% on the wire |
| Login DCL, 1.6 Mbps / 150 ms RTT / 4× CPU | 3.02 s (pre-compression, same build) | **1.18 s** | −61% |
| Dashboard LCP, same profile | n/a (measured after) | 3.90 s | — |
| Mobile layout < 1024 px | desktop sidebar squeezed content | full-width `<main>` + bottom nav | bug fixed |
| axe (WCAG 2.1/2.2 A+AA) | 3 blocking Lighthouse audits | **0 serious/critical** on login + dashboard | fixed |

Budget gates (enforced by `npm run budget`, wired into CI):

| Budget | Limit | Actual | Result |
| --- | --- | --- | --- |
| Entry JS (gzip) | 100 KiB | 94.50 KiB | PASS |
| Entry JS + CSS (gzip) | 120 KiB | 113.79 KiB | PASS |
| Largest single asset | 250 KiB | 122 KB raw (lazy vendor chunk) | PASS |

Measurement method: node `zlib` gzip level 9 over the built files, applied identically to
both builds; Vite's own reporter shows 97.68 kB for the entry because it uses different
gzip settings.

---

## 2. What changed

### 2.1 Critical mobile shell bug (highest user impact)

The desktop `<aside>` sidebar rendered at every viewport width, stealing horizontal space
from `<main>` on phones. Now `hidden lg:flex`, `<main>` gets `pb-20 lg:pb-0`, and a new
`MobileNav` provides four primary destinations plus a "More" sheet (Escape closes,
focus-visible, ≥44 px targets). Verified at 360/375/390/412 px: `main` width equals
viewport width, sidebar width 0, zero horizontal overflow, zero console errors.

### 2.2 Bundle and loading

- Framer Motion removed from the critical path. Shell/dashboard components use CSS motion
  primitives; `motion`/`AnimatePresence` remain only inside the lazy `proxy-*.js` chunk.
  Verified against the built entry: it references `AnimatePresence-*.js` by filename only;
  the library code (`framerAppearId`) lives in the lazy chunk.
- Dev-only sample panels are behind `import.meta.env.DEV` dynamic imports; production
  renders honest `DashboardPreviewPanels` disclosures instead.
- Routes, modals, settings and the payments surface stay code-split.
- `index.html` keeps preconnect/dns-prefetch hints for the API origin.

### 2.3 Data fetching

`useAccountData` now performs one account read plus one 20-row ledger read, derives the
balance from the account payload, normalises ledger rows, guards against overlapping
in-flight loads, and polls every 60 s **only while the tab is visible**. Post-login the
dashboard issues exactly 4 requests total (`/login`, `/api/account`,
`/api/account/transactions`, `/api/alerts`).

### 2.4 Resilience (`client/src/api.ts`)

- Retries only safe methods (GET/HEAD) and mutations that carry a real idempotency key —
  never a money movement on a blind retry.
- Timeouts: 12 s GET, 45 s mutation, 60 s KYC upload.
- GET de-duplication, `X-Request-ID` per request, and privacy-safe route timing metrics
  (route template only, no IDs, no amounts).
- 401 handling unchanged: clears session and returns to the entry screen.

### 2.5 Caching and compression (`server/index.js`)

- `/assets/*`: `public, max-age=31536000, immutable` (content-hashed).
- HTML: `no-cache`, so a deploy is picked up immediately.
- Origin gzip via `compression`, mounted **only** in front of the static frontend so
  streaming API responses keep their current behaviour. Cloudflare continues to serve
  brotli at the edge.
- Matched in `vercel.json` for the stale Vercel alias.

### 2.6 Accessibility

- `<main>` landmark on the login screen (fixes `landmark-one-main`).
- Contrast raised on micro-text (labels, placeholders, footer trust marks) — measured,
  not guessed.
- Touch targets ≥ 44 px (password reveal, remember-me, reset link).
- Mobile ticker and transaction list are focusable scroll regions with accessible names
  (`role="group"` / `role="region"`), fixing `scrollable-region-focusable`.
- Mobile nav labels match visible text ("Home" rather than the internal route id), so
  voice control and tests agree.

### 2.7 Backend observability

- Request logger with correlation IDs, sanitised fields, slow-request warnings, and
  100-request percentile summaries.
- `server/config/dbMetrics.js`: per-query timing plus pool counters.
- Pool: `max: 10`, 10 s connect timeout, TCP keepalive, `application_name`.
- `/health` exposes `dbPool` counters and mode only — no connection strings, no hostnames.

### 2.8 CI gates

`.github/workflows/integration-tests.yml` now runs the client unit tests and the bundle
budget in addition to the existing server suite.

---

## 3. Evidence and how to reproduce

### 3.1 Throttled mobile profile

```powershell
cd server; node index.js            # serves client/dist + API
cd client; $env:AUDIT_BASE='http://127.0.0.1:5000'; node perf-measure.mjs
```

Profile: 390×844, Pixel 6 UA, 1.6 Mbps down / 750 kbps up, 150 ms RTT, 4× CPU throttle.
Recorded output (`reports/audit/after/perf.json`):

| Phase | Transfer | DCL | CLS | Long tasks |
| --- | --- | --- | --- | --- |
| Login | 94.96 KB JS + 18.87 KB CSS, 2 resources | 1.182 s | 0 | 2 (225 ms) |
| Dashboard | +49 KB JS, 2.77 KB fetch, 12 resources | 1.182 s | 0 | 5 (507 ms) |

Sign-in to fully rendered dashboard: **587 ms**. Dashboard LCP: **3.90 s** at 4× CPU
throttling, which is where the remaining work is (hydration of the dashboard chunk).

Compression A/B: the same entry ships **320,908 B identity vs 96,762 B gzip** (measured
above). Without origin compression the login document reached DCL at 3.02 s on a
pre-rebase build of this branch whose JS was within 0.2% of the current size; with
compression it is 1.18 s. That isolates the compression/caching work from the code
changes.

### 3.2 Layout audit

```powershell
cd client; $env:AUDIT_BASE='http://127.0.0.1:5000'; node perf-audit.mjs
```

360/375/390/412 px → `login scrollWidth == innerWidth`, `main == viewport`, `aside == 0`,
`horizontalOverflow=false`, 0 console errors, 0 failed requests. Screenshots in
`reports/audit/after/`.

### 3.3 Functional and accessibility tests

```powershell
cd client; npx tsc --noEmit; npx vitest run; npx playwright test
cd server; npm test
```

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| Vitest (retry policy, dedupe, metrics privacy, hook request count, hidden-tab polling, ledger normalisation) | 10/10 |
| Playwright (auth setup, login, 2-request bootstrap, sidebar, bottom nav + More sheet, notifications, no console errors, axe login + dashboard) | 9/9 |
| Server jest | 264 passed, 16 skipped (3 suites skipped) |

### 3.4 Lighthouse — what could and could not be measured

Baseline was captured on `https://vaultbank-978m.vercel.app` (old build, median of runs
2–3): performance **0.70**, FCP/LCP 1.15 s, TBT 2.76 s, CLS 0, SI ~3.2 s, a11y **0.88**,
best-practices 0.96, total 171 KiB, 93 KiB unused JS.

Lighthouse cannot trace this app on localhost or on the Render origin in this
environment: `NO_FCP` / `NO_NAVSTART` (a static smoke page fails identically, and
`https://example.com` succeeds, so it is an environment/tracing limitation, not an app
fault). The after-state therefore uses the CDP-throttled Playwright profile above, plus
axe for accessibility. **A public preview URL is the remaining step to produce a
directly comparable Lighthouse after-score.**

---

## 4. India-first latency: findings and options

Facts gathered without touching production:

- The app is single-origin on Render; the built client talks to that origin.
- The `DATABASE_URL` in the local checkout is a **pooled** Neon endpoint in
  `us-east-1` (host suffix only; credentials rejected — see §8, so region is
  *unverified* against the current production instance).
- Post-login the dashboard issues 4 requests; each is one HTTP round trip from the phone
  to the origin, then a few short queries from the origin to the database.

Implication: for an India-based user, the dominant cost is **device → origin RTT ×
request waves**, not database work. At ~200 ms RTT to a US origin, four sequential
requests cost ~0.8 s of pure latency before rendering. The fixes already shipped reduce
this to the minimum request count and remove repeat-visit downloads entirely.

Ranked options (none executed — all need owner approval):

1. **Free / already done**: immutable asset caching, origin compression, 3→2 request
   collapse, visibility-gated polling, lazy vendor chunk.
2. **Low cost, no data migration**: serve the client from an edge CDN close to India
   (Cloudflare already fronts the origin — verify HTML cache hit ratio and keep
   `no-cache` semantics for the document while caching `/assets/*` aggressively).
3. **Paid, reversible**: move the Render service to the Singapore region — needs a plan
   that supports region selection.
4. **Paid, higher effort**: Neon read replica in `ap-south-1` for read paths, with writes
   still going to the primary. Requires connection-routing work and budget sign-off.

Recommendation: do (2) and measure with real-user data before paying for (3)/(4).

---

## 5. Database work

Shipped (safe, no DDL):

- Pool sizing and keepalive, connect timeout, `application_name` for attribution.
- Query timing and pool counters; `/health` reports counters only.
- Slow-query/request warnings with correlation IDs.

Blocked: query plans and index evidence require a live read-only session. The diagnostics
script is read-only by construction:

```
SET default_transaction_read_only = on;
SET statement_timeout = '8000';
```

It reads catalog views (`pg_class`, `pg_indexes`, `pg_stat_activity`), row counts, and
`EXPLAIN (FORMAT JSON)` — no `ANALYZE`, no DDL, no writes — and prints no host, user or
password.

Candidate indexes to evaluate **only if** the plans show sequential scans plus sorts
(hypotheses, deliberately not applied):

| Query | Candidate |
| --- | --- |
| newest 20 transactions for an account | `transactions (account_id, created_at DESC)` |
| newest alerts for a user | `alerts (user_id, created_at DESC)` |
| account lookup by user | `accounts (user_id)` |
| login by email | `users (email)` — likely already unique |

No index will be added without plan evidence and approval, per project rules.

---

## 6. Security and financial correctness

- No schema changes, no destructive SQL, no data migrations, no production connection
  changes.
- No new runtime dependency except `compression`; test tooling is dev-only.
- Retries never replay a money movement without an idempotency key.
- Balances, transactions and ledger rows are never written to shared caches.
- CORS behaviour unchanged (`origin: true` is intentional in this deployment).
- Secrets: `.env` untouched and untracked; `.gitignore` extended for test artefacts and
  local evidence. Logs are sanitised (no bodies, tokens, or account numbers).
- Four pre-existing `npm audit` findings remain and were **not** auto-fixed (breaking
  changes); they are unchanged by this work.

---

## 7. Rollback

Code-only change set — no migrations, so rollback is a redeploy of the previous commit:

1. Render: roll back the service to the last deploy of `b53412f` (or `git revert` the
   merge commit and let CI redeploy).
2. The client is single-origin, so no CDN purge is required for HTML (`no-cache`);
   `/assets/*` are content-hashed, so old and new bundles never collide.
3. Vercel alias is stale by design — ignore it.

---

## 8. Blockers and open items

1. **Production DB diagnostics (blocked).** The `DATABASE_URL` in the local checkout is
   rejected by Neon (`password authentication failed`), i.e. credentials were rotated at
   some point and the current value lives only in the Render environment. To unblock,
   the owner runs the read-only script (or issues a read-only role):
   `node neon-readonly-diagnostics.js` from the repo root, then shares
   `reports/audit/db/neon-readonly.json`. No secrets are printed by the script.
2. **Merge/deploy approval.** The repo's Definition of Done requires human review before
   merge and deploy. The branch is pushed and ready for a PR; this environment has no
   `gh` CLI and the Vercel CLI is logged out, so the PR and any preview deployment must be
   opened from an authenticated session:
   `https://github.com/matunot/vaultbank/pull/new/perf/mobile-hardening`.
3. **India region migration.** Requires budget/plan approval; not attempted.
4. **Lighthouse after-score.** Needs a public preview deployment. The Vercel CLI here is
   logged out (`vercel whoami` → "Logged out"), Render previews need dashboard access, and
   local tracing fails with `NO_FCP`/`NO_NAVSTART` even for a static smoke page (§3.4).

Known pre-existing issues, intentionally not touched (out of scope, higher risk):

- `store.ts` `executeTrade` still simulates a trade with `setTimeout` (labelled as such in
  the UI; replacing it needs a real brokerage/ledger decision).
- `HistorySection` polls every 30 s regardless of visibility and animates up to 100 rows.
- Header search field has no behaviour.
