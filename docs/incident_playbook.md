# VaultBank Payments — Incident Playbook

## Incident types covered

1. Payment failure spike (>1% failure rate for 5+ minutes)
2. Double charge (same transaction settled twice by PSP)
3. Webhook compromise (stale/leaked webhook secret, unexpected events)
4. Reconciliation mismatch (provider ledger differs from our ledger)
5. Data breach (stored PAN / leaked API keys / DB compromise)
6. Payment provider outage (Stripe / Razorpay / PayPal API down)

## Quick reference: incident flow

```text
1. DETECT   — alert fires (metrics / Sentry / sleep-deprived engineer)
2. TRIAGE   — is real money at risk? if yes → P0
3. CONTAIN  — disable provider, kill switch, or rate-limit
4. RESOLVE  — fix root cause (code / config / data)
5. RECOVER  — restore traffic, reconcile ledger, confirm no $ lost
6. REVIEW   — postmortem within 48h
```

## Containment actions by severity

| Action | P0 (funds at risk) | P1 (degradation) | P2 (cosmetic) |
| --- | --- | --- | --- |
| Disable live PSP via canary flag | **Immediate** | Consider | No |
| Rotate compromised secrets | **Immediate** | Within 1h | Next day |
| Block provider webhook via WAF | **Immediate** | Consider | No |
| Pause reconciliation job | No | Consider | No |
| Page team lead | **Immediate** | Within 15 min | No |

## Per-incident runbooks

### 1. Payment failure spike

**Symptoms**: `payment_failure_total / payment_attempts_total > 0.01`
alert.

**Diagnostic SQL**:

```sql
SELECT method, status, count(*)
FROM payments
WHERE created_at > now() - interval '15 minutes'
GROUP BY method, status
ORDER BY count DESC;
```

**Actions**:

1. Check provider status dashboards
   (Stripe: status.stripe.com / Razorpay: health.razorpay.com /
   PayPal: paypal-status.com).
2. If provider is degraded → disable live mode
   (set canary to 0%):

   ```sql
   UPDATE feature_flags
   SET percentage = 0
   WHERE key = 'payments.live_providers_percent';
   ```

3. If provider is healthy → check error codes:

   ```sql
   SELECT metadata->>'last_error', count(*)
   FROM payments
   WHERE status = 'failed'
     AND created_at > now() - interval '15 minutes'
   GROUP BY metadata->>'last_error'
   ORDER BY count DESC;
   ```

4. Common error codes and fixes:
   - `card_declined` — normal; no action.
   - `insufficient_funds` — normal; no action.
   - `processing_error` — retry is safe.
   - `authentication_required` — 3DS challenge; client-side issue.
   - `payment_intent.payment_failed` replicating → check Stripe
     dashboard rate limits.
   - If unknown errors → **rotate Stripe webhook secret** (see 3).

### 2. Double charge

**Symptoms**: `reconciliations` shows a `mismatch` row for the same
payment with duplicate provider_id.

**Diagnostic SQL**:

```sql
SELECT provider, provider_id, count(*)
FROM payments
GROUP BY provider, provider_id
HAVING count(*) > 1;
```

**Actions**:

1. Identify the affected transaction IDs.
2. In Stripe dashboard → void duplicate PaymentIntent
   (do NOT refund if capture was not taken).
3. If captured → **refund** one of the duplicates via provider
   dashboard.
4. Delete one of the duplicate rows:

   ```sql
   DELETE FROM payments
   WHERE id IN (
     SELECT id
     FROM (
       SELECT id,
              row_number() OVER (
                PARTITION BY provider_id
                ORDER BY created_at DESC
              ) AS rn
       FROM payments
       WHERE provider = 'stripe'
         AND provider_id = 'pi_...'
     ) sub
     WHERE sub.rn = 2
   );
   ```

5. Run reconciliation dry-run to confirm clean:

   ```sql
   node server/scripts/run-reconciliation.js --provider stripe \
     --start $(date -I) --end $(date -I -d "+1 day") --dry-run
   ```

6. **Root cause**: if due to idempotency-key miss → check
   idempotency middleware logs. If due to webhook retry without
   dedup → check `webhook_events` table completeness:

   ```sql
   SELECT provider, provider_event_id
   FROM webhook_events
   WHERE provider = 'stripe'
     AND provider_event_id LIKE 'evt_%'
     AND status = 'processed'
   ORDER BY received_at DESC
   LIMIT 10;
   ```

