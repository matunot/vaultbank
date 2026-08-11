#!/usr/bin/env bash
# scripts/wire-secret-vercel.sh
# Usage: ./scripts/wire-secret-vercel.sh <secret-name> <secret-value> [environment]
set -euo pipefail

SECRET_NAME="${1:-MONGODB_URI}"
SECRET_VALUE="${2:-}"
ENVIRONMENT="${3:-production}"

if [ -z "$SECRET_VALUE" ]; then
    echo "USAGE: $0 <secret-name> <secret-value> [environment]"
    echo "  secret-name:  Name of the secret in Vercel (default: MONGODB_URI)"
    echo "  secret-value: The MongoDB connection string"
    echo "  environment:  production|preview|development (default: production)"
    exit 1
fi

if ! command -v vercel &>/dev/null; then
    echo "❌ Vercel CLI not found. Install with: npm i -g vercel"
    exit 1
fi

echo "🔐 Wiring secret '$SECRET_NAME' into Vercel ($ENVIRONMENT)..."
echo "$SECRET_VALUE" | vercel env add "$SECRET_NAME" "$ENVIRONMENT" --token "$VERCEL_TOKEN" 2>/dev/null || \
    echo "$SECRET_VALUE" | vercel env add "$SECRET_NAME" "$ENVIRONMENT"

echo "✅ Secret '$SECRET_NAME' set in Vercel ($ENVIRONMENT)"