# VaultBank Native Money Rails — Operations Runbook

Last updated: 2026-10-29. This is the active runbook for VaultBank's own ledger and native settlement workflows.

## System boundary

VaultBank owns the user account model, double-entry journal, internal-transfer execution, idempotency, reconciliation records, and audit trail in PostgreSQL. A ledger balance is not itself proof that external bank reserves exist. Internal transfers can move only externally verified funds; unreconciled opening balances remain non-spendable until reviewed.

Production collections and payout provider registries are hard-locked to native rails when `NODE_ENV=production`. Legacy provider environment variables cannot enable those adapters in production. Do not use old provider setup/cutover instructions.

## Supported native money flows

| Flow | Currency | What actually happens |
|---|---|---|
| VaultBank user-to-user internal transfer | Any operator-enabled currency (USD and INR by default) | One database transaction updates both accounts, writes both transaction rows, posts a balanced journal, and claims the idempotency key. No external bank transfer occurs. |
| Bank-transfer deposit instruction | Configured INR or USD receiving account | Creates a pending instruction and unique reference. It never credits funds at creation. An authorized administrator verifies the official receiving-bank statement, matching amount and unique bank reference before the ledger is credited. |
| Direct UPI deposit | INR | Generates a UPI intent to the configured real bank-linked VPA. The balance remains pending until an administrator matches the actual bank statement and unique UTR. |
| Manual bank payout | INR | Reserves the user's available funds atomically. An authorized operator initiates the bank transfer outside VaultBank, then confirms the actual debit/UTR. A request alone is not a completed bank payment. |

There is no automated USD/AED/SWIFT/ACH external payout rail in this release. Currency selection and ledger currency support do not create a bank-network connection or an FX conversion feature.

## Configuration

Store real financial details and cryptographic keys only in the deployment secret manager. Never commit them to Git or paste them into issue/chat logs.

### Bank-transfer deposits

- `VB_BANK_DEPOSIT_ENABLED=true`
- `VB_BANK_RECEIVING_CURRENCY=INR` or `USD`
- `VB_BANK_RECEIVING_BANK_NAME` — real receiving bank
- `VB_BANK_RECEIVING_HOLDER` — verified account-holder name
- `VB_BANK_RECEIVING_DETAILS` — actual bank transfer instructions

The configured receiving account must exist and be controlled by the responsible VaultBank operator. Never invent receiving details. Each instruction expires after seven days; creation is pending-only and does not increase a balance.

### Additional currencies (AED, GBP, EUR, CAD, AUD, SGD, NZD, CHF, HKD)

These codes are registered in `server/config/currencies.js` but disabled by default. A currency becomes usable only when both conditions hold:

- `VB_MULTICURRENCY_ENABLED=true`
- A complete real receiving account for that exact code: `VB_BANK_RECEIVING_<CODE>_BANK_NAME`, `VB_BANK_RECEIVING_<CODE>_HOLDER`, `VB_BANK_RECEIVING_<CODE>_DETAILS`

Enabling a currency only permits a zero-balance wallet, internal transfers in that same currency, and (if configured) pending bank-deposit instructions. It never creates an exchange rate, converts a balance, or authorizes an external payout. `GET /api/currencies` reports what is enabled and whether receiving is configured, without exposing account details.

The legacy `VB_BANK_RECEIVING_*` variables describe exactly one currency (`VB_BANK_RECEIVING_CURRENCY`, default `USD`) and are never used to answer a different currency's request.

### Direct UPI deposits

- `VB_UPI_DEPOSIT_ENABLED=true`
- `VB_UPI_RECEIVING_VPA` — real bank-linked VPA
- `VB_UPI_RECEIVING_NAME` — actual payee name
- `VB_DIRECT_UPI_CUSTOMER_ACCESS_ENABLED=true` only for a deliberately authorized customer pilot after the receiving account and operational controls are ready.

UPI deposit intents are INR-only, exact-amount, expire after 30 minutes, and are credited only after the official bank statement is verified.

### Manual bank payouts

- `VB_DIRECT_BANK_PAYOUTS_ENABLED=true`
- `VB_DIRECT_PAYOUT_ENCRYPTION_KEY` — exactly 64 hex characters (32 random bytes); stored only in the secret manager
- `VB_DIRECT_BANK_PAYOUT_CUSTOMER_ACCESS_ENABLED=true` only for an authorized customer pilot

Destination account numbers are encrypted at rest. The key must be backed up securely and must not be rotated while encrypted requests exist unless a verified re-encryption migration is performed. Enabling the route does not cause an automatic bank transfer.

Customer access for deposit and payout flows remains off unless explicitly enabled. Do not enable customer-facing money flows until the operator can safely reconcile real bank statements and resolve ambiguous transfers.

## Reconciliation rules

1. Verify deposits against the official bank statement, exact amount, expected receiving account, and unique bank transaction reference/UTR.
2. Do not credit funds from screenshots, browser redirects, customer messages, SMS, or email alerts alone.
3. An internal transfer must use one stable `Idempotency-Key` for the entire attempt. On timeout or an unknown outcome, retry with the same key only; never mint a new key for the same intended transfer.
4. An uncertain external payout remains reserved until its outcome is resolved from the actual bank statement. Do not refund an ambiguous transfer.
5. Never delete ledger history to reverse a transaction. Use the supported compensating/reversal path and retain evidence notes.

## Verification checklist

- Run `cd server && npm test`.
- Run `cd server && npm run test:integration` when PostgreSQL test services are available.
- Confirm the production service responds at `/health`.
- Check the native rail availability endpoints: `/api/direct-upi/availability` and `/api/direct-bank-payouts/availability`; bank deposit configuration is authenticated at `/api/bank-deposits/config`.
- Start with a controlled operator-only pilot. CI passing proves code behavior, not that a real external bank settlement has occurred.
