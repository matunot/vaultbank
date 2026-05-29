#!/usr/bin/env bash

# ------------------------------------------------------------
# One‑line health‑check script for CI or local use.
# ------------------------------------------------------------
#
# This script runs a clean install, builds the client, and then
# performs a quick HTTP check against the provided Vercel URL.
#
# Usage (replace <your-vercel-url> with the actual URL or set the
# VERCEL_URL environment variable):
#   VERCEL_URL="https://<your-vercel-url>" ./scripts/health_check.sh
#
# The script will exit with a non‑zero status if any step fails.

set -euo pipefail

# Expect VERCEL_URL environment variable to be set.
if [[ -z "${VERCEL_URL:-}" ]]; then
  echo "Error: VERCEL_URL environment variable is not set."
  exit 1
fi

# Run a clean install, build, and perform a HEAD request.
npm ci && npm run build && curl -I "$VERCEL_URL" | head -n 5
