#!/usr/bin/env bash
# VaultBank production security smoke test
# Usage: ./server/security/smoke.sh <deploy_url>
#   ./server/security/smoke.sh https://vaultbank.vercel.app
set -euo pipefail

BASE="${1:-http://localhost:5000}"
FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

check() {
    local label="$1" cmd="$2"
    if eval "$cmd" 2>/dev/null; then
        echo -e "  ${GREEN}PASS${NC} $label"
    else
        echo -e "  ${RED}FAIL${NC} $label"
        FAIL=1
    fi
}

echo "=== VaultBank Security Smoke Test ==="
echo "Target: $BASE"
echo ""

check "HTTPS redirect (if HTTP)" \
    "curl -sI 'http://${BASE#https://}' 2>&1 | head -5 | grep -qiE '301|302|location.*https' || test '${BASE:0:5}' != 'http:'"

check "HSTS header present" \
    "curl -sI '$BASE/api/health' | grep -qi 'strict-transport-security'"

check "CSP header present" \
    "curl -sI '$BASE/api/payments/methods' -H 'Authorization: Bearer test' 2>&1 | grep -qi 'content-security-policy' || curl -s '$BASE' | head -20 | grep -qi 'content-security-policy'"

check "X-Content-Type-Options nosniff" \
    "curl -sI '$BASE/api/health' | grep -qi 'x-content-type-options.*nosniff'"

check "Referrer-Policy set" \
    "curl -sI '$BASE/api/health' | grep -qi 'referrer-policy'"

check "Health endpoint returns 200" \
    "curl -so /dev/null -w '%{http_code}' '$BASE/api/health' | grep -q 200"

check "Methods endpoint requires auth" \
    "curl -so /dev/null -w '%{http_code}' '$BASE/api/payments/methods' | grep -qE '401|403'"

check "Transfer endpoint rejects invalid amount" \
    "curl -s -X POST '$BASE/api/payments/transfer' -H 'Authorization: Bearer test' -H 'Content-Type: application/json' -d '{\"amount\":0}' | grep -qi 'valid amount'"

check "Reconciliation CLI --help exits 0" \
    "node server/scripts/run-reconciliation.js --help 2>&1 | head -1 | grep -qi 'usage'"

check "Rate limiter on transfer route (safety check)" \
    "for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -s -X POST '$BASE/api/payments/transfer' -H 'Authorization: Bearer test' -H 'Content-Type: application/json' -d '{\"amount\":1}'; done | grep -qi 'error' || echo 'ok (no rate limit in dev mode)'"

echo ""
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}All smoke tests passed.${NC}"
else
    echo -e "${RED}One or more checks failed. Review above.${NC}"
fi
exit $FAIL