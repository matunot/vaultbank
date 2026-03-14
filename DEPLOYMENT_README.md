# 🚀 VaultBank Production Deployment Guide

## 📋 Overview

This guide provides complete instructions for deploying VaultBank to production. The deployment includes automated containerization, SSL termination, monitoring, and comprehensive testing.

## 🎯 Prerequisites

### System Requirements

- Docker Engine 20.10+
- Docker Compose 2.0+
- Node.js 18+ (for smoke testing)
- 4GB RAM minimum
- 20GB disk space

### Cloud Requirements

- **Domain**: vaultbank.com (configure DNS)
- **SSL Certificate**: Let's Encrypt or commercial certificate
- **Database**: Supabase PostgreSQL (Production instance)
- **Hosting**: Any cloud provider (AWS, DigitalOcean, etc.)

## 🔧 1. Environment Setup

### Configure Production Secrets

1. **Copy environment template:**

```bash
cp server/.env.production server/.env
```

2. **Configure your secrets:**

```bash
# Edit server/.env with your real values
nano server/.env

# Required variables to change:
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/db
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-production-anon-key
JWT_SECRET=your-super-secure-jwt-secret-32-chars
ENCRYPTION_KEY=your-32-character-encryption-key

# Optional: Configure email, monitoring, etc.
SMTP_USER=alerts@vaultbank.com
SENTRY_DSN=https://your-sentry-dsn
```

3. **SSL Certificate Setup:**

```bash
# Create SSL directory
mkdir -p server/nginx/ssl

# Option A: Let's Encrypt (automatic)
sudo certbot certonly --webroot -w /var/www/html -d vaultbank.com
cp /etc/letsencrypt/live/vaultbank.com/fullchain.pem server/nginx/ssl/
cp /etc/letsencrypt/live/vaultbank.com/privkey.pem server/nginx/ssl/

# Option B: Self-signed (development only)
openssl req -x509 -newkey rsa:4096 -keyout server/nginx/ssl/privkey.pem \
        -out server/nginx/ssl/fullchain.pem -days 365 -nodes
```

## 🐳 2. Container Deployment

### One-Command Deployment

```bash
# Make deployment script executable
chmod +x deploy.sh

# Deploy to production (first time setup)
./deploy.sh

# This will:
# 1. Validate environment configuration
# 2. Check SSL certificates
# 3. Build Docker containers
# 4. Run database migrations
# 5. Start services with health checks
# 6. Configure monitoring
```

### Manual Deployment Steps

If you prefer manual steps:

```bash
# 1. Validate configuration
./deploy.sh health

# 2. Build and start containers
cd server
docker-compose -f docker-compose.prod.yml up -d --build

# 3. Run database migrations
docker-compose -f docker-compose.prod.yml exec vaultbank-backend npm run migrate:up

# 4. Verify services
./deploy.sh health
```

## 🌐 3. Domain Configuration

### DNS Setup

1. **Point your domain to server IP:**

```
vaultbank.com     A     YOUR_SERVER_IP
www.vaultbank.com CNAME vaultbank.com
api.vaultbank.com A     YOUR_SERVER_IP
```

2. **SSL Certificate Domain Validation:**

- Ensure certificates cover `vaultbank.com` and `www.vaultbank.com`
- Update nginx config if needed for additional subdomains

### Frontend Deployment

#### Option A: Vercel (Recommended)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Configure build settings
vercel --yes

# 3. Build and deploy
vercel --prod

# Environment variables for production
vercel env add REACT_APP_API_URL production
# Set to: https://api.vaultbank.com
```

#### Option B: Manual Build

```bash
# Build React app
cd client
npm run build

