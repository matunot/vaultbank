# VaultBank Bank API Setup

## Current state

The production app already has:
- Internal VaultBank customer-to-customer ledger transfers.
- INR bank-transfer deposit instructions, credited only after administrator verification against the official bank statement.
- UPI collection intent/QR with manual statement and UTR verification.
- Manual bank payout requests that reserve ledger funds; an operator sends the bank transfer separately and reconciles the UTR.

The production registry is deliberately native-only. Legacy generic collection/payout provider adapters are not activated by setting old provider environment variables.

## Where configuration lives

Render service environment settings:
https://dashboard.render.com/web/srv-d9tg2kajobas73ctduug/env

Never store bank API secrets in:
- the React/browser application,
- GitHub source or issues,
- localStorage,
- customer-visible settings,
- chat messages.

The current manual rails use these variables:

### Bank transfer receiving instructions
- `VB_BANK_DEPOSIT_ENABLED`
- `VB_BANK_RECEIVING_INR_BANK_NAME`
- `VB_BANK_RECEIVING_INR_HOLDER`
- `VB_BANK_RECEIVING_INR_DETAILS`

These create instructions only. They do not create an API integration and never auto-credit a deposit.

### UPI intent/QR
- `VB_UPI_DEPOSIT_ENABLED`
- `VB_UPI_RECEIVING_VPA`
- `VB_UPI_RECEIVING_NAME`

This is still a manually verified collection flow. Do not use an administrator's personal VPA as a substitute for a properly authorized VaultBank receiving account.

### Manual bank payout requests
- `VB_DIRECT_BANK_PAYOUTS_ENABLED`
- `VB_DIRECT_PAYOUT_ENCRYPTION_KEY`

This is not automatic bank transfer submission. Preserve the encryption key while encrypted beneficiary records exist.

## To add an actual bank API

Credentials alone are not an integration. A provider-specific server adapter must implement and test:
1. Authentication and token renewal.
2. Beneficiary validation and idempotent transfer creation.
3. Signed webhook verification, replay protection and event deduplication.
4. Status polling and reconciliation against the bank/provider's settlement reference.
5. Ledger posting only after trusted settlement evidence; ambiguous results must remain pending/reconciliation-required.

Before implementing the adapter, obtain the chosen bank/PSP's official API documentation, sandbox and live credentials, webhook signing details, permitted-use approval, and the name of the settlement account owned/controlled by the authorized VaultBank entity. Do not route customer funds through an administrator's personal account.

## Direct UPI P2P without a VaultBank payment API

The customer-facing UPI P2P screen creates a standard `upi://pay` intent for a payer's installed UPI app. The sender authenticates with their own UPI PIN and the money moves directly between the sender's and recipient's linked bank accounts. This does not use VaultBank balances, does not create a VaultBank wallet top-up, and does not make VaultBank a UPI PSP/TPAP or payment-system operator.

The receive screen shares the recipient's own VPA as a payment link. It is not a formal UPI Collect request. VaultBank does not receive a signed PSP callback or automatic status confirmation from this basic intent flow, so no VaultBank balance or transaction record is automatically credited. Users must verify success in their own UPI/bank app. Do not treat a redirect, app launch, screenshot, SMS, or user-submitted UTR alone as verified settlement evidence.

The app's Bank API Setup page is an admin-only status and configuration guide. It intentionally links to Render for secret storage; it does not accept or display raw API secrets. Production money movement stays disabled until the provider adapter, settlement account, reconciliation and required approvals are verified.
