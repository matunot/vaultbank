# VaultBank Production Environment Variables & Secrets Management

## 1. Environment Variables Configuration

### Backend Environment Variables (.env.production)

```bash
# ========================================
# VaultBank Production Environment Configuration
# Generated: 2025-11-04 6:34:56 PM
# ========================================

# Server Configuration
NODE_ENV=production
PORT=5000
HOST=0.0.0.0

# Database Configuration (Supabase)
DATABASE_URL=postgresql://postgres:[SUPABASE_PASSWORD]@db.fussqdxbaglpgaivqtdb.supabase.co:5432/postgres
SUPABASE_URL=https://fussqdxbaglpgaivqtdb.supabase.co
SUPABASE_ANON_KEY=[SUPABASE_ANON_KEY]
SUPABASE_SERVICE_ROLE_KEY=[SUPABASE_SERVICE_ROLE_KEY]

# JWT Configuration
JWT_SECRET=[ROTATE_THIS_SECRET_MONTHLY]
JWT_EXPIRY=24h
JWT_REFRESH_EXPIRY=7d

# API Security
BCRYPT_ROUNDS=12
SESSION_SECRET=[ROTATE_THIS_SECRET_MONTHLY]
CSRF_SECRET=[ROTATE_THIS_SECRET_QUARTERLY]

# External Service API Keys
PLAID_CLIENT_ID=[PLAID_CLIENT_ID]
PLAID_SECRET=[PLAID_SECRET]
PLAID_ENV=sandbox  # Change to 'production' for live

STRIPE_PUBLIC_KEY=[STRIPE_PUBLIC_KEY]
STRIPE_SECRET_KEY=[STRIPE_SECRET_KEY]
STRIPE_WEBHOOK_SECRET=[STRIPE_WEBHOOK_SECRET]

# Third-party Services
SENDGRID_API_KEY=[SENDGRID_API_KEY]
TWILIO_ACCOUNT_SID=[TWILIO_ACCOUNT_SID]
TWILIO_AUTH_TOKEN=[ROTATE_THIS_SECRET_QUARTERLY]
TWILIO_PHONE_NUMBER=[TWILIO_PHONE_NUMBER]

# Cloud Storage
AWS_ACCESS_KEY_ID=[AWS_ACCESS_KEY_ID]
AWS_SECRET_ACCESS_KEY=[ROTATE_THIS_SECRET_QUARTERLY]
AWS_REGION=us-west-2
S3_BUCKET=vaultbank-production

# Monitoring & Observability
SENTRY_DSN=[SENTRY_DSN]
LOG_LEVEL=info
ENABLE_REQUEST_LOGGING=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=true

# Business Logic Configuration
REWARD_MULTIPLIER=2.0
MAX_TRANSACTION_AMOUNT=10000
MIN_TRANSACTION_AMOUNT=0.01
DAILY_TRANSFER_LIMIT=50000

# Compliance & Audit
AUDIT_LOG_RETENTION_DAYS=2555  # 7 years
ENABLE_AUDIT_LOGGING=true
ENABLE_AML_SCREENING=true
ENABLE_RISK_ENGINE=true

# Feature Flags
ENABLE_MFA=true
ENABLE_BIOMETRIC_AUTH=true
ENABLE_CRYPTO_SUPPORT=true
ENABLE_BUSINESS_FEATURES=true
ENABLE_INSURANCE_FEATURES=true
ENABLE_LENDING_FEATURES=true

# Performance Optimization
ENABLE_CACHING=true
CACHE_TTL=300  # 5 minutes
ENABLE_COMPRESSION=true
ENABLE_HTTP2=true

# Security Headers
ENFORCE_HTTPS=true
HSTS_MAX_AGE=31536000
CONTENT_SECURITY_POLICY="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"

# Email Configuration
MAIL_FROM=noreply@vaultbank.com
MAIL_FROM_NAME=VaultBank Security Team
ENABLE_EMAIL_VERIFICATION=true
ENABLE_EMAIL_NOTIFICATIONS=true

# SMS Configuration
SMS_FROM_NUMBER=[TWILIO_VERIFIED_NUMBER]
ENABLE_SMS_VERIFICATION=true
ENABLE_SMS_NOTIFICATIONS=true

# Push Notifications
VAPID_PUBLIC_KEY=[VAPID_PUBLIC_KEY]
VAPID_PRIVATE_KEY=[ROTATE_THIS_SECRET_QUARTERLY]

# Webhook Configuration
WEBHOOK_SECRET=[ROTATE_THIS_SECRET_MONTHLY]
ENABLE_WEBHOOK_SIGNING=true

# Business Configuration
COMPANY_NAME=VaultBank
COMPANY_SUPPORT_EMAIL=support@vaultbank.com
COMPANY_SUPPORT_PHONE=+1-800-VAULTBANK
SUPPORTED_CURRENCIES=USD,EUR,GBP,CAD,JPY
DEFAULT_CURRENCY=USD

# Compliance Configuration
KYC_REQUIRED=true
AML_SCREENING_REQUIRED=true
TRANSACTION_MONITORING=true
SUSPICIOUS_ACTIVITY_THRESHOLD=10000

# Backup Configuration
BACKUP_RETENTION_DAYS=30
ENABLE_AUTOMATIC_BACKUPS=true
BACKUP_S3_BUCKET=vaultbank-backups

# Development/Testing (Keep for emergency access)
DEBUG_MODE=false
EMERGENCY_MAINTENANCE_MODE=false
BYPASS_AUTH_FOR_TESTING=false
```

