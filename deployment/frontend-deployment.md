# Frontend Deployment Script for VaultBank Production

## Build and Deployment Process

```bash
#!/bin/bash

# Frontend Production Deployment Script
# Deploys React app to production hosting

set -e

echo "=== VaultBank Frontend Production Deployment ==="
echo "Started at: $(date)"
echo

# Configuration
APP_NAME="vaultbank-frontend"
BUILD_DIR="./build"
DEPLOY_DIR="/var/www/vaultbank-app"
BACKUP_DIR="/var/backups/vaultbank-frontend"

# Environment variables
export REACT_APP_API_BASE_URL="https://api.vaultbank.com"
export REACT_APP_SUPABASE_URL="https://fussqdxbaglpgaivqtdb.supabase.co"
export REACT_APP_SUPABASE_ANON_KEY="${PRODUCTION_SUPABASE_ANON_KEY}"
export REACT_APP_SENTRY_DSN="${PRODUCTION_SENTRY_DSN}"
export REACT_APP_ENVIRONMENT="production"

echo "Environment Configuration:"
echo "  API Base URL: $REACT_APP_API_BASE_URL"
echo "  Supabase URL: $REACT_APP_SUPABASE_URL"
echo "  Environment: $REACT_APP_ENVIRONMENT"
echo

# Install dependencies
echo "Installing dependencies..."
npm ci --only=production

# Create backup of current deployment
if [ -d "$DEPLOY_DIR" ]; then
    echo "Creating backup of current deployment..."
    mkdir -p "$BACKUP_DIR"
    cp -r "$DEPLOY_DIR" "$BACKUP_DIR/deployment-$(date +%Y%m%d-%H%M%S)"
fi

# Build the application
echo "Building React application..."
npm run build

# Verify build output
if [ ! -d "$BUILD_DIR" ]; then
    echo "ERROR: Build directory not found!"
    exit 1
fi

echo "Build completed successfully"
echo "Build size: $(du -sh $BUILD_DIR | cut -f1)"
echo

# Deploy to web server
echo "Deploying to web server..."
sudo mkdir -p "$DEPLOY_DIR"
sudo cp -r "$BUILD_DIR"/* "$DEPLOY_DIR/"
sudo chown -R www-data:www-data "$DEPLOY_DIR"
sudo chmod -R 755 "$DEPLOY_DIR"

# Update Nginx configuration if needed
echo "Updating Nginx configuration..."
sudo tee /etc/nginx/sites-available/vaultbank-app > /dev/null <<EOF
server {
    listen 80;
    server_name app.vaultbank.com;

    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.vaultbank.com;

    ssl_certificate /etc/letsencrypt/live/vaultbank.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vaultbank.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # CSP for production
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https://api.vaultbank.com https://fussqdxbaglpgaivqtdb.supabase.co wss://fussqdxbaglpgaivqtdb.supabase.co; frame-ancestors 'none';" always;

    root $DEPLOY_DIR;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # SPA routing
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/vaultbank-app /etc/nginx/sites-enabled/

# Test Nginx configuration
if sudo nginx -t; then
    echo "Nginx configuration is valid"
    sudo systemctl reload nginx
else
    echo "ERROR: Nginx configuration is invalid!"
    exit 1
fi

# Clear CDN cache (if using CloudFlare)
echo "Clearing CDN cache..."
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
     -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
     -H "Content-Type: application/json" \
     --data '{"files":["https://app.vaultbank.com/*"]}'

echo
echo "=== Deployment Complete ==="
echo "Frontend is now available at: https://app.vaultbank.com"
echo "Deployment completed at: $(date)"
echo
echo "Next steps:"
echo "1. Verify the deployment: https://app.vaultbank.com"
echo "2. Check error logs: sudo tail -f /var/log/nginx/vaultbank-app.error.log"
echo "3. Monitor health endpoint: https://app.vaultbank.com/health"
```

## Vercel Deployment Configuration

Create `vercel.json` for Vercel deployment:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "build"
      }
    }
  ],
  "routes": [
    {
      "src": "/static/(.*)",
      "headers": {
        "cache-control": "public, max-age=31536000, immutable"
      },
      "dest": "/static/$1"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ],
  "env": {
    "REACT_APP_API_BASE_URL": "https://api.vaultbank.com",
    "REACT_APP_SUPABASE_URL": "https://fussqdxbaglpgaivqtdb.supabase.co",
    "REACT_APP_ENVIRONMENT": "production"
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "SAMEORIGIN"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    }
  ]
}
```

## Netlify Deployment Configuration

Create `netlify.toml` for Netlify deployment:

```toml
[build]
  publish = "build"
  command = "npm run build"

[build.environment]
  REACT_APP_API_BASE_URL = "https://api.vaultbank.com"
  REACT_APP_SUPABASE_URL = "https://fussqdxbaglpgaivqtdb.supabase.co"
  REACT_APP_ENVIRONMENT = "production"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/static/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## Deployment Commands

### For Vercel:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod

# Set environment variables
vercel env add REACT_APP_SUPABASE_ANON_KEY production
vercel env add REACT_APP_SENTRY_DSN production
```

### For Netlify:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy to production
netlify deploy --prod --dir=build

# Set environment variables
netlify env:set REACT_APP_SUPABASE_ANON_KEY <production_key>
netlify env:set REACT_APP_SENTRY_DSN <production_dsn>
```

### For AWS S3 + CloudFront:

```bash
# Build the app
npm run build

# Sync to S3
aws s3 sync build/ s3://vaultbank-app-bucket --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

## Performance Optimizations

1. **Bundle Analysis**

```bash
npm install --save-dev webpack-bundle-analyzer
npx webpack-bundle-analyzer build/static/js/*.js
```

2. **Code Splitting**

```javascript
// Lazy load components
const AdminDashboard = React.lazy(() => import("./components/AdminDashboard"));
const Analytics = React.lazy(() => import("./components/Analytics"));

// Wrap with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <Routes>
    <Route path="/admin" element={<AdminDashboard />} />
    <Route path="/analytics" element={<Analytics />} />
  </Routes>
</Suspense>;
```

3. **Image Optimization**

- Use WebP format for images
- Implement lazy loading for images
- Use appropriate image sizes for different screen densities

4. **Service Worker (PWA)**

```javascript
// Register service worker for caching
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      console.log("SW registered: ", registration);
    })
    .catch((registrationError) => {
      console.log("SW registration failed: ", registrationError);
    });
}
```

---

**Deployment Checklist:**

- [ ] Environment variables configured
- [ ] Build completed successfully
- [ ] SSL certificates configured
- [ ] CDN cache configured
- [ ] Health check endpoint responds
- [ ] Error monitoring (Sentry) configured
- [ ] Performance monitoring enabled
- [ ] Backup strategy implemented
- [ ] Rollback procedure documented
