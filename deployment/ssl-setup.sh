#!/bin/bash

# SSL Certificate Setup Script for VaultBank Production
# This script sets up Let's Encrypt SSL certificates for vaultbank.com

set -e

echo "=== VaultBank SSL Certificate Setup ==="
echo "Started at: $(date)"
echo

# Variables
DOMAIN="vaultbank.com"
WWW_DOMAIN="www.vaultbank.com"
API_DOMAIN="api.vaultbank.com"
APP_DOMAIN="app.vaultbank.com"
EMAIL="admin@vaultbank.com"
SSL_DIR="/etc/letsencrypt/live/vaultbank.com"

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    apt update
    apt install -y certbot
fi

# Generate SSL certificates for all domains
echo "Generating SSL certificates for all domains..."
certbot certonly \
    --webroot \
    --webroot-path=/var/www/html \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --domains $DOMAIN,$WWW_DOMAIN,$API_DOMAIN,$APP_DOMAIN

# Set up auto-renewal
echo "Setting up auto-renewal..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

# Configure Nginx with SSL
echo "Configuring Nginx with SSL..."
cat > /etc/nginx/sites-available/vaultbank << 'EOF'
# VaultBank Production Configuration
server {
    listen 80;
    server_name vaultbank.com www.vaultbank.com api.vaultbank.com app.vaultbank.com;
    
    # Redirect all HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

# Frontend (app.vaultbank.com)
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
    
    root /var/www/vaultbank-app;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Backend API (api.vaultbank.com)
server {
    listen 443 ssl http2;
    server_name api.vaultbank.com;
    
    ssl_certificate /etc/letsencrypt/live/vaultbank.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vaultbank.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Admin panel
    location /admin {
        proxy_pass http://localhost:5000/admin;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}

# Main domain redirects to app
server {
    listen 443 ssl http2;
    server_name vaultbank.com www.vaultbank.com;
    
    ssl_certificate /etc/letsencrypt/live/vaultbank.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vaultbank.com/privkey.pem;
    
    return 301 https://app.vaultbank.com$request_uri;
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/vaultbank /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test configuration
nginx -t

echo "SSL setup completed successfully!"
echo "Certificates are located in: $SSL_DIR"
echo "Nginx configuration updated for VaultBank"
echo
echo "Next steps:"
echo "1. Deploy frontend to /var/www/vaultbank-app"
echo "2. Start the backend service"
echo "3. Restart Nginx: systemctl reload nginx"
echo "4. Test SSL: https://www.ssllabs.com/ssltest/"