# Copy to nginx static directory (if using same server)
cp -r build/* /var/www/html/

# Or deploy to separate static hosting
# Upload build/ directory to your hosting provider
```

## 🔍 4. Testing & Validation

### Automated Smoke Tests

Run comprehensive production validation:

```bash
# Run all smoke tests
node smoke-test.js

# Test specific environment
SMOKE_TEST_URL=https://api.vaultbank.com node smoke-test.js

# Custom configuration
node smoke-test.js --url https://api.vaultbank.com --timeout 15000
```

**Smoke tests cover:**

- ✅ Health checks
- ✅ Authentication (register/login)
- ✅ Rate limiting
- ✅ Business module (accounts, payroll, invoices)
- ✅ Investment tracking
- ✅ AML compliance
- ✅ Analytics system

### Manual Testing Checklist

```bash
# 1. Admin Operations
curl -X POST https://admin.vaultbank.com/api/auth/login \
  -d '{"email":"admin@vaultbank.com","password":"secure-pass"}'

# 2. Business Onboarding
curl -X POST https://api.vaultbank.com/api/business/create \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"businessName":"Test Corp","businessType":"llc"}'

# 3. Transaction Monitoring
curl https://api.vaultbank.com/api/transfers/history \
  -H "Authorization: Bearer $TOKEN"

# 4. Compliance Testing
# Verify AML alerts are generated for suspicious activities
```

## 📊 5. Monitoring Setup

### Health Monitoring

```bash
# View container logs
./deploy.sh logs

# Restart services
./deploy.sh restart

# Check health endpoints
curl https://vaultbank.com/health
curl https://api.vaultbank.com/health
```

### Advanced Monitoring

1. **Application Performance Monitoring (APM):**

   - Configure Sentry DSN in `.env`
   - Monitor application errors and performance

2. **Database Monitoring:**

   - Use Supabase dashboard for query analytics
   - Monitor connection pools and slow queries

3. **System Monitoring:**
   - Set up alerts for high CPU/memory usage
   - Monitor disk space and network connectivity

### Log Aggregation

```bash
# View all service logs
docker-compose -f server/docker-compose.prod.yml logs -f

# Follow specific service
docker-compose -f server/docker-compose.prod.yml logs -f vaultbank-backend

# Export logs for analysis
docker-compose -f server/docker-compose.prod.yml logs > vaultbank_logs.txt
```

## 🔐 6. Security Hardening

### SSL/TLS Validation

```bash
# Test SSL configuration
openssl s_client -connect vaultbank.com:443 -servername vaultbank.com

# Check SSL rating
curl -s "https://www.ssllabs.com/ssltest/analyze.html?d=vaultbank.com"
```

### Security Headers Check

```bash
# Verify security headers
curl -I https://vaultbank.com

# Should include:
# Strict-Transport-Security
# X-Frame-Options
# X-Content-Type-Options
# X-XSS-Protection
# Content-Security-Policy
```

### Rate Limiting Validation

```bash
# Test rate limiting (should return 429 after limits)
for i in {1..20}; do
  curl -s https://api.vaultbank.com/api/auth/login \
    -d '{"email":"test@test.com"}' &
done
```

## 🔄 7. Maintenance & Updates

### Updating VaultBank

```bash
# Pull latest changes
git pull origin main

# Rebuild and redeploy
./deploy.sh

# Or incremental updates
cd server
docker-compose -f docker-compose.prod.yml up -d --build
```

### Database Maintenance

```bash
# Backup current database
pg_dump $DATABASE_URL > vaultbank_backup_$(date +%Y%m%d).sql

# Run migrations
docker-compose -f server/docker-compose.prod.yml exec vaultbank-backend npm run migrate:up

# Health check after migration
./deploy.sh health
```

### SSL Certificate Renewal

```bash
# Renew Let's Encrypt certificates
certbot renew

# Reload nginx configuration
docker-compose -f server/docker-compose.prod.yml exec nginx nginx -s reload
```

## 🚨 8. Emergency Procedures

### Rolling Back Deployments

```bash
# Stop current deployment
docker-compose -f server/docker-compose.prod.yml down

# Restore previous version (if tagged)
docker tag vaultbank-backend:v1.0 vaultbank-backend:latest
docker-compose -f server/docker-compose.prod.yml up -d

# Verify rollback
./deploy.sh health
```

### Handling System Alerts

1. **High Error Rate:**

   ```bash
   # Check container logs
   ./deploy.sh logs

   # Restart failing service
   docker-compose -f server/docker-compose.prod.yml restart vaultbank-backend
   ```

2. **Database Issues:**

   ```bash
   # Check database connectivity
   docker-compose -f server/docker-compose.prod.yml exec vaultbank-backend npm run db:check

   # Failover to backup (configure separately)
   ```

## 📈 9. Go-Live Checklist

### Pre-Launch Validation

- [ ] All smoke tests passing ✅
- [ ] SSL certificates valid and A+ rated
- [ ] DNS configured for all domains
- [ ] Database migrations completed
- [ ] Admin user created with proper permissions
- [ ] Monitoring systems operational
- [ ] Backup procedures tested

### Launch Day

- [ ] Enable production traffic
- [ ] Monitor error rates and performance
- [ ] Verify user registration/sign-in
- [ ] Test critical user flows
- [ ] Monitor database performance

### Post-Launch

- [ ] Monitor for 24-48 hours
- [ ] Performance optimize if needed
- [ ] Configure additional monitoring
- [ ] Set up on-call procedures
- [ ] Plan next deployment schedule

---

## 🎉 Success Metrics

After successful deployment, VaultBank should demonstrate:

- **Uptime**: >99.5%
- **Response Time**: <500ms for API calls
- **Error Rate**: <0.1%
- **User Satisfaction**: High engagement metrics
- **Security Compliance**: All regulatory requirements met

## 📞 Support & Maintenance

- **Documentation**: Keep deployment scripts updated
- **Backup Strategy**: Daily automated backups
- **Incident Response**: 24/7 on-call rotation
- **Security Audits**: Quarterly vulnerability assessments
- **Performance Reviews**: Monthly capacity planning

---

**VaultBank is now production-ready!**

🎯 **Domain**: https://vaultbank.com

🔗 **API**: https://api.vaultbank.com

📊 **Admin**: https://admin.vaultbank.com

Happy banking! 🏦✨
