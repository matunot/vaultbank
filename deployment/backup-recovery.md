# VaultBank Backup & Recovery Procedures

## Backup Strategy Overview

### 1. Database Backups (Supabase)

#### Automated Daily Backups

```bash
# Supabase provides automatic daily backups
# Configuration in Supabase Dashboard:
# - Backup retention: 30 days
# - Point-in-time recovery: 7 days
# - Backup schedule: Daily at 2:00 AM UTC
```

#### Manual Backup Script

```bash
#!/bin/bash

# Manual Database Backup Script
# Execute before major deployments or changes

BACKUP_NAME="vaultbank-backup-$(date +%Y%m%d-%H%M%S)"
PROJECT_ID="fussqdxbaglpgaivqtdb"
BACKUP_DIR="/var/backups/database"

echo "=== VaultBank Database Backup ==="
echo "Started at: $(date)"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Export database schema and data
pg_dump "postgresql://postgres:[PASSWORD]@db.${PROJECT_ID}.supabase.co:5432/postgres" \
  --verbose \
  --clean \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="$BACKUP_DIR/$BACKUP_NAME.dump"

# Compress backup
gzip "$BACKUP_DIR/$BACKUP_NAME.dump"

# Upload to cloud storage (AWS S3)
aws s3 cp "$BACKUP_DIR/$BACKUP_NAME.dump.gz" \
  s3://vaultbank-backups/database/ \
  --server-side-encryption AES256

# Clean up local backup (keep last 7 days)
find "$BACKUP_DIR" -name "*.dump.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_NAME.dump.gz"
echo "Size: $(du -h "$BACKUP_DIR/$BACKUP_NAME.dump.gz" | cut -f1)"
```

### 2. Application Files Backup

#### Frontend Assets

```bash
# Backup deployed frontend
rsync -avz /var/www/vaultbank-app/ \
  "/var/backups/frontend/deployment-$(date +%Y%m%d-%H%M%S)/"

# Upload to S3
aws s3 sync "/var/backups/frontend/" \
  s3://vaultbank-backups/frontend/ \
  --server-side-encryption AES256
```

#### Backend Configuration

```bash
# Backup application files
tar -czf "/var/backups/application/vaultbank-app-$(date +%Y%m%d-%H%M%S).tar.gz" \
  /var/www/vaultbank-api/ \
  /etc/nginx/sites-available/vaultbank* \
  /etc/systemd/system/vaultbank* \
  --exclude=node_modules \
  --exclude=.git

# Backup Docker containers
docker save vaultbank-api:prod | gzip > \
  "/var/backups/docker/vaultbank-api-$(date +%Y%m%d-%H%M%S).tar.gz"

# Backup environment files (encrypted)
gpg --symmetric --cipher-algo AES256 \
  --output "/var/backups/secrets/vaultbank-secrets-$(date +%Y%m%d-%H%M%S).gpg" \
  /etc/vaultbank/.env.production
```

### 3. SSL Certificates Backup

```bash
# Backup SSL certificates
cp -r /etc/letsencrypt/live/vaultbank.com/ \
  "/var/backups/ssl/vaultbank-$(date +%Y%m%d-%H%M%S)/"

# Backup certificate renewal configuration
cp /etc/cron.d/certbot \
  "/var/backups/ssl/certbot-cron-$(date +%Y%m%d-%H%M%S)"
```

## Recovery Procedures

### 1. Database Recovery

#### Point-in-Time Recovery (Supabase)

```bash
#!/bin/bash

# Point-in-Time Recovery Script
# Usage: ./recover-database.sh <backup_timestamp> <target_timestamp>

BACKUP_TIMESTAMP="$1"
TARGET_TIMESTAMP="$2"
BACKUP_DIR="/var/backups/database"

if [ -z "$BACKUP_TIMESTAMP" ] || [ -z "$TARGET_TIMESTAMP" ]; then
    echo "Usage: $0 <backup_timestamp> <target_timestamp>"
    echo "Example: $0 20251104-060000 20251104-120000"
    exit 1
fi

BACKUP_FILE="$BACKUP_DIR/vaultbank-backup-$BACKUP_TIMESTAMP.dump.gz"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "=== VaultBank Database Recovery ==="
echo "Restoring from: $BACKUP_TIMESTAMP"
echo "Target time: $TARGET_TIMESTAMP"
echo "Started at: $(date)"

# Create recovery database
createdb "vaultbank_recovery_$TARGET_TIMESTAMP"

# Restore from backup
gunzip -c "$BACKUP_FILE" | \
  psql "postgresql://postgres:[PASSWORD]@db.fussqdxbaglpgaivqtdb.supabase.co:5432/vaultbank_recovery_$TARGET_TIMESTAMP"

echo "Recovery completed. Database: vaultbank_recovery_$TARGET_TIMESTAMP"
```

