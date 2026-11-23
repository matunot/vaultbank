# Salt Edge Partner Payment Initiation — Live integration

This is a **live-only pay-in integration** for an account that has been approved for Salt Edge Partners Payment Initiation. It does not use fake providers, sandbox endpoints, seeded balances, or demo credits.

## What the integration does

- Lists active bank providers and their payment templates from Salt Edge.
- Creates/reuses a Salt Edge lead for a verified VaultBank user.
- Creates a bank payment session against a server-configured receiving account and returns Salt Edge's hosted authorization URL.
- Verifies Salt Edge callbacks using the published callback-signing public key, then fetches the canonical payment object from Salt Edge before updating local payment status.
- Creates a VaultBank bank-deposit instruction with a unique payment reference. That reference is used by the existing bank-statement reconciliation and double-entry ledger flow.

**A provider status of \`accepted\` is not treated as proof that money has settled into the receiving account.** Callback processing never credits a customer balance. An authorized admin must confirm the actual incoming bank-statement transaction and UTR through the existing endpoint:

\`POST /api/bank-deposits/admin/instructions/:id/verify\`

That route checks the exact amount, unique bank transaction reference, and ledger idempotency before crediting.

## API endpoints

- \`GET /api/salt-edge/pis/readiness\` — secret-free readiness.
- \`GET /api/salt-edge/pis/providers\` — active, non-fake bank providers available to the approved Live account.
- \`GET /api/salt-edge/pis/templates/:identifier\` — required and optional fields for a provider template.
- \`POST /api/salt-edge/pis/deposits\` — create a payment session.
- \`GET /api/salt-edge/pis/deposits\` — current user's sessions; admins see all.
- \`GET /api/salt-edge/pis/admin/reconciliation\` — admin reconciliation queue.
- \`POST /api/salt-edge/pis/callbacks/success\`
- \`POST /api/salt-edge/pis/callbacks/fail\`
- \`POST /api/salt-edge/pis/callbacks/notify\`

Deposit request body:

\`\`\`json
{
  "amount": "25.00",
  "currency": "EUR",
  "providerCode": "provider_code_returned_by_the_API"
}
\`\`\`

Only active, `regulated: true` providers that advertise the configured payment template are returned. The provider's own `required_payment_fields` are checked as well as the generic template fields. The payment template is configured server-side per currency; the browser cannot choose or override the beneficiary account, amount reference, or template.

## Render environment variables

Set these on the existing Render web service \`vaultbank\`. Use the existing **Service** API key's App ID and Secret; do not commit them to GitHub or paste them into chat.

| Variable | Purpose |
| --- | --- |
| \`VB_SALT_EDGE_PIS_APP_ID\` | Salt Edge Service API key App ID |
| \`VB_SALT_EDGE_PIS_SECRET\` | Salt Edge Service API key Secret |
| \`VB_SALT_EDGE_PIS_PRIVATE_KEY\` | RSA private key PEM used to sign outgoing API requests |
| \`VB_SALT_EDGE_PIS_CALLBACK_BASE_URL\` | Exact base path, for example \`https://vaultbank-md20.onrender.com/api/salt-edge/pis/callbacks\` |
| \`VB_SALT_EDGE_PIS_RETURN_URL\` | Use \`https://vaultbank-978m.vercel.app/?vb_section=payments\` so the app opens the Payments tab after authorization |
| \`VB_SALT_EDGE_PIS_ENABLED\` | Set to \`true\` only when deliberately enabling the integration |
| \`VB_SALT_EDGE_PIS_LIVE_APPROVED\` | Keep \`false\` until Salt Edge has explicitly changed the account to **Live** |

### Per-currency receiving account

Only configure currencies for which a real receiving account is available and the Salt Edge provider supports a matching payment template.

- \`VB_SALT_EDGE_PIS_<CURRENCY>_CREDITOR_NAME\`
- \`VB_SALT_EDGE_PIS_<CURRENCY>_CREDITOR_COUNTRY_CODE\` — ISO alpha-2 country code
- \`VB_SALT_EDGE_PIS_<CURRENCY>_TEMPLATE_IDENTIFIER\` — e.g. a provider-supported template such as \`SEPA\`
- \`VB_SALT_EDGE_PIS_<CURRENCY>_CREDITOR_IBAN\` — required when the selected template uses an IBAN
- \`VB_SALT_EDGE_PIS_<CURRENCY>_EXTRA_FIELDS_JSON\` — optional JSON object for other provider-specific creditor fields (for example, account number and sort code)

The destination account details must belong to, or be legitimately controlled by, the receiving entity/operator. Never enter placeholder or invented bank details. The integration sends only fields defined by the provider's selected template and refuses to create a session when a required field is missing.

## Salt Edge dashboard configuration

1. Create/use a **Service** API key.
2. Generate an RSA 2048-bit key pair. Register the **public** key in the Salt Edge Service API key settings; keep the **private** key only in Render.
3. Register the exact HTTPS callback URLs:
   - \`https://vaultbank-md20.onrender.com/api/salt-edge/pis/callbacks/success\`
   - \`https://vaultbank-md20.onrender.com/api/salt-edge/pis/callbacks/fail\`
   - \`https://vaultbank-md20.onrender.com/api/salt-edge/pis/callbacks/notify\`
4. Enable the account's required security settings and complete Salt Edge's Partner PIS integration review.
5. Only after the Salt Edge dashboard explicitly shows **Live**, set \`VB_SALT_EDGE_PIS_LIVE_APPROVED=true\`. Keep it false before that point.

OpenSSL key-pair commands:

\`\`\`powershell
openssl genrsa -out salt-edge-private.pem 2048
openssl rsa -pubout -in salt-edge-private.pem -out salt-edge-public.pem
\`\`\`

Paste \`salt-edge-public.pem\` into Salt Edge. Put the contents of \`salt-edge-private.pem\` in the Render secret variable. Do not upload the private key to GitHub.

## Important boundaries

- This integration initiates a customer-authorized **bank pay-in** to a configured receiving account. It does not issue bank accounts, create a licensed deposit-taking institution, or provide a customer-to-customer bank payout rail.
- Provider and payment-template coverage is specific to the countries and banks enabled for the Salt Edge Partner account. It is not a promise of Indian UPI/IMPS/NEFT coverage.
- No fake/sandbox provider is returned by the provider-list route.
- Production stays fail-closed until credentials, signed requests, HTTPS callback/return URLs, receiving-account details, and explicit Salt Edge Live approval are configured.
