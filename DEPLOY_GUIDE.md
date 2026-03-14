# VaultBank24 — Deployment Guide

> **Goal:** Deploy the Node.js/Express backend on **Railway** and the React frontend on **Vercel** with zero manual guesswork.

---

## Table of Contents

1. [Pre-flight Checklist](#1-pre-flight-checklist)
2. [Deploy Backend on Railway](#2-deploy-backend-on-railway)
3. [Deploy Frontend on Vercel](#3-deploy-frontend-on-vercel)
4. [Post-Deployment Wiring](#4-post-deployment-wiring)
5. [Verify Everything Works](#5-verify-everything-works)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Pre-flight Checklist

Before you deploy anything, make sure the following are ready:

- [ ] **GitHub repo is up to date** — push all local changes:
  ```bash
  git add .
  git commit -m "chore: add Railway and Vercel deployment configs"
  git push origin main
  ```
- [ ] **MongoDB Atlas cluster is created** with a database user and connection string (see [ENV_TEMPLATE.md](./ENV_TEMPLATE.md))
- [ ] **Supabase project is active** — grab `SUPABASE_URL` and `SUPABASE_ANON_KEY` from  
      _Supabase Dashboard → Project Settings → API_
- [ ] **JWT secrets generated** (two separate 64-char hex strings):
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
  Run it **twice** — once for `JWT_SECRET`, once for `JWT_REFRESH_SECRET`.
- [ ] You have accounts on [railway.app](https://railway.app) and [vercel.com](https://vercel.com)

---

## 2. Deploy Backend on Railway

### 2.1 — Create a New Railway Project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your `vaultbank` repository
4. Railway will detect the `server/` folder. When prompted for the **root directory**, set it to:
   ```
   server
   ```
   _(Railway reads `server/railway.json` automatically once root directory is set.)_

### 2.2 — Set Environment Variables

In Railway: **Project → Your Service → Variables tab**, add every variable from [ENV_TEMPLATE.md](./ENV_TEMPLATE.md) under the **Backend** section.

> **Critical variables — the app will crash without these:**
> | Variable | Where to get it |
> |---|---|
> | `MONGODB_URI` | MongoDB Atlas → Connect → Drivers |
> | `JWT_SECRET` | Generate locally (step above) |
> | `JWT_REFRESH_SECRET` | Generate locally (step above) |
> | `SUPABASE_URL` | Supabase → Project Settings → API |
> | `SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
> | `FRONTEND_URL` | Your Vercel URL (fill in after step 3) |

Leave `PORT` **unset** — Railway injects it automatically.

### 2.3 — Configure Build & Start

Railway reads `server/railway.json` which already sets:

```json
{
  "deploy": {
    "startCommand": "node index.js",
    "healthcheckPath": "/health"
  }
}
```

No further action needed.

### 2.4 — Trigger Deployment

Click **Deploy** (or push to `main` — Railway auto-deploys on push).

### 2.5 — Confirm It's Running

Once the deployment turns green, Railway gives you a public URL like:  
`https://vaultbank-production-xxxx.up.railway.app`

Test the health endpoint:

```bash
curl https://vaultbank-production-xxxx.up.railway.app/health
```

Expected response:

```json
{
  "success": true,
  "message": "VaultBank API is running",
  "timestamp": "...",
  "environment": "production"
}
```

**Copy this Railway URL** — you'll need it in the next step.

---

## 3. Deploy Frontend on Vercel

### 3.1 — Import the Project

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repo (`vaultbank`)
3. When Vercel asks for the **Root Directory**, set it to:
   ```
   client
   ```
   _(Vercel reads `client/vercel.json` automatically once root directory is set.)_

### 3.2 — Configure Build Settings

Vercel will auto-detect these from `client/vercel.json`, but verify:

| Setting          | Value            |
| ---------------- | ---------------- |
| Framework Preset | Create React App |
| Build Command    | `npm run build`  |
| Output Directory | `build`          |
| Install Command  | `npm install`    |

### 3.3 — Set Environment Variables

In Vercel: **Project → Settings → Environment Variables**, add:

| Variable                               | Value                                                                 |
| -------------------------------------- | --------------------------------------------------------------------- |
| `REACT_APP_API_BASE_URL`               | `https://vaultbank-production-xxxx.up.railway.app` ← your Railway URL |
| `REACT_APP_NAME`                       | `VaultBank24`                                                         |
| `REACT_APP_VERSION`                    | `2.0.0`                                                               |
| `REACT_APP_ENV`                        | `production`                                                          |
| `REACT_APP_ENABLE_ANALYTICS`           | `true`                                                                |
| `REACT_APP_ENABLE_REWARDS`             | `true`                                                                |
| `REACT_APP_ENABLE_MARKETPLACE`         | `true`                                                                |
| `REACT_APP_ENABLE_SECURITY_MONITORING` | `true`                                                                |
| `REACT_APP_DEBUG_MODE`                 | `false`                                                               |
| `REACT_APP_LOG_LEVEL`                  | `error`                                                               |

> **Important:** Set these for **Production**, **Preview**, and **Development** environments in Vercel to avoid surprises.

### 3.4 — Deploy

Click **Deploy**. Vercel will build the React app and publish it.

Your frontend will be live at something like:  
`https://vaultbank.vercel.app`

---

## 4. Post-Deployment Wiring

After both services are live, you need to cross-wire them:

### 4.1 — Update `FRONTEND_URL` on Railway

Go back to Railway → **Variables** and update:

```
FRONTEND_URL=https://vaultbank.vercel.app
```

Then **redeploy** the backend service (Railway → Deploy → Redeploy Latest).

This updates the CORS `origin` in `server/index.js` so the frontend can talk to the backend.

### 4.2 — Verify CORS Works

Open your browser DevTools (Network tab) and make a login request on the frontend. You should **not** see any `CORS` errors. If you do, double-check `FRONTEND_URL` matches your Vercel URL exactly (no trailing slash).

---

## 5. Verify Everything Works

Run through this checklist after deployment:

- [ ] `GET /health` returns `200 OK` on Railway URL
- [ ] Frontend loads at Vercel URL without console errors
- [ ] Signup flow completes (Supabase creates user)
- [ ] Login flow returns a session token
- [ ] Dashboard loads and makes API calls to Railway (check Network tab)
- [ ] No `CORS` errors in browser console
- [ ] MongoDB Atlas shows incoming connections in **Monitoring**

### Quick smoke test (from terminal):

```bash
# Replace with your Railway URL
BASE=https://vaultbank-production-xxxx.up.railway.app

# Health check
curl $BASE/health

# Try login (replace with a real test account)
curl -X POST $BASE/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}'
```

---

## 6. Troubleshooting

### Backend crashes on Railway

**Check logs:** Railway → Deployments → Click failed deployment → View Logs

Common causes:
| Symptom | Fix |
|---|---|
| `MongooseServerSelectionError` | `MONGODB_URI` is wrong or Atlas IP whitelist blocks Railway. In Atlas → Network Access → Add IP: `0.0.0.0/0` (allow all) |
| `Cannot find module` | Root directory not set to `server/` in Railway |
| `JWT_SECRET is not defined` | Environment variable missing in Railway Variables tab |
| App starts but `/health` returns 500 | Check if MongoDB connection succeeds — look for `"MongoDB connected"` in logs |

### Frontend can't reach backend

Common causes:
| Symptom | Fix |
|---|---|
| CORS error in browser | `FRONTEND_URL` on Railway doesn't match Vercel URL — fix & redeploy backend |
| `net::ERR_CONNECTION_REFUSED` | `REACT_APP_API_BASE_URL` still points to `localhost` — update Vercel env var & redeploy frontend |
| API calls return 404 | Wrong `REACT_APP_API_BASE_URL` (trailing slash or typo) |

### Environment variable not picked up (React)

React bakes env variables at **build time**. If you update a `REACT_APP_*` variable in Vercel:

1. Go to Vercel → Project → Settings → Environment Variables → Update the value
2. Trigger a new deployment: Vercel → Deployments → **Redeploy**

---

## File Reference

| File                             | Purpose                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `server/railway.json`            | Railway deploy config (start command, health check)            |
| `server/.env.example`            | Template for all backend env variables                         |
| `client/vercel.json`             | Vercel deploy config (build, output dir, SPA routing)          |
| `client/.env`                    | Local development env variables (not committed for production) |
| `client/src/config/apiConfig.js` | Reads `REACT_APP_API_BASE_URL` at build time                   |
| `ENV_TEMPLATE.md`                | Copy-paste env variable list with placeholders                 |
