# VaultBank24 — Environment Variables Template

> Copy the relevant sections into your Railway and Vercel dashboards.  
> **Replace every `<placeholder>` before deploying.** Never commit real secrets to Git.

---

## Backend — Railway Environment Variables

Set these in: **Railway → Project → Your Service → Variables**

```env
# ── Server ───────────────────────────────────────────────────
PORT=                             # Leave blank — Railway injects this automatically
NODE_ENV=production

# ── MongoDB Atlas ────────────────────────────────────────────
# MongoDB Atlas → Database → Connect → Drivers → copy the connection string
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/vaultbank?retryWrites=true&w=majority

# ── JWT Secrets ───────────────────────────────────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Run TWICE — use different values for JWT_SECRET and JWT_REFRESH_SECRET
JWT_SECRET=<64-char-random-hex>
JWT_EXPIRE=7d
JWT_REFRESH_SECRET=<different-64-char-random-hex>
JWT_REFRESH_EXPIRE=30d
JWT_COOKIE_EXPIRE=7

# ── Supabase ─────────────────────────────────────────────────
# Supabase Dashboard → Project Settings → API
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>   # Keep secret!

# ── CORS — Frontend URL ───────────────────────────────────────
# Set to your Vercel deployment URL (no trailing slash)
FRONTEND_URL=https://vaultbank.vercel.app

# ── PayPal ───────────────────────────────────────────────────
# PayPal Developer Dashboard → My Apps & Credentials
PAYPAL_CLIENT_ID=<paypal-client-id>
PAYPAL_SECRET=<paypal-secret>

# ── Email ────────────────────────────────────────────────────
EMAIL_FROM=noreply@vaultbank.com
EMAIL_SERVICE=Gmail
EMAIL_SERVICE_API_KEY=<sendgrid-or-gmail-api-key>

# ── Exchange Rate API ────────────────────────────────────────
# https://www.exchangerate-api.com/ → free tier available
EXCHANGE_RATE_API_KEY=<exchange-rate-api-key>
FX_API_BASE_URL=https://api.exchangerate-api.com/v4
FX_API_FALLBACK_URL=https://api.exchangerate.host

# ── Security Tuning ──────────────────────────────────────────
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW=900000         # 15 minutes in ms
RATE_LIMIT_MAX_REQUESTS=100
```

---

## Frontend — Vercel Environment Variables

Set these in: **Vercel → Project → Settings → Environment Variables**  
Make sure to set for **Production**, **Preview**, and **Development** environments.

```env
# ── API Connection ───────────────────────────────────────────
# Replace with your actual Railway backend URL (no trailing slash)
REACT_APP_API_BASE_URL=https://vaultbank-production-xxxx.up.railway.app

# ── App Identity ─────────────────────────────────────────────
REACT_APP_NAME=VaultBank24
REACT_APP_VERSION=2.0.0
REACT_APP_ENV=production

# ── Feature Flags ────────────────────────────────────────────
REACT_APP_ENABLE_ANALYTICS=true
REACT_APP_ENABLE_REWARDS=true
REACT_APP_ENABLE_MARKETPLACE=true
REACT_APP_ENABLE_SECURITY_MONITORING=true

# ── Debug (disable in production) ────────────────────────────
REACT_APP_DEBUG_MODE=false
REACT_APP_LOG_LEVEL=error
```

---

## Local Development `.env` Files

### `server/.env` (create from `.env.example`)

```bash
cd server
cp .env.example .env
# Then edit server/.env with your local/dev values
```

Minimum required for local dev:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/vaultbank
JWT_SECRET=any-local-dev-secret-min-32-chars
JWT_REFRESH_SECRET=another-local-dev-secret-min-32-chars
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-supabase-anon-key>
FRONTEND_URL=http://localhost:3000
```

### `client/.env` (already exists)

```env
REACT_APP_API_BASE_URL=http://localhost:5000
REACT_APP_NAME=VaultBank24
REACT_APP_VERSION=2.0.0
REACT_APP_ENV=development
REACT_APP_ENABLE_ANALYTICS=true
REACT_APP_ENABLE_REWARDS=true
REACT_APP_ENABLE_MARKETPLACE=true
REACT_APP_ENABLE_SECURITY_MONITORING=true
REACT_APP_DEBUG_MODE=true
REACT_APP_LOG_LEVEL=debug
```

---

## Variable Quick-Reference

| Variable                    | Required    | Service  | Notes                            |
| --------------------------- | ----------- | -------- | -------------------------------- |
| `MONGODB_URI`               | ✅          | Backend  | Atlas connection string          |
| `JWT_SECRET`                | ✅          | Backend  | 64-char random hex               |
| `JWT_REFRESH_SECRET`        | ✅          | Backend  | Different from JWT_SECRET        |
| `SUPABASE_URL`              | ✅          | Backend  | Project URL from Supabase        |
| `SUPABASE_ANON_KEY`         | ✅          | Backend  | Public anon key                  |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅          | Backend  | **Secret** — never expose        |
| `FRONTEND_URL`              | ✅          | Backend  | Vercel URL for CORS              |
| `REACT_APP_API_BASE_URL`    | ✅          | Frontend | Railway URL                      |
| `NODE_ENV`                  | ✅          | Backend  | Set to `production`              |
| `PAYPAL_CLIENT_ID`          | ⚠️ Optional | Backend  | Only if using PayPal payments    |
| `PAYPAL_SECRET`             | ⚠️ Optional | Backend  | Only if using PayPal payments    |
| `EXCHANGE_RATE_API_KEY`     | ⚠️ Optional | Backend  | Only if FX features enabled      |
| `EMAIL_SERVICE_API_KEY`     | ⚠️ Optional | Backend  | Only if email notifications used |

---

## Security Checklist Before Go-Live

- [ ] `JWT_SECRET` is at least 64 chars and randomly generated
- [ ] `JWT_REFRESH_SECRET` is **different** from `JWT_SECRET`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only on the **backend** (never in the React app)
- [ ] MongoDB Atlas IP whitelist is configured (either specific Railway IPs or `0.0.0.0/0` for simplicity)
- [ ] `server/.env` and `client/.env` are listed in `.gitignore`
- [ ] No secrets are hardcoded in any source file
- [ ] `REACT_APP_DEBUG_MODE=false` in production
- [ ] `NODE_ENV=production` on Railway
