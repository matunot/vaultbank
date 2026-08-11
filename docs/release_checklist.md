# VaultBank Payments — Release Checklist (Go-Live)

## Pre-flight checks

- [ ] Sprint 1 merged (feat/payments-production-hardening)
- [ ] Sprint 2 merged (feat/payments-sprint2)
- [ ] Sprint 3 merged (feat/payments-sprint3)
- [ ] Migration 005 applied: `payments`, `settlements`, `webhook_events`, `idempotency_keys` tables exist
- [ ] Migration 006 applied: `reconciliations`, `reconciliation_runs`, `feature_flags` tables exist
- [ ] All production env vars set in Vercel (see ENV_TEMPLATE.md)
- [ ] `ALLOW_MOCK_IN_PRODUCTION` is NOT set (or set to `false`)
- [ ] `PAYMENT_PROVIDER_*_ENABLED` is `true` for all desired providers
- [ ] Production Stripe webhook endpoint configured in Stripe Dashboard → points to `https://vaultbank.vercel.app/api/payments/webhook/stripe`
- [ ] Production Razorpay webhook endpoint configured → points to `/api/payments/webhook/razorpay`
- [ ] Production PayPal webhook endpoint configured → points to `/api/payments/webhook/paypal`
- [ ] Webhook signing secrets match the env vars in Vercel
- [ ] Reconciliations table empty (first run will populate)
- [ ] Canary flag `payments.live_providers_percent` is at `0`
- [ ] Security smoke test passes: `bash server/security/smoke.sh https://vaultbank.vercel.app`
- [ ] Full pre-canary runbook passes (Linux/macOS): `bash scripts/pre-canary-runbook.sh`
- [ ] Full pre-canary runbook passes (Windows): `.\scripts\pre-canary-verify.ps1`
- [ ] Unit tests pass: `cd server && npx jest --runInBand`
- [ ] E2E scenarios verified (see docs/e2e_test_scenarios.md)
- [ ] Sentry DSN set in Vercel env
- [ ] Admin JWT secret set and admin user(s) created

## Canary rollout

### Stage 1: 5%

- [ ] Set `payments.live_providers_percent` to `5`
- [ ] Monitor for 24−72 hours
- [ ] Check metrics: `payment_failure_total` < 1% of `payment_attempts_total`
- [ ] Check webhook events: no signature failures, all `processed`
- [ ] Check reconciliation: zero mismatches in yesterday's run
- [ ] No open incidents

### Stage 2: 25%

- [ ] Set `payments.live_providers_percent` to `25`
- [ ] Monitor for 24 hours
- [ ] Same criteria as Stage 1

### Stage 3: 100%

- [ ] Set `payments.live_providers_percent` to `100`
- [ ] Monitor for 24 hours
- [ ] Same criteria as Stage 1

## Rollback commands

### Rollback all live payments (immediate kill switch)

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"key":"payments.live_providers_percent","percentage":0}' \
     https://vaultbank.vercel.app/api/admin/flags
```

### Rollback a specific provider disable

```bash
# Set ALLOW_MOCK_IN_PRODUCTION=true as a temporary Vercel env var
# OR disable that provider's flag
```

### Rollback a git deployment

```bash
git revert HEAD
git push origin main
```

## Post-rollout

- [ ] Reconciliation job added to cron (nightly, 2am UTC)
- [ ] Alert rules configured in PagerDuty/Opsgenie
- [ ] Notification payloads tested:
  - Slack: `SLACK_WEBHOOK_URL=... bash scripts/notification-payloads/send-notifications.sh payment-failure`
  - PagerDuty: `PAGERDUTY_KEY=... bash scripts/notification-payloads/send-notifications.sh payment-failure`
- [ ] Stakeholders notified of go-live
- [ ] PCI SAQ A filed