### Frontend Environment Variables (.env.production)

```bash
# ========================================
# VaultBank Frontend Production Configuration
# Generated: 2025-11-04 6:34:56 PM
# ========================================

# API Configuration
REACT_APP_API_BASE_URL=https://api.vaultbank.com
REACT_APP_WS_URL=wss://api.vaultbank.com

# Supabase Configuration
REACT_APP_SUPABASE_URL=https://fussqdxbaglpgaivqtdb.supabase.co
REACT_APP_SUPABASE_ANON_KEY=[SUPABASE_ANON_KEY]

# Application Configuration
REACT_APP_ENVIRONMENT=production
REACT_APP_VERSION=1.0.0
REACT_APP_NAME=VaultBank

# External Service Configuration
REACT_APP_STRIPE_PUBLIC_KEY=[STRIPE_PUBLIC_KEY]
REACT_APP_PLAID_ENV=sandbox  # Change to 'production' for live

# Feature Flags
REACT_APP_ENABLE_BIOMETRIC_AUTH=true
REACT_APP_ENABLE_CRYPTO_SUPPORT=true
REACT_APP_ENABLE_BUSINESS_FEATURES=true
REACT_APP_ENABLE_REWARDS_PROGRAM=true
REACT_APP_ENABLE_INSURANCE_FEATURES=true
REACT_APP_ENABLE_LENDING_FEATURES=true

# Monitoring & Analytics
REACT_APP_SENTRY_DSN=[SENTRY_DSN]
REACT_APP_GOOGLE_ANALYTICS_ID=[GOOGLE_ANALYTICS_ID]
REACT_APP_HOTJAR_ID=[HOTJAR_ID]

# Security Configuration
REACT_APP_CSRF_PROTECTION=true
REACT_APP_ENABLE_HSTS=true
REACT_APP_CONTENT_SECURITY_POLICY_ENABLED=true

# Performance Configuration
REACT_APP_ENABLE_SERVICE_WORKER=true
REACT_APP_ENABLE_PWA=true
REACT_APP_CACHE_TIMEOUT=300

# UI Configuration
REACT_APP_THEME=light
REACT_APP_ENABLE_DARK_MODE=true
REACT_APP_DEFAULT_LANGUAGE=en
REACT_APP_SUPPORTED_LANGUAGES=en,es,fr

# Business Configuration
REACT_APP_COMPANY_NAME=VaultBank
REACT_APP_SUPPORT_EMAIL=support@vaultbank.com
REACT_APP_SUPPORT_PHONE=+1-800-VAULTBANK

# Compliance Configuration
REACT_APP_SHOW_TERMS_OF_SERVICE=true
REACT_APP_SHOW_PRIVACY_POLICY=true
REACT_APP_REQUIRE_KYC_VERIFICATION=true
```

## 2. Secrets Rotation Schedule

### Monthly Rotation (Critical)

```bash
# Create monthly rotation script
cat > /opt/vaultbank/scripts/rotate-monthly-secrets.sh << 'EOF'
#!/bin/bash

# Monthly Secrets Rotation Script
# Rotates critical security secrets monthly

set -e

LOG_FILE="/var/log/vaultbank/secrets-rotation.log"
DATE=$(date +%Y%m%d-%H%M%S)

log() {
    echo "[$(date)] $1" | tee -a "$LOG_FILE"
}

log "Starting monthly secrets rotation..."

# Generate new secrets
NEW_JWT_SECRET=$(openssl rand -base64 64)
NEW_SESSION_SECRET=$(openssl rand -base64 64)
NEW_WEBHOOK_SECRET=$(openssl rand -base64 32)

log "Generated new secrets for: JWT_SECRET, SESSION_SECRET, WEBHOOK_SECRET"

# Update environment variables
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" /etc/vaultbank/.env.production
sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$NEW_SESSION_SECRET/" /etc/vaultbank/.env.production
sed -i "s/WEBHOOK_SECRET=.*/WEBHOOK_SECRET=$NEW_WEBHOOK_SECRET/" /etc/vaultbank/.env.production

# Update configuration database
# (Implementation would depend on your secrets management system)

# Restart services to pick up new secrets
systemctl restart vaultbank-api

log "Monthly secrets rotation completed successfully"

# Notify security team
echo "Monthly secrets rotation completed on $(date)" | \
  mail -s "VaultBank Monthly Secrets Rotation" security@vaultbank.com

EOF

chmod +x /opt/vaultbank/scripts/rotate-monthly-secrets.sh

# Add to crontab (first day of each month at 2 AM)
echo "0 2 1 * * /opt/vaultbank/scripts/rotate-monthly-secrets.sh" >> /etc/crontab
```

