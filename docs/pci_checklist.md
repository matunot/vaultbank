# VaultBank — PCI Compliance Checklist

## Scope

VaultBank uses **Stripe Elements** for all card payments. Card PAN never reaches our server — Stripe handles the sensitive data in its PCI-validated environment. Our SAQ type is **SAQ A** (card-not-present merchants that outsource all cardholder data functions to PCI DSS validated third parties). This checklist covers what we must do to maintain SAQ A eligibility.

## Required controls

| # | Control | Evidence | Owner | Status |
| --- | --------- | ---------- | ------- | -------- |
| 1 | No storage of PAN, CVV, or track data anywhere in VaultBank | Code audit: no `rawCardNumber`, `cvv`, `pan` in any DB column, log, or response | Eng | |
| 2 | Tokenization: use Stripe Elements for card collection | `client/src/components/StripePayment.jsx` mounts `<CardElement>`; server receives only `clientSecret` | Eng | |
| 3 | No plaintext credentials in source code | All keys in env vars (Vercel Secrets / GitHub Secrets); `.env` in `.gitignore` | Ops | |
| 4 | TLS everywhere | Vercel enforces HTTPS by default; HSTS header set to `max-age=63072000; includeSubDomains; preload` in `api/payments.js` | Ops | |
| 5 | CSP headers restrict frame/script sources | `api/payments.js` sets `Content-Security-Policy` allowing only Stripe and Razorpay CDNs | Eng | |
| 6 | Access control: admin endpoints require admin JWT role | `/api/admin/*` routes use `requireAdmin` middleware | Eng | |
| 7 | Audit logging of financial actions | `server/utils/audit.js` writes to `audit_logs` table; transfer route logs via `logAudit(userId, ...)` | Eng | |
| 8 | Webhook signature verification | Stripe: `stripe.webhooks.constructEvent()` with raw body; Razorpay: HMAC-SHA256; PayPal: check webhook_id | Eng | |
| 9 | Idempotency to prevent duplicate charges | In-memory TTL cache + DB `idempotency_key` unique index; double-charge impossible for same `Idempotency-Key` | Eng | |
| 10 | Reconciliation: nightly comparison of provider tx vs ledger | `server/scripts/run-reconciliation.js` — confirms no missing/mismatched funds | Ops | |
| 11 | Role-based access: "admin" and "user" roles enforced | `server/middleware/auth.js` has `requireAdmin`, `authenticateToken` | Eng | |
| 12 | Secrets rotation policy | Rotate Stripe secret key every 90 days; rotate webhook secrets immediately on suspicion | Ops | |
| 13 | Retention policy: audit logs kept 12 months | `audit_logs` table; retention enforced by TTL or archive job | Ops | |
| 14 | Vendor PCI attestations on file | Stripe: PCI DSS v4.0 Level 1 (available at stripe.com/docs/security); Razorpay: PCI DSS Level 1; PayPal: PCI DSS Level 1 | Compliance | |
| 15 | Vulnerability scanning (quarterly) | Use external ASV (e.g., Qualys, HackerOne); scan `vaultbank.vercel.app` | Security | |
| 16 | Penetration testing (annual) | Engage third-party pen tester; scope includes all payment endpoints | Security | |
| 17 | Security awareness training for payment-dev engineers | Annual training covering PHI (personally identifiable info) handling, phishing | HR/Security | |
| 18 | Incident response plan documented | See `docs/incident_playbook.md` | Ops | |
| 19 | Change management for payment code | All payment changes go through PR review; CI runs tests + validate-secrets | Eng | |
| 20 | SAQ A self-assessment signed annually | Complete SAQ A worksheet; keep with compliance records | Compliance | |

## Evidence artifacts committed in repo

- [x] Tokenization component: `client/src/components/StripePayment.jsx`
- [x] Webhook verification: `server/payments/stripe.js` (constructEvent), `server/payments/razorpay.js` (HMAC), `server/payments/paypal.js` (webhook_id)
- [x] CSP/HSTS: `api/payments.js`
- [x] Idempotency: `server/middleware/idempotency.js`, `server/payments/ledger.js` (findPaymentByIdempotencyKey)
- [x] Reconciliation: `server/payments/reconciliation.js`, `server/scripts/run-reconciliation.js`
- [x] Audit logging: `server/utils/audit.js`
- [x] Access control: `server/middleware/auth.js` (authenticateToken, requireAdmin)
- [x] Incident playbook: `docs/incident_playbook.md`
- [x] Production-safety env validation: `server/payments/safety.js`
- [x] This checklist: `docs/pci_checklist.md`

## Operational tasks (external to repo)

- [ ] Stripe PCI attestation downloaded from Stripe dashboard → `docs/compliance/`
- [ ] SAQ A worksheet completed → `docs/compliance/`
- [ ] ASV scan results → `docs/compliance/`
- [ ] Pen test report → `docs/compliance/`
- [ ] Secrets rotation scheduled in calendar (90-day cycle)
- [ ] Retention archive job configured for `audit_logs` (12-month TTL)
