# VaultBank Direct Rails — Operations Runbook

## Scope

VaultBank now has a provider-independent **INR UPI collection intent** and a **manual bank payout request** flow. These routes do not call Cashfree, Stripe, PayPal, or YOUPI. They use VaultBank's own API, Postgres ledger, and a bank account/VPA configured by the operator.

This is not an automatic bank API integration:
- Incoming UPI money is sent directly to the configured bank-linked VPA. An administrator must match the real bank statement, amount, intent reference, and unique UTR before the VaultBank ledger is credited.
- Outbound payout requests atomically reserve the user's available INR balance. An authorized operator sends the bank transfer using the bank's own interface, then confirms the real outgoing UTR. The app does not initiate the transfer itself.
- Neither a browser redirect, screenshot, SMS, nor email is settlement proof.

## Disabled-by-default environment

Configure only in a protected environment you control. Do not enable the rails for customer money unless the receiving bank and qualified compliance advisers have confirmed the proposed activity is permitted.

### Incoming UPI

- **VB_UPI_DEPOSIT_ENABLED=true**
- **VB_UPI_RECEIVING_VPA** — your real bank-linked UPI ID
- **VB_UPI_RECEIVING_NAME** — the real receiving account payee name

If the flag or values are missing/invalid, /api/direct-upi/intents returns **503 DIRECT_UPI_NOT_CONFIGURED**. The readiness endpoint never fabricates payment details.

### Manual bank payout

- **VB_DIRECT_BANK_PAYOUTS_ENABLED=true**
- **VB_DIRECT_PAYOUT_ENCRYPTION_KEY** — 64 hexadecimal characters representing 32 random bytes

Generate a key locally with Node.js:

~~~powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Store the key only in the deployment secret manager and a protected offline backup. Do not commit it, send it in chat, paste it into issues, or put it in frontend variables. **Do not delete or rotate this key while encrypted payout requests exist** unless you first implement and verify a full re-encryption migration. Without it, the admin interface cannot decrypt outstanding beneficiary account details.

If the flag or key is missing, payout creation returns **503 DIRECT_BANK_PAYOUTS_NOT_CONFIGURED**. Beneficiary account numbers are encrypted with AES-256-GCM in Postgres; user-facing history returns only the last four digits. Only admin endpoints return the decrypted destination.

## Incoming UPI reconciliation

1. User creates an INR intent; the API returns an exact-amount UPI URI, QR, reference, and 30-minute expiry.
2. The transfer goes to the operator-configured VPA. The intent remains **pending**.
3. In the receiving bank's official statement, verify an actual credit. Match the exact INR amount and the intent/reference. Confirm the UTR belongs to that transaction.
4. In the administrator's **Direct UPI Statement Review** panel, enter the exact amount, unique UTR, and a useful statement note, then confirm.
5. The server locks the intent, checks amount and expiry, reserves the UTR through a database unique index, updates the account balance, adds a ledger transaction, and settles the intent in one database transaction. A repeated request, reused UTR, mismatch, or failed ledger change does not create a second credit.

Do not confirm from a customer screenshot, browser return, SMS, or email alone. If the transfer is late, the note is missing, or the amount differs, leave the intent uncredited and reconcile it manually with the actual bank statement. Do not force it through the normal exact-match endpoint.

## Outbound manual bank payout

1. User requests a payout to a bank account whose beneficiary name must match their VaultBank profile. A request requires an idempotency key.
2. The server inserts the payout request, decrements balance and available_balance only if sufficient spendable balance exists, and writes a processing withdrawal ledger row in one PostgreSQL transaction.
3. The operator opens the **Manual Bank Payout Queue**, copies the beneficiary details into the bank's own interface, and initiates the transfer separately.
4. After the outgoing debit has succeeded, check the bank statement and the correct UTR, then enter the exact debit amount, UTR, and evidence note in the queue. The system will mark the ledger complete once and only once.
5. If the transfer result is ambiguous, leave the funds reserved and investigate. Do **not** refund until the official bank statement confirms no transfer was sent. The refund path requires an evidence note and atomically returns the reserved funds exactly once.
6. Never use the refund button to resolve a timeout or an uncertain bank transfer. First reconcile the bank account.

## Pilot controls

- ₹1–₹10,000 per incoming UPI intent, 30-minute expiry, at most three open intents per user.
- ₹10–₹10,000 per manual outbound request for the initial pilot.
- Exact-amount checks, user-scoped request history, required idempotency key for money-moving POSTs, row locks, unique UTR indexes, and transaction rollback are enforced server-side.
- No automatic credit from client responses or messages.
- Both rails are disabled by default. Existing Cashfree collection/payout rails are separate and unchanged.
- USD external bank payouts and per-user individual bank accounts are **not** provided by these two rails.

## Test & release checklist

- Run the direct UPI unit safety suite and manual bank payout unit safety suite.
- Run PostgreSQL integration tests and frontend TypeScript/build CI.
- Keep all new environment flags unset/false until a controlled pilot is permitted.
- Begin with your own receiving account and a minimal controlled test only after confirming bank terms. Reconcile the bank statement independently; never treat CI pass as proof of a real settlement.
- Do not mix personal and unrelated customer funds or market these manual rails as a bank, payment aggregator, or authorised wallet service without the relevant approvals.