#### Full Database Restore

```bash
# Download backup from S3
aws s3 cp s3://vaultbank-backups/database/vaultbank-backup-latest.dump.gz /tmp/

# Restore database
gunzip -c /tmp/vaultbank-backup-latest.dump.gz | \
  psql "postgresql://postgres:[PASSWORD]@db.fussqdxbaglpgaivqtdb.supabase.co:5432/postgres"
```

### 2. Application Recovery

#### Frontend Recovery

```bash
#!/bin/bash

# Frontend Recovery Script

BACKUP_DIR="/var/backups/frontend"
TARGET_DIR="/var/www/vaultbank-app"
DEPLOYMENT_TIMESTAMP="$1"

if [ -z "$DEPLOYMENT_TIMESTAMP" ]; then
    echo "Usage: $0 <deployment_timestamp>"
    echo "Example: $0 20251104-060000"
    exit 1
fi

BACKUP_PATH="$BACKUP_DIR/deployment-$DEPLOYMENT_TIMESTAMP"

if [ ! -d "$BACKUP_PATH" ]; then
    echo "ERROR: Backup not found: $BACKUP_PATH"
    exit 1
fi

echo "=== Frontend Recovery ==="
echo "Recovering from: $DEPLOYMENT_TIMESTAMP"
echo "Started at: $(date)"

# Stop web server
sudo systemctl stop nginx

# Restore files
sudo rm -rf "$TARGET_DIR"
sudo mkdir -p "$TARGET_DIR"
sudo cp -r "$BACKUP_PATH/"* "$TARGET_DIR/"
sudo chown -R www-data:www-data "$TARGET_DIR"
sudo chmod -R 755 "$TARGET_DIR"

# Start web server
sudo systemctl start nginx

echo "Frontend recovery completed"
```

#### Backend Recovery

```bash
#!/bin/bash

# Backend Recovery Script

BACKUP_DIR="/var/backups/application"
DOCKER_BACKUP_DIR="/var/backups/docker"
TARGET_DIR="/var/www/vaultbank-api"
DEPLOYMENT_TIMESTAMP="$1"

if [ -z "$DEPLOYMENT_TIMESTAMP" ]; then
    echo "Usage: $0 <deployment_timestamp>"
    exit 1
fi

TAR_FILE="$BACKUP_DIR/vaultbank-app-$DEPLOYMENT_TIMESTAMP.tar.gz"
DOCKER_BACKUP="$DOCKER_BACKUP_DIR/vaultbank-api-$DEPLOYMENT_TIMESTAMP.tar.gz"

echo "=== Backend Recovery ==="
echo "Recovering from: $DEPLOYMENT_TIMESTAMP"

# Stop services
sudo systemctl stop vaultbank-api
docker stop vaultbank-container || true

# Restore application files
sudo rm -rf "$TARGET_DIR"
sudo mkdir -p "$TARGET_DIR"
tar -xzf "$TAR_FILE" -C /var/www/

# Restore Docker image (if available)
if [ -f "$DOCKER_BACKUP" ]; then
    docker load < "$DOCKER_BACKUP"
    docker run -d \
      --name vaultbank-container \
      -p 5000:5000 \
      --env-file /etc/vaultbank/.env.production \
      vaultbank-api:prod
else
    # Restore from source and rebuild
    cd "$TARGET_DIR"
    npm ci --production
    npm start
fi

# Start services
sudo systemctl start vaultbank-api

echo "Backend recovery completed"
```

### 3. SSL Certificate Recovery

```bash
#!/bin/bash

# SSL Certificate Recovery Script

SSL_BACKUP_DIR="/var/backups/ssl"
CERT_TIMESTAMP="$1"

if [ -z "$CERT_TIMESTAMP" ]; then
    echo "Usage: $0 <certificate_timestamp>"
    echo "Available backups:"
    ls -la "$SSL_BACKUP_DIR"
    exit 1
fi

SSL_BACKUP_PATH="$SSL_BACKUP_DIR/vaultbank-$CERT_TIMESTAMP"

echo "=== SSL Certificate Recovery ==="
echo "Recovering from: $CERT_TIMESTAMP"

# Backup current certificates
sudo cp -r /etc/letsencrypt/live/vaultbank.com/ \
  "/etc/letsencrypt/live/vaultbank.com.backup.$(date +%Y%m%d-%H%M%S)"

# Restore certificates
sudo cp -r "$SSL_BACKUP_PATH/"* \
  /etc/letsencrypt/live/vaultbank.com/

# Restart services
sudo systemctl reload nginx

echo "SSL certificate recovery completed"
```