### Quarterly Rotation (Medium Priority)

```bash
# Create quarterly rotation script
cat > /opt/vaultbank/scripts/rotate-quarterly-secrets.sh << 'EOF'
#!/bin/bash

# Quarterly Secrets Rotation Script
# Rotates medium-priority secrets quarterly

set -e

LOG_FILE="/var/log/vaultbank/secrets-rotation.log"
DATE=$(date +%Y%m%d-%H%M%S)

log() {
    echo "[$(date)] $1" | tee -a "$LOG_FILE"
}

log "Starting quarterly secrets rotation..."

# Generate new secrets
NEW_CSRF_SECRET=$(openssl rand -base64 64)
NEW_VAPID_PRIVATE_KEY=$(openssl rand -base64 32)
NEW_TWILIO_AUTH_TOKEN=$(openssl rand -base64 32)

log "Generated new secrets for: CSRF_SECRET, VAPID_PRIVATE_KEY, TWILIO_AUTH_TOKEN"

# Update environment variables
sed -i "s/CSRF_SECRET=.*/CSRF_SECRET=$NEW_CSRF_SECRET/" /etc/vaultbank/.env.production
sed -i "s/VAPID_PRIVATE_KEY=.*/VAPID_PRIVATE_KEY=$NEW_VAPID_PRIVATE_KEY/" /etc/vaultbank/.env.production
sed -i "s/TWILIO_AUTH_TOKEN=.*/TWILIO_AUTH_TOKEN=$NEW_TWILIO_AUTH_TOKEN/" /etc/vaultbank/.env.production

# Restart services
systemctl restart vaultbank-api

log "Quarterly secrets rotation completed successfully"

EOF

chmod +x /opt/vaultbank/scripts/rotate-quarterly-secrets.sh

# Add to crontab (first day of quarter at 3 AM)
echo "0 3 1 1,4,7,10 * /opt/vaultbank/scripts/rotate-quarterly-secrets.sh" >> /etc/crontab
```

## 3. Secrets Management Tools

### HashiCorp Vault Integration (Recommended)

```bash
# Install HashiCorp Vault
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install vault

# Configure Vault for VaultBank
sudo mkdir -p /etc/vaultbank/vault
sudo tee /etc/vaultbank/vault/config.hcl << 'EOF'
storage "file" {
  path = "/var/lib/vault/data"
}

listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = 1
}

api_addr = "http://127.0.0.1:8200"
cluster_addr = "https://127.0.0.1:8201"
ui = true
EOF

# Start Vault service
sudo systemctl enable vault
sudo systemctl start vault

# Initialize Vault and store secrets
vault operator init
vault secrets enable database
vault secrets enable -path=secret kv-v2
```

### AWS Secrets Manager Integration (Alternative)

```bash
# Install AWS CLI and configure
aws configure set region us-west-2
aws configure set aws_access_key_id [AWS_ACCESS_KEY_ID]
aws configure set aws_secret_access_key [AWS_SECRET_ACCESS_KEY]

# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name vaultbank/database \
  --description "Database connection string" \
  --secret-string '{"DATABASE_URL": "postgresql://..."}'

aws secretsmanager create-secret \
  --name vaultbank/jwt \
  --description "JWT signing secret" \
  --secret-string '{"JWT_SECRET": "..."}'

aws secretsmanager create-secret \
  --name vaultbank/api-keys \
  --description "External API keys" \
  --secret-string '{"PLAID_SECRET": "...", "STRIPE_SECRET_KEY": "..."}'

# Create rotation Lambda function
aws lambda create-function \
  --function-name vaultbank-secrets-rotation \
  --runtime nodejs18.x \
  --role arn:aws:iam::[ACCOUNT-ID]:role/vaultbank-lambda-role \
  --handler index.handler \
  --zip-file fileb://secrets-rotation.zip

# Enable automatic rotation (every 30 days)
aws secretsmanager put-rotation-rules \
  --secret-id vaultbank/jwt \
  --automatically-after-days 30
```

## 4. Environment Validation Script

