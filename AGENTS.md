# VaultBank — Agent Instructions

Real licensed bank, production-grade. Node.js + Express (`server/index.js`, port 5000) + React + TS + Tailwind (Vite, `client/src/main.tsx→App`) + PostgreSQL (Neon). Single-origin live `https://vaultbank-md20.onrender.com` serves `client/dist` + API; Vercel alias is stale, ignore. Root `server.js` is a static stub, ignore. Read `PROJECT_CONTEXT.md` + `MEMORY.md` before non-trivial work.

## Run (order matters — backend first, Vite proxy needs it)
- Backend: `cd server; node index.js` (`npm run dev` = nodemon). Frontend: `cd client; npm run dev`. Proxy `/api,/login,/signup,/health` → `:5000`.
- `client/src/api.ts`: `API_BASE = VITE_API_URL || (DEV ? '' : renderURL)` — dev uses relative/proxy, prod defaults to Render.
- Health: `curl.exe http://localhost:5000/health`. Live cold-starts 30-60s (keep-alive q10min) — retry, don't "fix".

## Verify (exact dirs — no lint exists)
- Client (only typecheck): `cd client; npx tsc --noEmit` must be zero errors. No test runner, no eslint.
- Backend: `cd server; node --check <file>` + `npm test` (jest `__tests__/*.test.js`, uuid ESM shim, 20s timeout).
- Deploy (`render.yaml`, workdir `server`): build `npm install && cd ../client && npm install && npm run build`, start `node index.js`, health `/health`.

## Gotchas (never violate)
- `.env` at `server/.env` (Neon `DATABASE_URL`), never root. No env → falls back to in-memory demo.
- PG only, raw `db.query()` with `$1,$2`. `mongoose` dep still installed — `.lean()/.toObject()/._id` crashes.
- `transactions.type`: `deposit|withdrawal|transfer_in|transfer_out|payment|refund|fee|interest|adjustment`. Never bare `transfer`.
- `audit_logs`: `action,resource_type,resource_id,details,ip_address,user_agent,created_at`. No `category`/`timestamp`.
- Debit atomically: `UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING *`.
- CORS `origin:true` in `server/index.js` is intentional — do not re-add allowlist.
- Money is real (`/api/account/transfer|deposit|withdraw`, Stripe Checkout/Issuing webhooks). No fake `setTimeout` flows.
- PowerShell: `curl.exe`, `;` not `&&`.

## Routing
Memory → graph (`graphify-out/graph.json` for architecture/callers/flow) → skill (`.opencode/skills/<name>/SKILL.md`; money/auth/input/storage → `security-and-hardening`, required) → OpenViking recall. Never store secrets (DATABASE_URL, `sk_/whsec_`, JWT, Render keys) in memory/graph/viking.
