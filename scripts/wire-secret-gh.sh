#!/usr/bin/env bash
# scripts/wire-secret-gh.sh
# Usage: ./scripts/wire-secret-gh.sh <secret-name> <secret-value> [repo]
set -euo pipefail

SECRET_NAME="${1:-MONGODB_URI}"
SECRET_VALUE="${2:-}"
REPO="${3:-}"

if [ -z "$SECRET_VALUE" ]; then
    echo "USAGE: $0 <secret-name> <secret-value> [repo]"
    echo "  secret-name:  Name of the GitHub secret (default: MONGODB_URI)"
    echo "  secret-value: The MongoDB connection string"
    echo "  repo:         GitHub repo (default: auto-detected from git remote)"
    exit 1
fi

if ! command -v gh &>/dev/null; then
    echo "❌ GitHub CLI not found. Install from: https://cli.github.com/"
    exit 1
fi

if [ -z "$REPO" ]; then
    REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*[:/](.*)\.git#\1#')
fi

if [ -z "$REPO" ]; then
    echo "Could not detect repo. Specify as third argument."
    exit 1
fi

echo "🔐 Wiring secret '$SECRET_NAME' into GitHub repo '$REPO'..."
echo "$SECRET_VALUE" | gh secret set "$SECRET_NAME" --repo "$REPO" --body -
echo "✅ Secret '$SECRET_NAME' set in GitHub Actions ($REPO)"