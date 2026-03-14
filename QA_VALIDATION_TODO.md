# VaultBank QA & Go-Live Validation Checklist

## 1. User Flows Testing

- [ ] Signup/login → confirm JWT issued and stored
- [ ] Domestic transfer → balance updates + reward points applied
- [ ] Rewards dashboard → shows correct points, cashback, tier progress
- [ ] Admin login → access AdminDashboard with all modules

## 2. Rewards Engine Validation

- [ ] $100 dining → 200 points calculation
- [ ] $500 shopping → $25 cashback calculation
- [ ] $2,000 monthly spend → Gold tier upgrade
- [ ] Admin updates rule → reflected instantly

## 3. Lending Module Testing

- [ ] User applies for loan → status = pending
- [ ] Admin approves → repayment schedule generated
- [ ] User repays → outstanding balance decreases
- [ ] Late repayment → credit score drops

## 4. Insurance Module Validation

- [ ] User buys policy → appears in dashboard
- [ ] User files claim → status = pending
- [ ] Admin approves → payout logged
- [ ] Policy auto-expires after endDate

## 5. FX & International Transfers

- [ ] User sends $1,000 → converted to EUR at current rate
- [ ] Transfer flagged if >$10,000 → SAR generated
- [ ] Admin adjusts FX rate → reflected in new transfers

## 6. Business Banking Testing

- [ ] Business creates invoice → client pays → status = paid
- [ ] Payroll scheduled → auto-executes on payDate
- [ ] Analytics tab shows revenue vs expenses

## 7. Security & Compliance Verification

- [ ] Non-admin blocked from /admin routes
- [ ] All sensitive actions logged in AuditLogs
- [ ] RLS enforced on Supabase tables
- [ ] CORS restricted to production domain

## 8. Monitoring & Alerting

- [ ] Sentry error logging active
- [ ] Uptime monitor checks /health endpoint
- [ ] Alerts configured for failed transfers or suspicious activity

## 9. Final Smoke Test

- [ ] Run through each module in production build
- [ ] Confirm notifications fire (rewards earned, loan approved, claim paid)
- [ ] Confirm audit logs capture every action
- [ ] Confirm HTTPS + domain (api.vaultbank.com, app.vaultbank.com)

## Environment Setup

- [ ] Production environment configured
- [ ] Database migrations applied
- [ ] Environment variables set
- [ ] SSL certificates installed
- [ ] Domain DNS configured

## Performance & Load Testing

- [ ] API response times under 200ms
- [ ] Database query optimization
- [ ] Frontend bundle size optimization
- [ ] Concurrent user testing

## Documentation & Training

- [ ] API documentation updated
- [ ] User guides completed
- [ ] Admin training materials ready
- [ ] Support documentation prepared

---

**Status Tracking:**

- Started: 11/4/2025, 6:16:14 PM
- Estimated Duration: 4-6 hours
- Priority: Critical for Go-Live
