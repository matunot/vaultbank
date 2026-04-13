# VaultBank24 - Vercel Environment Variables

## Backend Variables (Set in Vercel Project Settings)

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
FRONTEND_URL=https://<your-project>.vercel.app
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX_REQUESTS=100

# Optional (if using)
PAYPAL_CLIENT_ID=<paypal-client-id>
PAYPAL_SECRET=<paypal-secret>
EMAIL_SERVICE_API_KEY=<sendgrid-or-gmail-api-key>
EXCHANGE_RATE_API_KEY=<exchange-rate-api-key>
```

## Frontend Variables (Set in Vercel Project Settings)

```env
REACT_APP_API_BASE_URL=https://<your-project>.vercel.app/api
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

## Variable Notes

- Replace `<your-project>` with your actual Vercel project name
- For `REACT_APP_API_BASE_URL`, use the format: `https://your-project.vercel.app/api`
- All backend variables are required for the API to function
- Frontend variables control feature flags and API connectivity
