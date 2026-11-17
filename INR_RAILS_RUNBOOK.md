# VaultBank Native Money Rails — Operations Runbook

Last updated: 2026-11-17.

## System boundary

VaultBank owns the user account model, double-entry journal, internal-transfer execution, idempotency, reconciliation records, and audit trail in PostgreSQL. A ledger balance is not itself proof that external bank reserves exist. Internal transfers can move only funds already made available under the account's reconciliation controls.

## Supported native money flows

| Flow | Currency | What actually happens |
|---|---|---|
| VaultBank user-to-user internal transfer | USD and INR by default; other operator-enabled currencies | One database transaction updates both accounts, writes both transaction rows, posts a balanced journal, and claims the idempotency key. No external bank transfer occurs. |
| Bank-transfer deposit instruction | Configured INR or USD receiving account | Creates a pending instruction and unique reference. It never credits funds at creation. An authorized administrator verifies the official receiving-bank statement before crediting the ledger. |
| Manual bank payout | INR | Reserves the user's available funds atomically. An authorized operator initiates the transfer outside VaultBank and confirms the actual debit/reference after statement reconciliation. |
| Legacy UPI history | INR | New production UPI intents are retired. Existing rows remain for admin-only historical reconciliation. |

There is no automated USD/AED/SWIFT/ACH external payout rail in this release. Currency selection and ledger currency support do not create bank-network connectivity or FX conversion.

## Configuration

Store real financial details and cryptographic keys only in the deployment secret manager. Never commit them to Git or paste them into issue/chat logs.

### Bank-transfer deposits

- `VB_BANK_DEPOSIT_ENABLED=true`
- `VB_BANK_RECEIVING_CURRENCY=INR` or `USD`
- `VB_BANK_RECEIVING_BANK_NAME` — real receiving bank
- `VB_BANK_RECEIVING_HOLDER` — verified account-holder name
- `VB_BANK_RECEIVING_DETAILS` — actual bank transfer instructions

The configured receiving account must exist and be controlled by the responsible operator. Each instruction is pending-only and does not increase a balance when created. An authorized administrator must match the official bank statement and unique bank reference before credit.

### Additional currencies (AED, GBP, EUR, CAD, AUD, SGD, NZD, CHF, HKD)

These codes are registered in `server/config/currencies.js` but disabled by default. A currency becomes usable only when both conditions hold:

- `VB_MULTICURRENCY_ENABLED=true`
- A complete real receiving account for that exact code: `VB_BANK_RECEIVING_<CODE>_BANK_NAME`, `_HOLDER`, and `_DETAILS`

Enabling a currency permits a wallet and same-currency internal transfers. If configured, it also permits pending bank-deposit instructions. It never creates an exchange rate, converts a balance, or authorizes an external payout. `GET /api/currencies` reports enabled currencies and receiving readiness without exposing account details.

### Manual bank payouts

- `VB_DIRECT_BANK_PAYOUTS_ENABLED=true`
- `VB_DIRECT_PAYOUT_ENCRYPTION_KEY` — exactly 64 hex characters (32 random bytes); store only in the secret manager
- `VB_DIRECT_BANK_PAYOUT_CUSTOMER_ACCESS_ENABLED` — separate customer-access gate; keep disabled until the operational workflow is ready

Destination account numbers are encrypted at rest. The key must be backed up securely and must not be rotated while encrypted requests exist unless a verified re-encryption migration is performed. Enabling the route does not itself cause an external bank transfer.

### Legacy UPI records

New UPI customer intents are retired in production. Existing UPI rows remain accessible only to authorized administrators for historical statement reconciliation. Do not turn on old UPI environment flags or expose customer-facing UPI creation.

## Reconciliation rules

1. Verify deposits against the official bank statement, exact amount, expected receiving account, and unique bank transaction reference.
2. Do not credit funds from screenshots, browser redirects, customer messages, SMS, or email alerts alone.
3. An internal transfer must use one stable `Idempotency-Key` for the entire attempt. On timeout or unknown outcome, retry with the same key only.
4. An uncertain external payout remains reserved until its outcome is resolved from the actual bank statement. Do not refund an ambiguous transfer.
5. Never delete ledger history to reverse a transaction. Use the supported compensating/reversal path and retain evidence notes.

## Verification checklist

- Run `cd server && npm test -- --runInBand --forceExit`.
- Run `cd server && npm run test:integration` when PostgreSQL test services are available.
- Confirm the production service responds at `/health` and `/ready`.
- Check bank-deposit configuration at `/api/bank-deposits/config` and manual bank-payout readiness at `/api/direct-bank-payouts/availability`.
- CI passing proves code behavior, not that a real external bank settlement occurred.
