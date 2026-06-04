# VaultBank Payment Incident Notification Templates

# =================================================

# Copy these into your Slack/PagerDuty integration or use via webhook

## Slack Notification Templates

### Payment Failure Rate Critical

```
🔴 CRITICAL: VaultBank Payment Failure Rate > 1%
Time: {{timestamp}}
Duration: {{duration}}
Current rate: {{failure_rate}}
Threshold: 1% sustained 30 minutes
Impact: {{impact_description}}

Actions:
1. Check provider status pages (Stripe, Razorpay, PayPal)
2. Review webhook_logs for signature failures
3. Check ledger for stuck pending payments
4. If needed: disable live providers immediately:
   curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
     -d '{"key":"payments.live_providers_percent","percentage":0}' \
     https://vaultbank.vercel.app/api/admin/flags

Runbook: docs/incident_playbook.md
Dashboard: https://grafana.vaultbank.com/d/vaultbank-payments
```

### Webhook Signature Failure

```
🔴 CRITICAL: VaultBank Webhook Signature Verification Failure
Time: {{timestamp}}
Provider: {{provider}}
Failure count: {{count}}

Possible causes:
1. Webhook signing secret rotated in provider dashboard but not in Vercel env
2. Manually replayed webhook with wrong secret
3. Possible replay attack

Actions:
1. Verify webhook signing secrets match in provider dashboards
2. Check Vercel env for PAYMENT_PROVIDER_*_WEBHOOK_SECRET values
3. No rollback needed unless confirmed attack

Runbook: docs/incident_playbook.md
```

### Reconciliation Mismatch

```
🔴 CRITICAL: VaultBank Reconciliation Mismatch Detected
Time: {{timestamp}}
Provider: {{provider}}
Mismatch count: {{count}}
Total amount at risk: {{amount}}

This means funds in provider may differ from ledger records.

Actions:
1. Run manual reconciliation:
   node server/scripts/run-reconciliation.js --provider {{provider}} --start {{date}} --end {{date}}
2. Check for duplicate charges or missing refunds
3. If confirmed: disable live providers and investigate

Runbook: docs/incident_playbook.md
```

### Canary Rollback Notification

```
🟡 WARNING: VaultBank Canary Rolled Back
Time: {{timestamp}}
Previous percentage: {{from_pct}}%
New percentage: {{to_pct}}%
Reason: {{reason}}

The canary was rolled back to {{to_pct}}% of live payment traffic.
Monitor metrics and resolve the issue before re-enabling.

Dashboard: https://grafana.vaultbank.com/d/vaultbank-payments
```

## PagerDuty Integration

### Create PagerDuty Alert Rules

Add these to your PagerDuty/Prometheus integration:

```yaml
# In prometheus-alerts.yml, each rule already has severity labels:
# - severity: critical (PaymentFailureRateHigh, WebhookSignatureFailures, ReconciliationMismatches)
# - severity: warning (IdempotencyReplaySpike, PaymentLatencyP99High)

# PagerDuty routing key (from PagerDuty → Service → Integrations → Events API v2)
# Set as Prometheus alertmanager integration or use webhook receiver

# AlertManager config snippet for PagerDuty:
route:
  receiver: vaultbank-payments
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: vaultbank-payments
    pagerduty_configs:
      - service_key: '<PAGERDUTY_SERVICE_KEY>'
        severity: '{{ .GroupLabels.severity }}'
        description: '{{ .GroupLabels.alertname }}: {{ .CommonAnnotations.summary }}'
        details:
          description: '{{ .CommonAnnotations.description }}'
          runbook: '{{ .CommonAnnotations.runbook }}'
          dashboard: 'https://grafana.vaultbank.com/d/vaultbank-payments'
```

## Rollback Quick Reference

```bash
# IMMEDIATE: Disable all live providers (takes effect within seconds)
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"key":"payments.live_providers_percent","percentage":0}' \
  https://vaultbank.vercel.app/api/admin/flags

# SLOW: Revert code (takes effect on next deploy)
git revert <merge-commit-sha>
git push origin main