## Disaster Recovery Plan

### Recovery Time Objectives (RTO)

| Component            | RTO        | RPO        |
| -------------------- | ---------- | ---------- |
| Frontend Application | 15 minutes | 1 hour     |
| Backend API          | 30 minutes | 15 minutes |
| Database             | 2 hours    | 5 minutes  |
| SSL Certificates     | 10 minutes | 24 hours   |
| Full System          | 4 hours    | 1 hour     |

### Recovery Scenarios

#### Scenario 1: Database Corruption

1. **Detection**: Automated monitoring alerts
2. **Immediate Response**:
   - Switch to read-only mode
   - Identify last good backup
3. **Recovery**:
   - Restore from point-in-time backup
   - Verify data integrity
   - Resume normal operations
4. **Timeline**: 1-2 hours

#### Scenario 2: Complete Server Failure

1. **Detection**: Uptime monitoring fails
2. **Immediate Response**:
   - Activate backup server
   - Update DNS to backup server
3. **Recovery**:
   - Restore application files
   - Restore database
   - Restore SSL certificates
   - Update monitoring
4. **Timeline**: 2-4 hours

#### Scenario 3: Security Breach

1. **Detection**: Security monitoring alerts
2. **Immediate Response**:
   - Isolate affected systems
   - Preserve evidence
   - Notify stakeholders
3. **Recovery**:
   - Restore from clean backup
   - Update security patches
   - Audit access logs
   - Test for vulnerabilities
4. **Timeline**: 4-8 hours

### Automated Backup Verification

```bash
#!/bin/bash

# Backup Verification Script
# Runs daily to verify backup integrity

BACKUP_DIR="/var/backups"
VERIFICATION_LOG="/var/log/backup-verification.log"

echo "=== Backup Verification ===" | tee -a "$VERIFICATION_LOG"
echo "Started at: $(date)" | tee -a "$VERIFICATION_LOG"

# Verify database backups
for backup in "$BACKUP_DIR"/database/*.dump.gz; do
    if gzip -t "$backup" 2>/dev/null; then
        echo "✓ Database backup OK: $(basename "$backup")" | tee -a "$VERIFICATION_LOG"
    else
        echo "✗ Database backup CORRUPTED: $(basename "$backup")" | tee -a "$VERIFICATION_LOG"
        # Send alert
        echo "CRITICAL: Corrupted database backup detected: $(basename "$backup")" | \
          mail -s "VaultBank Backup Alert" admin@vaultbank.com
    fi
done

# Verify application backups
for backup in "$BACKUP_DIR"/application/*.tar.gz; do
    if tar -tzf "$backup" >/dev/null 2>&1; then
        echo "✓ Application backup OK: $(basename "$backup")" | tee -a "$VERIFICATION_LOG"
    else
        echo "✗ Application backup CORRUPTED: $(basename "$backup")" | tee -a "$VERIFICATION_LOG"
    fi
done

echo "Verification completed at: $(date)" | tee -a "$VERIFICATION_LOG"
```

## Monitoring & Alerting

### Backup Health Checks

```bash
# Add to crontab for daily verification
0 3 * * * /opt/vaultbank/scripts/verify-backups.sh

# Add to crontab for weekly test restore
0 4 * * 0 /opt/vaultbank/scripts/test-restore.sh
```

### Alert Configuration

1. **Backup Failure Alerts**

   - Failed backup completion
   - Backup size anomalies
   - Corruption detection

2. **Recovery Testing Alerts**

   - Failed test restore
   - Data integrity issues
   - Performance degradation

3. **Capacity Alerts**
   - Backup storage > 80% full
   - Retention policy violations
   - Cloud storage issues

## Documentation & Training

### Recovery Documentation

- [ ] Recovery procedures documented
- [ ] Contact information updated
- [ ] Escalation procedures defined
- [ ] Communication templates prepared

### Team Training

- [ ] Recovery team identified and trained
- [ ] Tabletop exercises conducted
- [ ] Recovery tools tested
- [ ] Documentation reviewed

### Testing Schedule

- **Weekly**: Backup verification
- **Monthly**: Test restore procedure
- **Quarterly**: Full disaster recovery drill
- **Annually**: Recovery plan review

---

**Backup Schedule:**

- **Database**: Daily at 2:00 AM UTC
- **Application Files**: After each deployment
- **SSL Certificates**: Weekly
- **Configuration**: Before each change
- **Full System**: Monthly

**Success Criteria:**

- [ ] All backups automated and verified
- [ ] Recovery procedures tested and documented
- [ ] RTO/RPO objectives met
- [ ] Monitoring and alerting functional
- [ ] Team training completed
