# Modern Treasury integration

## Server configuration

Set these values in the Render service environment. Never put them in frontend variables or source control.

- `MODERN_TREASURY_ORGANIZATION_ID`: Modern Treasury organization ID.
- `MODERN_TREASURY_API_KEY`: server-only API key for the chosen Modern Treasury environment.
- `MODERN_TREASURY_WEBHOOK_KEY`: signing key returned when creating the Modern Treasury webhook endpoint.

The API client uses Modern Treasury's documented HTTPS HTTP Basic authentication: Organization ID as the username and API key as the password.

## Admin diagnostics

All diagnostics require a VaultBank admin JWT:

- `GET /api/integrations/modern-treasury/status`: configuration status and enabled capabilities.
- `GET /api/integrations/modern-treasury/ping`: verifies credentials with `/api/ping` and checks `/api/api_keys/current`.
- `GET /api/integrations/modern-treasury/internal-accounts`: read-only list of active internal account metadata (optional `?currency=USD`).

These endpoints never return credentials or full bank account/routing numbers.

## Webhook setup

Configure the webhook endpoint in the matching Modern Treasury environment:

`https://vaultbank-md20.onrender.com/api/webhooks/modern-treasury`

Subscribe only to the event topics required for the current integration. Copy the endpoint's one-time webhook key into Render as `MODERN_TREASURY_WEBHOOK_KEY`.

The receiver verifies the exact raw request bytes using HMAC-SHA256 and the `X-Signature` header, checks the organization header when supplied, and deduplicates deliveries using `X-Webhook-ID`. It persists only operational event metadata and a payload hash.

## Current safety boundary

This integration is intentionally read-only at the API client layer. It does not create legal entities, counterparties, accounts, payment orders, or ledger transactions, and it does not credit VaultBank balances. Webhook deliveries are stored for future reconciliation only. Do not enable money movement until the provider account, funding source, approved payment rails, operational controls, and reconciliation mapping are verified.
