# VaultBank Payments — E2E Test Scenarios

These scenarios are designed to be run against a Vercel Preview deployment (or `localhost:5000`) with **sandbox/test provider keys**. They cover every payment method, webhook flow, reconciliation dry-run, and idempotency replay path.

## Prerequisites

- A VaultBank instance deployed to Preview or localhost
- Valid sandbox keys for: Stripe, Razorpay, PayPal
- One valid JWT token (from `/api/login`)
- One admin JWT token

## Scenario 1: List available payment methods

```bash
curl -s https://vaultbank.vercel.app/api/payments/methods \
  -H "Authorization: Bearer $USER_JWT" | jq .
```

**Expected**: JSON with `methods` array containing card, googlepay, upi, razorpay, paypal, wallet, bank, email.

## Scenario 2: Internal wallet transfer (mock, no provider)

```bash
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"fromAccountId":"acct1","to":"acct2","amount":10.00,"method":"wallet"}' | jq .
```

**Expected**: `status` = `completed`, `provider` = `wallet`.

## Scenario 3: Stripe card payment (mock mode)

```bash
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"fromAccountId":"acct1","to":"acct2","amount":25.00,"currency":"USD","method":"stripe_card"}' | jq .
```

**Expected** (in mock mode): `mock` = `true`, `providerId` starts with `pi_mock_`, `clientSecret` is present.

## Scenario 4: Razorpay UPI payment (mock mode)

```bash
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"fromAccountId":"acct1","to":"user@upi","amount":500.00,"currency":"INR","method":"upi"}' | jq .
```

**Expected**: `provider` = `upi`, `upiDeepLink` starts with `upi://pay`.

## Scenario 5: PayPal payment (mock mode)

```bash
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"fromAccountId":"acct1","to":"user@paypal.com","amount":50.00,"currency":"USD","method":"paypal"}' | jq .
```

**Expected**: `provider` = `paypal`, `redirectUrl` contains `paypal.com/checkoutnow`.

## Scenario 6: Idempotency-Key replay

```bash
IDEM_KEY=$(uuidgen)
# First call
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{"fromAccountId":"acct1","to":"acct2","amount":15.00,"method":"wallet"}' | jq .
# Second call (same key) — should replay
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{"fromAccountId":"acct1","to":"acct2","amount":15.00,"method":"wallet"}' | jq .
```

**Expected**: Second response has `"Idempotent-Replay: true"` header and identical body.

## Scenario 7: Webhook verification + dedup

This requires the Stripe CLI and a forwarded webhook:

```bash
# In one terminal:
stripe listen --forward-to https://vaultbank.vercel.app/api/payments/webhook/stripe

# In another:
stripe trigger payment_intent.succeeded
```

**Expected**: The first POST returns 200 and creates a `webhook_events` row. The second POST (Stripe retries automatically) returns 200 with `duplicate: true`. The `payments` table has exactly one row for this PaymentIntent.

## Scenario 8: Reconciliation dry-run

```bash
node server/scripts/run-reconciliation.js \
  --provider stripe \
  --start 2026-06-01 \
  --end 2026-06-02 \
  --dry-run
```

**Expected** (in mock mode): Total = 0, all counts zero. The adapter logs indicate mock mode.

## Scenario 9: Admin flags endpoint

```bash
curl -s https://vaultbank.vercel.app/api/admin/flags \
  -H "Authorization: Bearer $ADMIN_JWT" | jq .
```

**Expected**: JSON with `flags` array containing the `payments.live_providers_percent` flag.

## Scenario 10: Security headers

```bash
curl -sI https://vaultbank.vercel.app/api/health
```

**Expected**: `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy` headers present.

## Scenario 11: Auth rejection on payment methods

```bash
curl -s -o /dev/null -w '%{http_code}' https://vaultbank.vercel.app/api/payments/methods
```

**Expected**: 401 or 403 (no auth header).

## Scenario 12: Invalid amount validation

```bash
curl -s -X POST https://vaultbank.vercel.app/api/payments/transfer \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"amount":0}' | jq .
```

**Expected**: 400 with `"valid amount is required"` message.

## Running all scenarios

```bash
# Set env vars
export USER_JWT="..."
export ADMIN_JWT="..."
BASE=https://vaultbank.vercel.app

# Run scenario 1–6, 9–12
for i in 1 2 3 4 5 6 9 10 11 12; do
  echo "=== Scenario $i ==="
  eval "$(sed -n '/^### Scenario '$i'/,/^###/p' docs/e2e_test_scenarios.md | grep -v '^###' | grep -v '^#' | grep -v '^\$' | grep -v 'expected' )"
  echo ""
done

# Scenario 7 (webhook) needs Stripe CLI — run manually
# Scenario 8 (reconciliation) needs DB — run from server
