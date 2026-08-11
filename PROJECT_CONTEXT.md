# 🏦 VaultBank — Project Context

> **The single source of truth for anyone (AI or human) working on this project.**
> Read this first to avoid asking unnecessary questions.

---

## 1. Project Overview

**VaultBank** is a **real licensed bank**, not a demo or toy project. The backend is currently running against live **PostgreSQL (Neon cloud database)** with real data persistence. All core banking operations work end-to-end.

### What's Built
- Full banking backend (Node.js + Express + PostgreSQL)
- Full banking frontend (React + TypeScript + Tailwind CSS)
- Real authentication (signup, login, JWT tokens, 2FA, profile management)
- Real money transfers (atomic, with balance validation)
- Account management (checking, savings, business accounts)
- Rewards system (points + tiers)
- Notifications system
- Audit logging
- Anomaly/fraud detection

### License Note
- The user **will add the banking license** themselves later. **Do not ask about it.**
- **No unnecessary setup** — speed is prioritized.
- Treat everything as production-grade.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | PostgreSQL (Neon cloud) |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS + Framer Motion |
| Build Tool | Vite |
| Auth | JWT tokens |
| API | RESTful (JSON) |
| Deployment | Render (backend), Vercel (frontend) |

### Project Structure
```
vaultbank/
├── server/                    # Backend
│   ├── config/
│   │   ├── db.js              # PostgreSQL connection pool
│   │   └── database.js        # Data access layer (all queries)
│   ├── routes/
│   │   ├── auth.js            # Authentication routes
│   │   └── transfers.js       # Money transfer routes
│   ├── middleware/
│   ├── migrations/
│   │   └── 007_real_banking_schema.sql  # 19-table schema
│   ├── utils/
│   │   └── audit.js           # Audit logging
│   ├── .env                   # Database credentials (NEON)
│   ├── .env.example           # Template
│   └── index.js               # Server entry point
├── client/                    # Frontend
│   ├── src/                   # React components
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── deployment/                # Deployment docs
├── docs/                      # PCI checklist, runbook, incident playbook
├── scripts/                   # Automation scripts
├── monitoring/                # Prometheus + Grafana
└── PROJECT_CONTEXT.md         # This file
```

---

## 3. ✅ What's DONE (Completed)

### Core Infrastructure
- [x] **PostgreSQL migration** — 19 tables in `migrations/007_real_banking_schema.sql`
- [x] **Neon PostgreSQL connection** — `server/.env` has correct `DATABASE_URL`
- [x] **`.env` path fixed** — `db.js` and `database.js` load `.env` from `server/` (not root)
- [x] **All Mongoose legacy code cleaned** — `database.js` and `transfers.js` use pure PostgreSQL
- [x] **Tailwind CSS warnings fixed** — `client/src/App.tsx` uses canonical classes

### Authentication
- [x] Signup (`POST /api/auth/signup`) → Creates user + account + rewards + notification
- [x] Login (`POST /api/auth/login`) → JWT token issued
- [x] Admin login (`POST /api/auth/admin/login`)
- [x] Profile management (`PUT /api/auth/profile`)
- [x] Password change (`POST /api/auth/change-password`)
- [x] 2FA support (code present in auth routes)

### Banking Operations
- [x] Money transfers (`POST /api/transactions/send`) → Atomic debit/credit
- [x] Balance validation (insufficient funds check)
- [x] Transaction types use `transfer_out` / `transfer_in`
- [x] Transaction history (`GET /api/transactions`)
- [x] Transfer history (`GET /api/transfers`)

### Testing (Verified Working)
```
Login:     OK (POST /api/auth/login → 200)
Signup:    OK (POST /api/auth/signup → 201)
Transfer:  OK (POST /api/transfers → 200, money moves between accounts)
Health:    OK (GET /health → 200)
```

### Deployments
- [x] **Frontend**: Deployed to Vercel
  - Production: https://vaultbank-hha0sj6he-matus-projects-c3e42681.vercel.app
  - Alias: https://vaultbank-mu.vercel.app
- [ ] **Backend**: Render deployment pending

---

## 4. ⏭️ What's NEXT (To Do)

### Priority 1: Deploy Backend to Render
- [ ] Create new Web Service on Render (free tier)
- [ ] Root directory: `server`
- [ ] Build command: `npm install`
- [ ] Start command: `node index.js`
- [ ] Add env vars from `server/.env` (especially `DATABASE_URL`)
- [ ] Deploy and note the Render URL

### Priority 2: Connect Frontend to Backend
- [ ] Set `VITE_API_URL` in Vercel to Render backend URL
- [ ] Redeploy frontend on Vercel

### Priority 3: Real Money Integration (User Adds Later)
- [ ] Banking license (user will handle)
- [ ] Payment processor integration (Stripe/Plaid — user will add)

