#!/bin/bash

# ============================================================================
# VaultBank Production Deployment Script
# ============================================================================
# This script handles the complete production deployment including:
# - Environment validation
# - Database migrations
# - SSL certificate setup
# - Container deployment
# - Health checks
# - Monitoring setup
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENV_FILE="server/.env.production"
COMPOSE_FILE="server/docker-compose.prod.yml"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    log_info "Checking deployment requirements..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi

    # Check environment file
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Production environment file not found: $ENV_FILE"
        log_info "Copy .env.production template and configure your secrets"
        exit 1
    fi

    log_success "Requirements check passed"
}

validate_environment() {
    log_info "Validating environment configuration..."

    # Check required environment variables
    required_vars=(
        "DATABASE_URL"
        "SUPABASE_URL"
        "SUPABASE_ANON_KEY"
        "JWT_SECRET"
        "ENCRYPTION_KEY"
    )

    missing_vars=()
    for var in "${required_vars[@]}"; do
        if ! grep -q "^$var=" "$ENV_FILE" || grep -q "^$var=your-" "$ENV_FILE"; then
            missing_vars+=("$var")
        fi
    done

    if [ ${#missing_vars[@]} -ne 0 ]; then
        log_error "Missing or placeholder environment variables:"
        printf '%s\n' "${missing_vars[@]}"
        exit 1
    fi

    log_success "Environment validation passed"
}

setup_ssl_certificates() {
    log_info "Setting up SSL certificates..."

    SSL_DIR="server/nginx/ssl"
    mkdir -p "$SSL_DIR"

    # Check if certificates exist
    if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
        log_warn "SSL certificates not found in $SSL_DIR"
        log_info "Please obtain SSL certificates and place them in $SSL_DIR/"
        log_info "For Let's Encrypt: certbot certonly --webroot -w /var/www/html -d vaultbank.com"
        log_info "For development: openssl req -x509 -newkey rsa:4096 -keyout privkey.pem -out fullchain.pem -days 365 -nodes"
        exit 1
    fi

    log_success "SSL certificates configured"
}

build_and_deploy() {
    log_info "Building and deploying VaultBank..."

    cd server

    # Stop existing containers
    log_info "Stopping existing containers..."
    docker-compose -f docker-compose.prod.yml down || true

    # Build and start containers
    log_info "Building and starting containers..."
    docker-compose -f docker-compose.prod.yml up -d --build

    # Wait for services to start
    log_info "Waiting for services to start..."
    sleep 30

    log_success "Deployment completed"
}

run_health_checks() {
    log_info "Running health checks..."

    # Backend health check
    max_attempts=10
    attempt=1

    while [ $attempt -le $max_attempts ]; do
        log_info "Health check attempt $attempt/$max_attempts"

        if curl -f -s "http://localhost:8080/health" > /dev/null; then
            log_success "Backend health check passed"
            break
        else
            log_warn "Backend not ready, waiting..."
            sleep 10
            ((attempt++))
        fi
    done

    if [ $attempt -gt $max_attempts ]; then
        log_error "Backend health check failed after $max_attempts attempts"
        exit 1
    fi

    # Nginx health check
    if curl -f -s "http://localhost/health" > /dev/null; then
        log_success "Nginx health check passed"
    else
        log_error "Nginx health check failed"
        exit 1
    fi
}

setup_monitoring() {
    log_info "Setting up monitoring..."

    # Install basic monitoring scripts
    cat > monitoring.sh << 'EOF'
#!/bin/bash
# VaultBank Monitoring Script

# Backend health
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
if [ "$BACKEND_STATUS" != "200" ]; then
    echo "ALERT: Backend unhealthy (Status: $BACKEND_STATUS)"
    # Send alert to admin
fi

# Database connection check
# Add PostgreSQL health check here

# Disk space check
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "ALERT: High disk usage ($DISK_USAGE%)"
fi

# Memory usage check
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
if [ "$MEMORY_USAGE" -gt 85 ]; then
    echo "ALERT: High memory usage ($MEMORY_USAGE%)"
fi
EOF

    chmod +x monitoring.sh
    log_success "Monitoring script created"
}

run_database_migrations() {
    log_info "Running database migrations..."

    # Execute migrations in container
    docker-compose -f docker-compose.prod.yml exec -T vaultbank-backend npm run migrate:up

    if [ $? -eq 0 ]; then
        log_success "Database migrations completed"
    else
        log_error "Database migrations failed"
        exit 1
    fi
}

main() {
    echo "
╔══════════════════════════════════════════════════════════════╗
║                     🏦 VAULTBANK DEPLOYMENT                     ║
║                    Production Launch Script                   ║
╚══════════════════════════════════════════════════════════════╝
"

    check_requirements
    validate_environment
    setup_ssl_certificates
    build_and_deploy
    run_database_migrations
    run_health_checks
    setup_monitoring

    echo "
╔══════════════════════════════════════════════════════════════╗
║                    🎉 DEPLOYMENT COMPLETE!                  ║
║                                                              ║
║  VaultBank is now live at:                                   ║
║  🌐 https://vaultbank.com                                   ║
║  📡 API: https://api.vaultbank.com                          ║
║                                                              ║
║  Next steps:                                                ║
║  1. Configure DNS records                                   ║
║  2. Set up domain SSL certificates                         ║
║  3. Configure monitoring alerts                            ║
║  4. Run smoke tests                                        ║
║  5. Create admin user                                      ║
╚══════════════════════════════════════════════════════════════╝
"

    log_success "VaultBank deployment completed successfully!"
}

# Handle command line arguments
case "${1:-}" in
    "health")
        run_health_checks
        ;;
    "migrate")
        run_database_migrations
        ;;
    "restart")
        cd server && docker-compose -f docker-compose.prod.yml restart
        ;;
    "logs")
        cd server && docker-compose -f docker-compose.prod.yml logs -f
        ;;
    *)
        main
        ;;
esac