### 3. Webhook compromise

**Symptoms**: `webhook_signature_failures_total` alert, or unexpected
webhook events from unrecognized IPs.

**Actions**:

1. **Immediately rotate** the webhook signing secret for the affected
   provider:
   - Stripe: Dashboard → Developers → Webhooks → (endpoint) →
     Reveal → **Regenerate**.
   - Razorpay: Settings → Webhooks → (endpoint) →
     **Regenerate Secret**.
   - PayPal: Developer Dashboard → Webhooks → (webhook) →
     **Regenerate Secret**.
2. Update Vercel env var
   `PAYMENT_PROVIDER_*_WEBHOOK_SECRET` or `PAYPAL_WEBHOOK_ID`.
3. Verify new secret works by triggering a test event.
4. Audit recent `webhook_events` for any unexpected
   `payment_intent.succeeded` events:

   ```sql
   SELECT provider, provider_event_id, event_type, received_at, status
   FROM webhook_events
   WHERE received_at > now() - interval '2 hours'
   ORDER BY received_at DESC;
   ```

5. If unauthorized events led to ledger changes → reverse them.

### 4. Reconciliation mismatch

**Symptoms**: reconciliation job (nightly) reports >0 mismatches or
missing rows.

**Actions**:

1. Run reconciliation with `--dry-run` to inspect:

   ```bash
   node server/scripts/run-reconciliation.js --provider stripe \
     --start YYYY-MM-DD --end YYYY-MM-DD --dry-run
   ```

2. For each mismatch, investigate:
   - **Mismatch (amount differs)** → find the payment in our DB and
     the provider's dashboard. Fix our ledger:

     ```sql
     UPDATE payments
     SET amount = <correct_amount>
     WHERE provider_id = '<id>';
     ```

   - **Missing (provider has it, we don't)** → insert the missing row
     if legitimate, else report to provider fraud team.
3. After fixing, update reconciliation run manually or wait for next
   nightly run.

### 5. Data breach

**Symptoms**: DB leaked / API keys in public repo / unauthorized DB
access.

**Actions**:

1. **Immediately rotate** ALL secrets:
   - Stripe secret key, webhook secret
   - Razorpay key + secret
   - PayPal client ID + secret
   - DATABASE_URL (rotate DB password)
   - JWT_SECRET
2. **Immediately disable** all payout endpoints:

   ```sql
   UPDATE feature_flags
   SET percentage = 0, enabled = false;
   ```

3. Block all IPs except ops dashboard IPs:

   ```bash
   # Vercel: Firewall → Block rules
   ```

4. Audit `payments` table for any unauthorized transactions.
5. Notify affected users (defined in compliance policy).
6. Engage legal for breach disclosure (regulatory timelines apply).

### 6. Payment provider outage

**Symptoms**: provider API returns 503/429 for all requests. Canary
flag still >0 but all payments fail.

**Actions**:

1. **Set canary to 0%** — all new requests fall back to mock/wallet:

   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
        -H "Content-Type: application/json" \
        -d '{"key":"payments.live_providers_percent","percentage":0}' \
        https://vaultbank.vercel.app/api/admin/flags
   ```

2. Add banner to frontend: "Card payments temporarily unavailable".
3. After provider recovers, gradually increase canary:
   5% → 25% → 100% (see release_checklist.md).
4. Run reconciliation after recovery to catch any edge-timing
   missing rows.

## Escalation matrix

| Level | Contact | SLA | Channel |
| --- | --- | --- | --- |
| L1 (on-call engineer) | PagerDuty rotation | < 5 min | PagerDuty + Slack |
| L2 (payments lead) | <payments@vaultbank.com> | < 15 min | Slack + Phone |
| L3 (engineering manager) | <eng@vaultbank.com> | < 30 min | Phone |
| Legal / Compliance | <legal@vaultbank.com> | < 1 hour (breach only) | Email + Phone |

## Post-incident checklist

- [ ] Incident documented in `docs/postmortems/YYYY-MM-DD.md`
- [ ] Root cause identified and fix deployed
- [ ] Reconciliation confirms no missing/mismatched funds
- [ ] Feature flag restored to previous percentage
- [ ] Alert threshold adjusted (if needed)
- [ ] Team notified of outcome
