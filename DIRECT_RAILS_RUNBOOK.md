# VaultBank Native Bank Rails — Operations Runbook

## Scope

This runbook covers VaultBank's native bank-account workflows. Internal transfers are posted to VaultBank's own double-entry ledger. External bank movement is performed only through an operator-controlled bank account and reconciled against the official bank statement.

There is no automatic international bank-network transfer in this release. Do not represent an internal ledger transfer or a pending bank instruction as an external bank settlement.

## Manual bank payout configuration

Configure only in a protected deployment environment:

- `VB_DIRECT_BANK_PAYOUTS_ENABLED=true`
- `VB_DIRECT_PAYOUT_ENCRYPTION_KEY`: exactly 64 hexadecimal characters (32 random bytes)
- `VB_DIRECT_BANK_PAYOUT_CUSTOMER_ACCESS_ENABLED`: leave disabled until the operator's complete bank workflow is approved and ready

Generate an encryption key locally:

~~~powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Store the key only in the deployment secret manager and a protected offline backup. Do not commit it, send it in chat, or put it in frontend variables. Do not delete or rotate this key while encrypted payout requests exist unless a verified re-encryption migration is completed.

Beneficiary account numbers are encrypted with AES-256-GCM in PostgreSQL. Customer history exposes only the last four digits. Admin endpoints expose decrypted destination details only to authorized administrators.

## Outbound manual bank payout

1. A verified customer submits a payout request with an idempotency key and beneficiary details.
2. The server reserves the requested spendable balance atomically and writes the withdrawal/payout record in one PostgreSQL transaction.
3. An authorized operator independently checks the beneficiary details and initiates the bank transfer using the bank's own interface.
4. After the bank confirms the outgoing debit, the operator checks the official bank statement and records the exact amount, unique bank reference/UTR, and evidence note in the admin queue.
5. The system marks the payout complete once. Duplicate references, mismatched amounts, or repeated confirmations must not create another settlement.
6. If the outcome is ambiguous, leave the funds reserved and investigate the official bank statement. Do not refund until the bank confirms that no transfer was sent. The refund path requires an evidence note and returns reserved funds exactly once.

## Legacy UPI records

New UPI customer intents are retired in production. Historical UPI rows are preserved for admin-only statement reconciliation; this runbook does not authorize creating new UPI payment requests. Do not enable legacy UPI settings to restore customer access.

## Reconciliation rules

- Match deposits and withdrawals against the official bank statement, exact amount, expected account, and unique transaction reference.
- Screenshots, browser redirects, SMS messages, and email alerts are not settlement proof.
- An internal transfer must use one stable `Idempotency-Key` for its entire attempt. On timeout or unknown outcome, retry with that same key only.
- Never auto-refund an ambiguous external transfer.
- Never delete ledger history to reverse a transaction; use a supported compensating entry and retain evidence.

## Verification

- Run `cd server && npm test -- --runInBand --forceExit`.
- Run PostgreSQL integration tests when the test database is available.
- Confirm `/health` and `/ready` on the deployed service.
- Verify a native internal transfer updates both account balances and both sides of the journal exactly once.
- CI passing proves application behavior, not that an external bank settlement has occurred.
