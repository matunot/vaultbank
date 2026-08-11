#!/usr/bin/env bash
# =============================================================================
# VaultBank Notification Sender
# =============================================================================
# Sends incident notifications to Slack and PagerDuty.
# Replace placeholder values before use.
#
# Usage:
#   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX bash scripts/notification-payloads/send-notifications.sh
#   PAGERDUTY_KEY=xxx bash scripts/notification-payloads/send-notifications.sh payment-failure
#   bash scripts/notification-payloads/send-notifications.sh --help
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Config ───────────────────────────────────────────────────────────────────
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
PAGERDUTY_KEY="${PAGERDUTY_KEY:-REPLACE_PAGERDUTY_INTEGRATION_KEY}"
PAGERDUTY_ENDPOINT="https://events.pagerduty.com/v2/enqueue"

# ── Helpers ──────────────────────────────────────────────────────────────────

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
cyan()  { printf '\033[0;36m%s\033[0m\n' "$*"; }

usage() {
    cat <<EOF
VaultBank Notification Sender

Usage:
  $0 <alert-type>        Send a notification
  $0 --help              Show this help

Alert types:
  payment-failure        High payment failure rate alert (Slack + PagerDuty)
  webhook-signature      Webhook signature failure alert (Slack only)
  all                    Send all alert types

Environment variables:
  SLACK_WEBHOOK_URL      Slack incoming webhook URL (required for Slack alerts)
  PAGERDUTY_KEY          PagerDuty Events API v2 integration key (required for PagerDuty)

Examples:
  # Send payment failure alert to Slack
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXX $0 payment-failure

  # Send payment failure alert to PagerDuty
  PAGERDUTY_KEY=abc123 $0 payment-failure

  # Send to both (set both env vars)
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXX PAGERDUTY_KEY=abc123 $0 all
EOF
}

send_slack() {
    local payload_file="$1"
    if [ -z "$SLACK_WEBHOOK_URL" ]; then
        red "  [SKIP] SLACK_WEBHOOK_URL not set — skipping Slack notification"
        return 0
    fi

    # Replace template placeholders with current timestamp
    local payload
    payload=$(sed \
        -e "s/{{timestamp}}/$(date -u '+%Y-%m-%d %H:%M:%S UTC')/g" \
        -e "s/{{failure_rate}}/N/A (check Prometheus)/g" \
        -e "s/{{count}}/N/A/g" \
        -e "s/{{provider}}/All/g" \
        "$payload_file")

    local http_code
    http_code=$(curl -so /dev/null -w "%{http_code}" \
        -X POST -H 'Content-Type: application/json' \
        --data "$payload" \
        "$SLACK_WEBHOOK_URL" 2>/dev/null || echo "000")

    if [ "$http_code" = "200" ]; then
        green "  [OK] Slack notification sent (200)"
    else
        red "  [FAIL] Slack notification failed ($http_code)"
        return 1
    fi
}

send_pagerduty() {
    local payload_file="$1"
    if [ "$PAGERDUTY_KEY" = "REPLACE_PAGERDUTY_INTEGRATION_KEY" ]; then
        red "  [SKIP] PAGERDUTY_KEY not set — skipping PagerDuty notification"
        return 0
    fi

    # Replace routing key placeholder
    local payload
    payload=$(sed "s/REPLACE_PAGERDUTY_INTEGRATION_KEY/$PAGERDUTY_KEY/" "$payload_file")

    local http_code
    http_code=$(curl -so /dev/null -w "%{http_code}" \
        -X POST -H "Content-Type: application/json" \
        -H "Accept: application/vnd.pagerduty+json;version=2" \
        --data "$payload" \
        "$PAGERDUTY_ENDPOINT" 2>/dev/null || echo "000")

    if [ "$http_code" = "202" ]; then
        green "  [OK] PagerDuty incident created (202)"
    else
        red "  [FAIL] PagerDuty notification failed ($http_code)"
        return 1
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    usage
    exit 0
fi

ALERT_TYPE="${1:-}"
if [ -z "$ALERT_TYPE" ]; then
    red "Error: No alert type specified."
    echo ""
    usage
    exit 1
fi

echo ""
cyan "============================================"
cyan "  VaultBank Notification Sender"
cyan "  Alert: $ALERT_TYPE"
cyan "  Time:  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
cyan "============================================"
echo ""

case "$ALERT_TYPE" in
    payment-failure)
        echo "Sending payment failure rate alert..."
        send_slack "$SCRIPT_DIR/slack-payment-failure.json"
        send_pagerduty "$SCRIPT_DIR/pagerduty-incident.json"
        ;;
    webhook-signature)
        echo "Sending webhook signature failure alert..."
        send_slack "$SCRIPT_DIR/slack-webhook-signature.json"
        ;;
    all)
        echo "Sending all alert notifications..."
        echo ""
        echo "--- Payment Failure Rate ---"
        send_slack "$SCRIPT_DIR/slack-payment-failure.json"
        send_pagerduty "$SCRIPT_DIR/pagerduty-incident.json"
        echo ""
        echo "--- Webhook Signature Failure ---"
        send_slack "$SCRIPT_DIR/slack-webhook-signature.json"
        ;;
    *)
        red "Error: Unknown alert type '$ALERT_TYPE'"
        echo ""
        usage
        exit 1
        ;;
esac

echo ""
cyan "============================================"
echo ""