### Priority 4: Enhancements (Optional)
- [ ] Email verification (SMTP)
- [ ] Phone verification (SMS)
- [ ] Rate limiting on auth endpoints
- [ ] Production SSL setup (`deployment/ssl-setup.sh`)

---

## 5. 🔑 Key Decisions & Rules

### Critical Rules
1. **REAL bank, not a demo** — everything must be production-grade
2. **NO unnecessary setup** — user wants speed, only add what's needed
3. **License is sensitive** — user adds it themselves, DO NOT ask about it
4. **No external API assumptions** — internal transfers work without any third-party API
5. **PostgreSQL first** — if a function works on PostgreSQL, it's correct; if it uses Mongoose methods (`.lean()`, `.toObject()`, `.findByIdAndUpdate()` with `$set`), it's WRONG

### Database Rules
1. **`.env`** is at `server/.env` (NOT root) — `db.js` loads it from `path.resolve(__dirname, '..', '.env')`
2. **Transaction types** must be: `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `payment`, `refund`, `fee`, `interest`, `adjustment` — NOT `'transfer'`
3. **Audit logs** use columns: `action`, `resource_type`, `resource_id`, `details`, `ip_address`, `user_agent`, `created_at` — NOT `category` or `timestamp`
4. **All data access** must go through `db.query()` raw SQL or the compatibility models in `db.js`

---

## 6. 🚀 How to Run (Locally)

### Backend
```bash
cd server
node index.js
# Output: 🚀 Server running on port 5000
```

### Frontend
```bash
cd client
npm install
npm run dev
# Output: ➜ Local: http://localhost:5173/
```

### Verify Both Are Running
```bash
# Health check (backend)
curl http://localhost:5000/health
# Should return: { "status": "ok", ... }

# Frontend check
curl http://localhost:5173
# Should return HTML 200
```

### Database
- PostgreSQL database is hosted on **Neon**
- Connection string is in `server/.env`
- No local PostgreSQL needed

### Demo Credentials
```
User:  demo@vaultbank.com  / password
Admin: admin@vaultbank.com / admin123
```

---

## 7. ⚠️ Important Gotchas

### 1. `.env` Location
- The `.env` file is at **`server/.env`**, not root
- Both `server/config/db.js` and `server/config/database.js` load it with:
  ```js
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  ```
- If you see `ECONNREFUSED 127.0.0.1:5432`, the `.env` path is wrong — the app is trying to connect to local PostgreSQL instead of Neon.

### 2. Transaction Types
- The `transactions` table has a CHECK constraint on `type`:
  `'deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'payment', 'refund', 'fee', 'interest', 'adjustment'`
- **DO NOT use `'transfer'`** — use `'transfer_out'` (for sender) and `'transfer_in'` (for recipient)

### 3. Audit Logs
- The `audit_logs` table has columns: `id`, `user_id`, `action`, `resource_type`, `resource_id`, `details`, `ip_address`, `user_agent`, `created_at`
- **DO NOT use `category` or `timestamp`** — these columns don't exist
- Use `resource_type` instead of `category`
- Use `created_at` instead of `timestamp`

### 4. MongoDB Legacy Code
- The project was **originally MongoDB**. It has been **migrated to PostgreSQL**.
- Any code using `.lean()`, `.toObject()`, `._id.toString()` is **legacy** and will CRASH on PostgreSQL.
- Always search for `.lean()` before writing new code.

### 5. Balance Updates
- Use **atomic PostgreSQL UPDATE with condition**:
  ```sql
  UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING *
  ```
- This prevents race conditions (insufficient funds between balance check and debit).

---

## 8. Key Files to Know

| File | Purpose | Important Note |
|------|---------|----------------|
| `server/.env` | Database credentials | NEON DATABASE_URL |
| `server/config/db.js` | PostgreSQL connection | Loads `.env` from `server/` |
| `server/config/database.js` | Data access functions | All CRUD → use `db.query()` |
| `server/routes/transfers.js` | Money transfer API | Use `transfer_out`/`transfer_in` |
| `server/routes/auth.js` | Authentication API | 2FA, profile, password change |
| `server/migrations/007_real_banking_schema.sql` | Database schema | 19 tables |
| `server/utils/audit.js` | Audit logging | Use `resource_type`, not `category` |
| `client/src/App.tsx` | Main React component | Canonical Tailwind classes |
| `render.yaml` | Render deployment config | Free tier backend deploy |
| `vercel.json` | Vercel deployment config | Frontend deploy |

---

## 9. Test Credentials
```
User:  demo@vaultbank.com  / password
Admin: admin@vaultbank.com / admin123
```

---

*Created: 2026-08-10 | Last updated: 2026-08-11 | Status: Production-ready core banking*