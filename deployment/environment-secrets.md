# VaultBank Environment Configuration

This document describes configuration used by the current bank-user application. The canonical placeholder list is `server/.env.example`. Put actual production values in the Render service's protected environment settings; never commit them.

## Required server settings

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Set to `production` on the live service |
| `PORT` | HTTP listener; Render provides this |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Random secret of at least 32 characters |
| `ADMIN_EMAIL` | Initial/operational administrator identity |
| `ADMIN_PASSWORD` | Strong administrator password, supplied only in Render |

## Optional account and bank workflow settings

| Variable | Purpose |
|---|---|
| `CLIENT_URL` | Canonical application origin used in email links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Signup verification and operational email |
| `VB_BANK_DEPOSIT_ENABLED` | Enables creation of pending bank-transfer deposit instructions |
| `VB_BANK_RECEIVING_CURRENCY` | Currency of the configured receiving account |
| `VB_BANK_RECEIVING_BANK_NAME`, `VB_BANK_RECEIVING_HOLDER`, `VB_BANK_RECEIVING_DETAILS` | Real operator-controlled receiving account and instructions |
| `VB_BANK_DEPOSIT_CUSTOMER_ACCESS_ENABLED` | Separate customer-access gate for bank deposit instructions |
| `VB_DIRECT_BANK_PAYOUTS_ENABLED` | Enables manual bank payout request handling |
| `VB_DIRECT_PAYOUT_ENCRYPTION_KEY` | 32-byte hex key used to encrypt beneficiary account details at rest |
| `VB_DIRECT_BANK_PAYOUT_CUSTOMER_ACCESS_ENABLED` | Separate customer-access gate for manual payout requests |
| `VB_MULTICURRENCY_ENABLED` | Enables configured additional currency wallets |
| `VB_BANK_RECEIVING_<CODE>_BANK_NAME`, `_HOLDER`, `_DETAILS` | Receiving-account details required per enabled currency |
| `VB_USD_ACH_EXPORT_ENABLED` | Enables ACH file preparation only; it does not submit a bank transfer |

Bank deposits remain pending until official bank-statement reconciliation. Manual bank payouts remain reserved until an operator has completed and reconciled the external bank transfer. Enabling a feature flag does not create a bank-network connection.

## Optional crypto and monitoring settings

| Variable | Purpose |
|---|---|
| `USDC_XPUB` | Public extended key used to derive deposit addresses |
| `USDC_HOT_WALLET_KEY` | Hot-wallet signing key; keep unset unless intentionally funded and secured |
| `USDC_DAILY_LIMIT` | Daily crypto withdrawal limit |
| `BASE_RPC_URL`, `POLYGON_RPC_URL` | Blockchain RPC endpoints |
| `USDC_TESTNET_MODE`, `USDC_BASE_SEPOLIA_HOT_WALLET_KEY`, `USDC_BASE_SEPOLIA_RPC_URL` | Explicit test-network configuration; never configure test mode as production funds |
| `SENTRY_DSN` | Optional error monitoring |

## Operational notes

- Do not add merchant checkout or payment-processor credentials to this service. They are not part of the application runtime or bank-user transfer model.
- Keep bank account details and encryption keys in protected environment settings only.
- Never use real customer money to test unverified or pending-only flows.
- Do not remove or rotate the beneficiary encryption key while encrypted payout requests exist unless a verified re-encryption migration has been completed.
- A successful deployment or automated test is not proof of an external bank settlement.
