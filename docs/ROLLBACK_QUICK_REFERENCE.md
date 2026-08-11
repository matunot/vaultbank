# VaultBank Rollback Quick Reference

> **Print this page and keep it near your monitoring station.**

---

## 🚨 IMMEDIATE KILL SWITCH (0 seconds)

```powershell
# Disable all live provider traffic instantly
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" `
  -d '{"key":"payments.live_providers_percent","percentage":0}' `
  https://vaultbank.vercel.app/api/admin/flags
```

**What this does:** Routes 100% of traffic to sandbox/test providers. No real money moves.

---

## 🔙 CODE ROLLBACK (2-5 minutes)

```powershell
# 1. Find the last good commit
git log --oneline -10

# 2. Revert the problematic commit
git revert <commit-sha>

# 3. Push to trigger redeploy
git push origin main
```

**What this does:** Creates a new commit that undoes changes. Vercel auto-deploys.

---

## 🗄️ DATABASE ROLLBACK (if needed)

```sql
-- Check recent migrations
SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;

-- Revert specific migration (consult migration file first!)
-- DROP TABLE IF EXISTS <new_table>;
-- ALTER TABLE <table> DROP COLUMN IF EXISTS <column>;
```

**Warning:** Database rollback is irreversible. Backup first!

---

## 📊 QUICK DIAGNOSTICS

```powershell
# Check deployment status
curl -s https://vaultbank.vercel.app/api/health | ConvertFrom-Json

# Check canary percentage
curl -s -H "Authorization: Bearer $ADMIN_JWT" https://vaultbank.vercel.app/api/admin/flags

# Check recent errors in Vercel
vercel logs --prod --limit 50
```

---

## 📞 INCIDENT COMMUNICATION

### Slack Template

```text
🚨 VaultBank Incident [SEVERITY]

Issue: [Brief description]
Impact: [Who/what is affected]
Status: Investigating / Identified / Mitigating / Resolved
ETA: [Estimated time to resolution]

Updates every 15 minutes.
```

### PagerDuty Template

```text
[CRITICAL] VaultBank Payment System

Summary: [One-line description]
Service: vaultbank-payments
Severity: critical
Runbook: docs/incident_playbook.md
```

---

## ✅ POST-ROLLBACK CHECKLIST

- [ ] Kill switch activated (canary = 0%)
- [ ] Incident declared (Slack/PagerDuty)
- [ ] Root cause identified
- [ ] Fix deployed and tested in staging
- [ ] Pre-canary verification passed
- [ ] Canary re-enabled at 5%
- [ ] Monitoring for 24h before promotion
- [ ] Post-incident review scheduled

---

## 📁 KEY FILES

| File | Purpose |
| ------ | --------- |
| `docs/incident_playbook.md` | Full incident response procedures |
| `docs/incident-notification-templates.md` | Communication templates |
| `monitoring/prometheus-alerts.yml` | Alert rules |
| `monitoring/grafana-dashboard.json` | Dashboard config |
| `GO_LIVE_ARTIFACTS.md` | Complete operator runbook |

---

**Last updated:** $(Get-Date -Format "yyyy-MM-dd")