```bash
#!/bin/bash

# Environment Variables Validation Script
# Validates all required environment variables are set

set -e

ERRORS=0
WARNINGS=0

check_env_var() {
    local var_name="$1"
    local var_value="${!var_name}"

    if [ -z "$var_value" ]; then
        echo "ERROR: Environment variable $var_name is not set"
        ((ERRORS++))
    elif [ "$var_value" = "[PLACEHOLDER]" ] || [ "$var_value" = "[TO_BE_SET]" ]; then
        echo "WARNING: Environment variable $var_name contains placeholder value"
        ((WARNINGS++))
    else
        echo "OK: $var_name is set"
    fi
}

echo "=== VaultBank Environment Validation ==="
echo "Started at: $(date)"
echo

# Critical environment variables
echo "Checking critical environment variables..."
check_env_var "NODE_ENV"
check_env_var "JWT_SECRET"
check_env_var "DATABASE_URL"
check_env_var "SUPABASE_URL"
check_env_var "SUPABASE_SERVICE_ROLE_KEY"

# API Keys
echo "Checking API keys..."
check_env_var "PLAID_SECRET"
check_env_var "STRIPE_SECRET_KEY"
check_env_var "SENDGRID_API_KEY"

# Security settings
echo "Checking security settings..."
check_env_var "BCRYPT_ROUNDS"
check_env_var "SESSION_SECRET"

# External services
echo "Checking external service configuration..."
check_env_var "AWS_ACCESS_KEY_ID"
check_env_var "AWS_SECRET_ACCESS_KEY"

# Monitoring
echo "Checking monitoring configuration..."
check_env_var "SENTRY_DSN"

# Frontend environment variables
echo "Checking frontend environment variables..."
if [ -f "client/.env.production" ]; then
    source client/.env.production
    check_env_var "REACT_APP_API_BASE_URL"
    check_env_var "REACT_APP_SUPABASE_URL"
    check_env_var "REACT_APP_SUPABASE_ANON_KEY"
fi

echo
echo "=== Validation Summary ==="
echo "Errors: $ERRORS"
echo "Warnings: $WARNINGS"

if [ $ERRORS -gt 0 ]; then
    echo "FAILED: Environment validation failed with $ERRORS errors"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo "WARNING: Environment validation completed with $WARNINGS warnings"
    exit 2
else
    echo "SUCCESS: All environment variables are properly configured"
    exit 0
fi
```

## 5. Secrets Audit Script

```bash
#!/bin/bash

# Secrets Audit Script
# Scans for accidentally committed secrets in the codebase

echo "=== VaultBank Secrets Audit ==="
echo "Started at: $(date)"

# Check for common secret patterns
PATTERNS=(
    "password\s*=\s*['\"][^'\"]{8,}['\"]"
    "api[_-]?key\s*=\s*['\"][^'\"]{20,}['\"]"
    "secret\s*=\s*['\"][^'\"]{20,}['\"]"
    "token\s*=\s*['\"][^'\"]{20,}['\"]"
    "private[_-]?key\s*=\s*['\"][^'\"]{20,}['\"]"
)

echo "Scanning for potential secrets in codebase..."

for pattern in "${PATTERNS[@]}"; do
    echo "Checking pattern: $pattern"
    grep -rE "$pattern" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.sh" . || true
done

# Check for hardcoded credentials in configuration files
echo "Checking configuration files for hardcoded credentials..."
grep -rE "(password|api_key|secret|token).*=.*['\"][^'\"]{10,}['\"]" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.conf" --include="*.config" . || true

echo "Secrets audit completed at: $(date)"
```

## 6. Deployment Checklist

### Environment Setup Checklist

- [ ] All environment variables configured in .env.production
- [ ] Sensitive values replaced with secrets from secure storage
- [ ] Environment validation script passes
- [ ] Secrets rotation scripts configured
- [ ] Monitoring alerts configured for missing variables
- [ ] Secrets audit completed (no hardcoded secrets found)
- [ ] Backup of environment configuration created
- [ ] Access controls configured for environment files
- [ ] Documentation updated with new variable names
- [ ] Team trained on secrets management procedures

### Security Checklist

- [ ] All secrets generated using cryptographically secure methods
- [ ] No secrets stored in version control
- [ ] Least privilege access to environment files
- [ ] Regular rotation schedule implemented
- [ ] Monitoring for unauthorized access to secrets
- [ ] Incident response plan includes secrets compromise
- [ ] Compliance requirements met (PCI DSS, SOC 2, etc.)

---

**Next Actions:**

1. Set up secrets management system (Vault or AWS Secrets Manager)
2. Generate and store all required secrets
3. Configure environment variables in production
4. Implement rotation schedules
5. Set up monitoring and alerting
6. Train team on secrets management procedures

**Success Criteria:**

- [ ] All environment variables validated
- [ ] No hardcoded secrets in codebase
- [ ] Rotation schedule implemented and tested
- [ ] Monitoring and alerting functional
- [ ] Security audit passed with no issues
