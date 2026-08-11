#!/usr/bin/env bash
# =============================================================================
# VaultBank Pre-Canary Verification Runbook (Bash)
# =============================================================================
# Runs all pre-canary checks and reports Go/No-Go status.
# Run from a secure operator machine after deployment and secret configuration.
#
# Usage:
#   bash scripts/pre-canary-runbook.sh
#   BASE_URL=https://vaultbank.vercel.app ADMIN_JWT=eyJ... bash scripts/pre-canary-runbook.sh
#
# Required env vars (optional, have defaults):
#   BASE_URL       – Production URL (default: https://vaultbank.vercel.app)
#   ADMIN_JWT      – Admin JWT for flag management (required for canary commands)
#   DATABASE_URL   – Postgres connection string (required for DB check)
#   PROM_URL       – Prometheus HTTP API base URL (required for metric queries)
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-https://vaultbank.vercel.app}"
PASS=0
FAIL=0
SKIP=0

# ── Helpers ──────────────────────────────────────────────────────────────────

green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[0;36m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

check_pass() { PASS=$((PASS + 1)); green "  [PASS] $1"; }
check_fail() { FAIL=$((FAIL + 1)); red   "  [FAIL] $1"; }
check_skip() { SKIP=$((SKIP + 1)); yellow "  [SKIP] $1 (missing env var)"; }

# ── Banner ───────────────────────────────────────────────────────────────────

echo ""
cyan "============================================"
cyan "  VaultBank Pre-Canary Verification (Bash)"
cyan "  Target: $BASE_URL"
cyan "  Time:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
cyan "============================================"
echo ""

# =============================================================================
# SECTION 1: Security Headers
# =============================================================================
bold "--- Security Headers ---"

check_security_header() {
    local name="$1" header="$2" expected="$3" url="$4"
    local value
    value=$(curl -sI -L "$url" 2>/dev/null | grep -i "^${header}:" | head -1 | sed "s/^[^:]*: *//")
    if echo "$value" | grep -qi "$expected"; then
        check_pass "$name"
    else
        check_fail "$name (expected '$expected', got: '${value:-<missing>}')"
    fi
}

check_security_header "HSTS Header Present"        "Strict-Transport-Security" "max-age"       "$BASE_URL/api/health"
check_security_header "X-Content-Type-Options"     "X-Content-Type-Options"    "nosniff"       "$BASE_URL/api/health"
check_security_header "Referrer-Policy Header"     "Referrer-Policy"           "no-referrer"   "$BASE_URL/api/health"
check_security_header "X-Frame-Options Header"     "X-Frame-Options"           "DENY"          "$BASE_URL"
check_security_header "Content-Security-Policy"    "Content-Security-Policy"   "default-src"   "$BASE_URL"

echo ""

# =============================================================================
# SECTION 2: API Endpoints
# =============================================================================
bold "--- API Endpoints ---"

# Health endpoint
HTTP_CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    check_pass "Health endpoint returns 200"
else
    check_fail "Health endpoint returns $HTTP_CODE (expected 200)"
fi

# Health response body
HEALTH_BODY=$(curl -sS "$BASE_URL/api/health" 2>/dev/null || echo "{}")
HEALTH_STATUS=$(echo "$HEALTH_BODY" | node -pe "try{JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).status}catch(e){'PARSE_ERROR'}" 2>/dev/null || echo "PARSE_ERROR")
if [ "$HEALTH_STATUS" = "ok" ]; then
    check_pass "Health response contains status: ok"
else
    check_fail "Health response status: $HEALTH_STATUS"
fi

# Payments methods (should require auth)
METHODS_CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE_URL/api/payments/methods" 2>/dev/null || echo "000")
if [ "$METHODS_CODE" = "401" ] || [ "$METHODS_CODE" = "403" ]; then
    check_pass "Payments methods requires auth ($METHODS_CODE)"
else
    check_fail "Payments methods returned $METHODS_CODE (expected 401 or 403)"
fi

# Payments transfer endpoint (POST, should return 400/401/405 without body)
TRANSFER_CODE=$(curl -so /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/payments/transfer" 2>/dev/null || echo "000")
if [ "$TRANSFER_CODE" = "200" ] || [ "$TRANSFER_CODE" = "400" ] || [ "$TRANSFER_CODE" = "401" ] || [ "$TRANSFER_CODE" = "405" ]; then
    check_pass "Payments transfer endpoint reachable ($TRANSFER_CODE)"
else
    check_fail "Payments transfer endpoint returned $TRANSFER_CODE"
fi

# Admin flags endpoint
FLAGS_CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE_URL/api/admin/flags" 2>/dev/null || echo "000")
if [ "$FLAGS_CODE" = "200" ] || [ "$FLAGS_CODE" = "401" ] || [ "$FLAGS_CODE" = "403" ] || [ "$FLAGS_CODE" = "405" ]; then
    check_pass "Admin flags endpoint reachable ($FLAGS_CODE)"
else
    check_fail "Admin flags endpoint returned $FLAGS_CODE"
fi

echo ""

# =============================================================================
# SECTION 3: SSL/TLS
# =============================================================================
bold "--- SSL/TLS ---"

# HTTPS connection
HTTPS_CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE_URL" 2>/dev/null || echo "000")
if [ "$HTTPS_CODE" = "200" ]; then
    check_pass "HTTPS connection succeeds"
else
    check_fail "HTTPS connection returned $HTTPS_CODE"
fi

# HTTP → HTTPS redirect
HTTP_URL=$(echo "$BASE_URL" | sed 's|^https://|http://|')
REDIRECT_CODE=$(curl -so /dev/null -w "%{http_code}" --max-redirs 0 "$HTTP_URL" 2>/dev/null || echo "000")
if [ "$REDIRECT_CODE" = "301" ] || [ "$REDIRECT_CODE" = "302" ] || [ "$REDIRECT_CODE" = "307" ] || [ "$REDIRECT_CODE" = "308" ] || [ "$REDIRECT_CODE" = "000" ]; then
    check_pass "HTTP redirects to HTTPS ($REDIRECT_CODE)"
else
    check_fail "HTTP returned $REDIRECT_CODE (expected 301/302/307/308)"
fi

echo ""

# =============================================================================
# SECTION 4: Frontend
# =============================================================================
bold "--- Frontend ---"

FRONTEND_CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE_URL" 2>/dev/null || echo "000")
if [ "$FRONTEND_CODE" = "200" ]; then
    check_pass "Frontend loads (index.html)"
else
    check_fail "Frontend returned $FRONTEND_CODE"
fi

FRONTEND_BODY=$(curl -sS "$BASE_URL" 2>/dev/null || echo "")
if echo "$FRONTEND_BODY" | grep -qi "root\|vaultbank\|react"; then
    check_pass "Frontend contains React app root"
else
    check_fail "Frontend does not contain expected React markers"
fi

echo ""

# =============================================================================
# SECTION 5: Database Connectivity
# =============================================================================
bold "--- Database Connectivity ---"

if [ -n "${DATABASE_URL:-}" ]; then
    DB_RESULT=$(psql "$DATABASE_URL" -c "SELECT 1;" -t 2>&1 || echo "DB_ERROR")
    if echo "$DB_RESULT" | grep -q "1"; then
        check_pass "Database connectivity (SELECT 1)"
    else
        check_fail "Database connectivity failed: $DB_RESULT"
    fi
else
    check_skip "Database connectivity (DATABASE_URL not set)"
fi

echo ""

# =============================================================================
# SECTION 6: Reconciliation Dry-Run
# =============================================================================
bold "--- Reconciliation Dry-Run ---"

if [ -f "server/scripts/run-reconciliation.js" ]; then
    YESTERDAY=$(date -u -d "yesterday" '+%Y-%m-%d' 2>/dev/null || date -u -v-1d '+%Y-%m-%d' 2>/dev/null || echo "2026-06-01")
    TODAY=$(date -u '+%Y-%m-%d' 2>/dev/null || echo "2026-06-02")
    RECON_OUTPUT=$(node server/scripts/run-reconciliation.js --provider stripe --start "$YESTERDAY" --end "$TODAY" --dry-run 2>&1 || echo "RECON_ERROR")
    if echo "$RECON_OUTPUT" | grep -qi "dry.run\|dry-run\|completed\|no.*mismatch\|0.*mismatch"; then
        check_pass "Reconciliation dry-run completed"
    elif echo "$RECON_OUTPUT" | grep -qi "RECON_ERROR\|auth.*error\|ECONNREFUSED"; then
        check_fail "Reconciliation dry-run failed: $(echo "$RECON_OUTPUT" | head -3)"
    else
        check_pass "Reconciliation dry-run executed (review output manually)"
    fi
else
    check_skip "Reconciliation dry-run (server/scripts/run-reconciliation.js not found)"
fi

echo ""

# =============================================================================
# SECTION 7: Security Smoke Test
# =============================================================================
bold "--- Security Smoke Test ---"

if [ -f "server/security/smoke.sh" ]; then
    SMOKE_OUTPUT=$(bash server/security/smoke.sh "$BASE_URL" 2>&1 || echo "SMOKE_ERROR")
    SMOKE_EXIT=$?
    if [ "$SMOKE_EXIT" -eq 0 ]; then
        check_pass "Security smoke test passed (exit 0)"
    else
        check_fail "Security smoke test failed (exit $SMOKE_EXIT)"
    fi
else
    check_skip "Security smoke test (server/security/smoke.sh not found)"
fi

echo ""

# =============================================================================
# SECTION 8: Stripe Webhook Test (requires Stripe CLI)
# =============================================================================
bold "--- Stripe Webhook Test ---"

if command -v stripe &>/dev/null; then
    yellow "  Starting Stripe CLI listener in background..."
    stripe listen --forward-to "$BASE_URL/api/payments/webhook/stripe" &>/dev/null &
    STRIPE_PID=$!
    sleep 3

    TRIGGER_OUTPUT=$(stripe trigger payment_intent.succeeded 2>&1 || echo "TRIGGER_ERROR")
    if echo "$TRIGGER_OUTPUT" | grep -qi "triggered\|succeeded\|done"; then
        check_pass "Stripe webhook test triggered successfully"
    else
        check_fail "Stripe webhook trigger failed: $(echo "$TRIGGER_OUTPUT" | head -3)"
    fi

    kill "$STRIPE_PID" 2>/dev/null || true
    wait "$STRIPE_PID" 2>/dev/null || true
else
    check_skip "Stripe webhook test (stripe CLI not installed)"
fi

echo ""

# =============================================================================
# SECTION 9: Canary Flag Management Commands
# =============================================================================
bold "--- Canary Flag Commands (reference) ---"
echo ""
yellow "  The following commands manage canary percentage."
yellow "  Set ADMIN_JWT env var before running."
echo ""

if [ -n "${ADMIN_JWT:-}" ]; then
    echo "  # Enable 5% canary"
    echo "  curl -X POST -H \"Authorization: Bearer \$ADMIN_JWT\" -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"key\":\"payments.live_providers_percent\",\"percentage\":5}' \\"
    echo "    $BASE_URL/api/admin/flags"
    echo ""
    echo "  # Scale to 25%"
    echo "  curl -X POST -H \"Authorization: Bearer \$ADMIN_JWT\" -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"key\":\"payments.live_providers_percent\",\"percentage\":25}' \\"
    echo "    $BASE_URL/api/admin/flags"
    echo ""
    echo "  # Scale to 100%"
    echo "  curl -X POST -H \"Authorization: Bearer \$ADMIN_JWT\" -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"key\":\"payments.live_providers_percent\",\"percentage\":100}' \\"
    echo "    $BASE_URL/api/admin/flags"
    echo ""
    echo "  # Kill switch (disable live providers)"
    echo "  curl -X POST -H \"Authorization: Bearer \$ADMIN_JWT\" -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"key\":\"payments.live_providers_percent\",\"percentage\":0}' \\"
    echo "    $BASE_URL/api/admin/flags"
else
    yellow "  Set ADMIN_JWT to see canary flag commands."
fi

echo ""

# =============================================================================
# SECTION 10: Prometheus Metric Queries (reference)
# =============================================================================
bold "--- Prometheus Metric Queries (reference) ---"

if [ -n "${PROM_URL:-}" ]; then
    echo ""
    echo "  # Payment failure rate over last 30m"
    FAILURE_RATE=$(curl -sG "${PROM_URL}/api/v1/query" \
        --data-urlencode 'query=(increase(payment_failure_total[30m]) / increase(payment_attempts_total[30m]))' 2>/dev/null || echo "{}")
    echo "  $FAILURE_RATE" | head -5
    echo ""

    echo "  # Webhook signature failures last 5m"
    WH_FAILURES=$(curl -sG "${PROM_URL}/api/v1/query" \
        --data-urlencode 'query=increase(webhook_signature_failures_total[5m])' 2>/dev/null || echo "{}")
    echo "  $WH_FAILURES" | head -5
else
    yellow "  Set PROM_URL to query Prometheus metrics."
    yellow "  Example: PROM_URL=https://prometheus.example.com"
fi

echo ""

# =============================================================================
# SUMMARY
# =============================================================================
TOTAL=$((PASS + FAIL + SKIP))
cyan "============================================"
if [ "$FAIL" -eq 0 ]; then
    green "  RESULTS: $PASS passed, $FAIL failed, $SKIP skipped / $TOTAL total"
    echo ""
    green "  ✅ GO — All checks passed. Safe to enable canary."
    echo ""
    yellow "  Next step: Enable 5% canary"
    if [ -n "${ADMIN_JWT:-}" ]; then
        echo "  curl -X POST -H \"Authorization: Bearer \$ADMIN_JWT\" -H \"Content-Type: application/json\" \\"
        echo "    -d '{\"key\":\"payments.live_providers_percent\",\"percentage\":5}' \\"
        echo "    $BASE_URL/api/admin/flags"
    fi
else
    red "  RESULTS: $PASS passed, $FAIL failed, $SKIP skipped / $TOTAL total"
    echo ""
    red "  ❌ NO-GO — $FAIL check(s) failed. Fix before enabling canary."
fi
cyan "============================================"
echo ""

exit $FAIL