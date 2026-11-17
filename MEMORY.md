# VaultBank Working Memory

Last updated: 2026-11-17

## Product direction

VaultBank is a bank-user account application built around its own PostgreSQL double-entry ledger. The customer surface is for personal accounts, account-to-account transfers, bank funding instructions, balances, statements, savings, identity verification, and account security.

Merchant checkout and payment-request products are not part of the bank-user experience. The VB Pay merchant signup, payment-link, QR checkout, and merchant settlement feature has been removed from the application runtime. Third-party payment processor adapters are not part of the current runtime either. Do not reintroduce them as a shortcut for bank-to-bank transfers.

## Deployment

- Canonical production app/API origin: https://vaultbank-md20.onrender.com
- Render is the production hosting service; the SPA is built into `client/dist` and served by the Express API.
- GitHub repository: `matunot/vaultbank`, default branch `main`.
- Database: Neon PostgreSQL.
- Use `PROJECT_CONTEXT.md` as the canonical architecture/status document and the runbooks for operational procedures.

## Actual money movement capabilities

- Internal VaultBank account-to-account transfers: ledger-backed, same-currency, atomic, and idempotent. This does not send a transfer through an external bank network.
- Bank-transfer deposit instructions: pending only; an administrator credits funds only after matching the official receiving-bank statement and unique reference.
- INR manual bank payout requests: funds are reserved in the ledger; an operator performs the actual bank transfer separately and reconciles the bank statement/UTR.
- USD ACH: file preparation/export only; no ACH network submission.
- Additional currencies: disabled unless explicitly configured with a real receiving account. Currency wallets do not create FX or international bank connectivity.
- New UPI intents: retired in production. Existing UPI records remain available only for historical admin reconciliation.
- Crypto withdrawals: not considered live unless the hot wallet is intentionally funded and operationally verified.

## Data preservation rules

- Never delete balances, ledger journals, account transactions, payout history, or reconciliation evidence as part of feature cleanup.
- Do not drop historical schema values or old tables merely because a customer-facing feature has been retired.
- Never present a pending instruction, an exported file, or an operator queue item as a completed external bank transfer.
- Never use an in-memory/demo banking implementation for real funds.

## Verification

From the repository:
- Backend: `cd server && npm test -- --runInBand --forceExit`
- Frontend: `cd client && npx tsc --noEmit && npm run build`
- PostgreSQL integration tests require the configured test database.
- A passing test/deploy does not prove that an external bank has settled a real transfer.

## Security

- Local environment values belong in `server/.env`; placeholders are documented in `server/.env.example`.
- Production secrets belong in Render's protected environment settings.
- Never commit, print, or paste private keys, credentials, account numbers, or encryption keys into GitHub, logs, or chat.
