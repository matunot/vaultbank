# VaultBank24 Vercel Deployment Guide

This guide walks you through deploying VaultBank24 on Vercel with both frontend and backend under a single domain.

## Overview

The project has been restructured to deploy both the React frontend and Express backend together on Vercel:

- **Frontend**: React app in `/client` directory
- **Backend**: Express API in `/api` directory (serverless functions)
- **Domain**: Single Vercel domain (e.g., `vaultbank.vercel.app`)

## Project Structure

```
vaultbank/
├── api/                    # Express backend (serverless functions)
│   ├── index.js           # Main entry point for Vercel
│   ├── routes/            # All API routes
│   ├── middleware/        # Auth and rate limiting
│   └── config/            # Database and Supabase config
├── client/                # React frontend
│   ├── build/             # Built frontend (auto-generated)
│   ├── src/               # Source code
│   └── package.json       # Frontend dependencies
├── vercel.json           # Vercel configuration
├── package.json          # Root package.json with deployment scripts
└── ENV_TEMPLATE.md       # Environment variables template
```

## Environment Variables

### Backend Variables (Set in Vercel Project Settings)

Set these in **Vercel → Project → Settings → Environment Variables**:

```env
# Database
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/vaultbank?retryWrites=true&w=majority

# JWT Authentication
JWT_SECRET=<64-char-random-hex>
JWT_REFRESH_SECRET=<different-64-char-random-hex>
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d

# Supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>

# Security
FRONTEND_URL=https://vaultbank.vercel.app
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX_REQUESTS=100

# Optional (if using)
PAYPAL_CLIENT_ID=<paypal-client-id>
PAYPAL_SECRET=<paypal-secret>
EMAIL_SERVICE_API_KEY=<sendgrid-or-gmail-api-key>
EXCHANGE_RATE_API_KEY=<exchange-rate-api-key>
```

### Frontend Variables (Set in Vercel Project Settings)

```env
REACT_APP_API_BASE_URL=https://vaultbank.vercel.app
REACT_APP_NAME=VaultBank24
REACT_APP_VERSION=2.0.0
REACT_APP_ENV=production
REACT_APP_ENABLE_ANALYTICS=true
REACT_APP_ENABLE_REWARDS=true
REACT_APP_ENABLE_MARKETPLACE=true
REACT_APP_ENABLE_SECURITY_MONITORING=true
REACT_APP_DEBUG_MODE=false
REACT_APP_LOG_LEVEL=error
```

## Deployment Steps

### 1. Prepare Your Code

Ensure your code is committed to GitHub:

```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

### 2. Create Vercel Project

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click "New Project"
4. Import your VaultBank24 repository
5. Configure project settings:
   - **Framework Preset**: Other
   - **Root Directory**: `/` (project root)
   - **Build Command**: `npm run vercel:build`
   - **Output Directory**: `client/build`
   - **Install Command**: `npm run install:all`

### 3. Set Environment Variables

In Vercel dashboard:

1. Go to **Project Settings → Environment Variables**
2. Add all backend and frontend variables from the sections above
3. Set variables for **Production**, **Preview**, and **Development** environments

### 4. Deploy

1. Click "Deploy"
2. Vercel will automatically:
   - Install dependencies for both client and server
   - Build the React frontend
   - Deploy Express backend as serverless functions
   - Configure routing rules

### 5. Verify Deployment

After deployment:

- **Frontend**: `https://your-project.vercel.app`
- **API Health**: `https://your-project.vercel.app/health`
- **API Info**: `https://your-project.vercel.app/api`

## API Endpoints

All API endpoints are available under `/api/`:

- `POST /api/signup` - User registration
- `POST /api/login` - User login
- `POST /api/auth/login` - Admin login
- `GET /api/transfers` - Get transfers
- `POST /api/transfers` - Create transfer
- `GET /api/rewards` - Get rewards
- `POST /api/rewards/earn` - Earn rewards
- `GET /api/alerts` - Get alerts
- `GET /api/audit/logs` - Get audit logs
- `GET /api/business/me` - Get business info
- `GET /api/investments` - Get investments
- `GET /api/admin/stats` - Admin statistics

## Vercel Configuration Details

### vercel.json

```json
{
  "builds": [
    {
      "src": "client/package.json",
      "use": "@vercel/static-build",
      "config": { "distDir": "client/build" }
    },
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/index.js" },
    { "src": "/(.*)", "dest": "client/build/index.html" }
  ]
}
```

This configuration:

- Builds the React frontend using `@vercel/static-build`
- Deploys the Express backend as serverless functions using `@vercel/node`
- Routes all `/api/*` requests to the backend
- Routes all other requests to the React frontend (SPA routing)

## Troubleshooting

### Common Issues

1. **Environment Variables Not Set**
   - Check Vercel project settings
   - Ensure variables are set for all environments

2. **Build Failures**
   - Check Vercel build logs
   - Ensure all dependencies are in package.json
   - Verify Node.js version compatibility

3. **API Routes Not Working**
   - Check that routes are prefixed with `/api/`
   - Verify CORS configuration allows your domain

4. **Database Connection Issues**
   - Ensure MongoDB Atlas IP whitelist includes Vercel IPs
   - Verify connection string format

### Testing Locally

```bash
# Install dependencies
npm run install:all

# Start development servers
npm run dev

# Frontend: http://localhost:3000
# Backend: http://localhost:5000
```

## Free Tier Considerations

Vercel's free tier provides:

- 100GB bandwidth per month
- 1,000 serverless function executions per day
- 100GB-hours of compute per month
- Custom domains available

For production use, consider upgrading to a paid plan for:

- More serverless executions
- Increased bandwidth
- Advanced features like analytics and monitoring

## Next Steps

1. Set up a custom domain (optional)
2. Configure SSL certificates (automatic on Vercel)
3. Set up monitoring and logging
4. Configure backup strategies for your database
5. Set up CI/CD for automated deployments

## Support

For issues related to:

- **Vercel deployment**: Check [Vercel Documentation](https://vercel.com/docs)
- **VaultBank24 code**: Check project README and issue tracker
- **Environment setup**: Refer to `ENV_TEMPLATE.md`
