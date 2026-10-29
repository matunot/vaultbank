# Cards and lending: what is built, and what is genuinely blocked

VaultBank currently accepts **card-program requests** and **loan applications**. It does
not issue a card, create a card number, approve credit, disburse a loan, or charge
interest. This document records the exact real-world prerequisites before any of those
actions can be enabled, so no future change mistakes an application for a live product.

## What exists today (software)

| Capability | Status | Source of truth |
| --- | --- | --- |
| Debit/credit card request submission | Live, verification-gated | `server/routes/product-applications.js`, `card_program_requests` |
| Card request history and admin queue | Live | `GET /api/card-program/requests`, `GET /api/admin/card-program/requests` |
| Loan application and admin queue | Live | `loan_applications`, `GET /api/admin/loan-applications` |
| Duplicate-request protection | Live (`user_id, idempotency_key` unique) | `product-applications.js` |
| Customer identity gate | Live (email verified + admin-approved KYC) | `users.email_verified`, `users.kyc_status` |
| Card PAN/CVV issuance | **Not implemented** | deliberately absent |
| Credit approval, limit, disbursement, repayment | **Not implemented** | deliberately absent |
| Interest accrual | **Not implemented** | no configured funded product |

A request status of `received` means "ready for a human to review", not "approved".
`waiting_for_issuer` means the software is waiting for a real issuer integration.
`funding_required` means no lending capital facility is connected.

## Card issuing prerequisites

### India (INR, first market)

1. **Licensed issuer or sponsor.** A debit card must be issued by a scheduled commercial
   bank, or a prepaid instrument issuer authorised by the Reserve Bank of India (RBI)
   under the PPI Master Directions. A credit card must be issued by a bank or an
   RBI-registered NBFC. VaultBank cannot self-issue a network card without one of these.
2. **Network access.** RuPay membership through NPCI (directly or via the issuer/sponsor),
   or Visa/Mastercard membership through the issuer's BIN sponsorship. This includes BIN
   allocation, network certification, and card-personalisation approval.
3. **Co-branding agreement.** The RBI co-branding rules require a written agreement that
   states the issuer remains responsible for the card, customer liability, and grievance
   redressal. VaultBank's role must be described accurately to customers.
4. **KYC/AML programme.** RBI Master Directions on KYC, ongoing due diligence, sanctions
   screening, suspicious-transaction reporting to FIU-IND, and record retention.
5. **PCI DSS and key management.** PCI DSS attestation for any system that stores,
   processes, or transmits card data; HSM-backed PIN/key management; no PAN or CVV in the
   VaultBank application database; tokenisation per RBI card-tokenisation rules.
6. **Operational rails.** Card personalisation bureau, courier and activation, 3-D Secure
   (or network equivalent), real-time authorisation webhooks, clearing/settlement files,
   chargeback and dispute handling, fraud monitoring, and a 24x7 customer grievance
   channel.
7. **Settlement account.** A real bank settlement account and a signed settlement schedule.
   Card authorisations must map to ledger holds; settlement must map to balanced ledger
   journals. VaultBank's PostgreSQL ledger remains authoritative, not a processor balance.
8. **Customer disclosures.** Fees, interest (credit cards), grace period, liability policy,
   and complaint escalation must be published before activation.

### United States (USD, only if separately supported)

A US sponsor bank, BIN sponsorship, Visa/Mastercard certification, CIP/OFAC/BSA-AML
programme, state money-transmission or bank-partnership model, PCI DSS, and Reg E/Reg Z
disclosures. Do not enable USD cards by reusing an INR approval.

### Minimum viable issuer integration

The smallest honest path is an issuer-processor adapter with:

- a signed, idempotent webhook for authorisation, clearing, settlement, and reversal;
- a shadow-ledger reconciliation job before any customer funds move;
- explicit `authorization_hold` and `settlement` ledger event types;
- a certification environment that never touches production balances;
- feature flags defaulting to **off** until the issuer, BIN sponsor, and network sign off.

No legacy Stripe, PayPal, Cashfree, Nium, or crypto code may be reactivated for card
issuing. A processor adapter is new code behind a new, disabled-by-default flag.

## Lending prerequisites

1. **Licensed lender.** RBI-registered NBFC (or a bank/co-lending partner) with the
   appropriate asset classification. VaultBank cannot approve or disburse credit as a
   software feature alone.
2. **Funded facility.** A committed credit line or balance-sheet allocation. An application
   queue without capital is `funding_required`, never "approved".
3. **Underwriting policy.** Board-approved credit policy, scorecards, income verification,
   affordability tests, model validation, fair-lending review, and override governance.
4. **Disclosures and documents.** Key Fact Statement (KFS), annualised interest rate, fees,
   penal charges, grievance redressal, loan agreement, sanction letter, and repayment
   schedule that match the actual product.
5. **Servicing rails.** NACH/e-mandate or UPI Autopay registration, repayment collection,
   allocation of principal/interest/fees, delinquency buckets, collections workflow,
   restructuring, and write-off policy.
6. **Accounting and ledger.** Disbursement must be a balanced journal from a funded
   lending account to the customer's account. Interest accrual must be idempotent, use an
   explicitly configured rate, and post a balanced journal. No balance may be edited
   directly.
7. **Credit bureau and data protection.** Bureau membership/reciprocity, consent capture,
   data-localisation and retention rules, and a documented data-processing agreement.
8. **Compliance operations.** AML/sanctions monitoring, complaints, audit trail, and
   regulatory reporting.

### Minimum viable lending integration

- Underwriting service returns a decision plus reason codes; it does not move money.
- A separate, manually authorised disbursement step posts the ledger journal.
- Repayment schedules and interest accrual run only after a real disbursement exists.
- Card credit and loan credit share one exposure view; neither may create a limit without
  a funded facility.

## Explicitly disabled behaviour

- No approval is inferred from an application.
- No card number, CVV, expiry, or "active card" record is fabricated.
- No credit limit, interest quote, disbursement, or repayment schedule is created by an
  application.
- No interest or APY is advertised for savings vaults.
- No external bank settlement is reported from an internal ledger transfer.

## Single next action

- **Cards:** select and contract an issuer/BIN sponsor (India: bank or RBI-authorised PPI
  issuer plus RuPay/NPCI or Visa/Mastercard sponsorship), then build the signed
  authorisation/settlement adapter against its certification environment.
- **Lending:** obtain an RBI-registered lending entity or co-lending partner and a funded
  credit facility, then implement underwriting plus a manually authorised disbursement
  journal behind a disabled-by-default flag.
