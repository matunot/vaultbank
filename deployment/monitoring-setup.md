# VaultBank Production Monitoring & Alerting Setup

# 1. Sentry Integration for Error Tracking

## Backend Sentry Configuration (server/index.js additions)

```javascript
// Sentry error tracking for production
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "production",
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Express({ app }),
    new Tracing.Integrations.Mysql2(),
  ],
  beforeSend(event) {
    // Filter out health check errors
    if (event.request && event.request.url.includes("/health")) {
      return null;
    }
    return event;
  },
});

// Add Sentry middleware
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// Error handler should be last
app.use(Sentry.Handlers.errorHandler());
```

## Frontend Sentry Configuration (client/src/utils/sentry.js)

```javascript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: process.env.REACT_APP_SENTRY_DSN,
  environment: process.env.NODE_ENV || "production",
  integrations: [new Sentry.BrowserTracing()],
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Filter out common non-critical errors
    if (event.exception) {
      const error = event.exception.values[0];
      if (error.type === "ChunkLoadError" || error.type === "NetworkError") {
        return null; // Don't send chunk loading errors
      }
    }
    return event;
  },
});

export default Sentry;
```

# 2. Uptime Monitoring Configuration

## Health Check Endpoint

The backend exposes a `/health` endpoint that returns:

```javascript
// Health check route (server/routes/health.js)
router.get("/health", async (req, res) => {
  const health = {
    uptime: process.uptime(),
    message: "VaultBank API is healthy",
    timestamp: Date.now(),
    status: "ok",
  };

  try {
    // Check database connection
    await db.raw("SELECT 1");
    health.database = "connected";
  } catch (error) {
    health.database = "disconnected";
    health.status = "error";
  }

  res.status(health.status === "ok" ? 200 : 500).json(health);
});
```

## Monitoring Services to Configure

### 1. UptimeRobot (Recommended - Free Tier Available)

- Monitor URLs:
  - `https://api.vaultbank.com/health`
  - `https://app.vaultbank.com/`
- Check interval: 1 minute
- Timeout: 30 seconds

### 2. Pingdom Alternative

- Similar functionality with free tier

### 3. Custom Health Dashboard

Create a monitoring page at `/admin/monitoring` showing:

- API response times
- Database connection status
- Error rates
- Active user counts
- Transaction volumes

# 3. Alert Conditions & Thresholds

## Critical Alerts (Immediate Response Required)

1. **API Down**

   - Condition: Health check fails for 2+ minutes
   - Action: SMS + Email to on-call team

2. **High Error Rate**

   - Condition: >5% of requests return 5xx errors in 5 minutes
   - Action: Slack alert + Email

3. **Database Issues**
   - Condition: Database connection fails
   - Action: Immediate on-call notification

## Warning Alerts (Investigate Within 1 Hour)

1. **Slow Response Times**

   - Condition: >500ms average response time for 10 minutes
   - Action: Slack notification

2. **Suspicious Activity**

   - Condition: >10 failed login attempts per user in 5 minutes
   - Action: Security team alert

3. **High Transaction Volume**
   - Condition: >1000 transactions in 5 minutes
   - Action: Operations team notification

# 4. Logging & Log Aggregation

## Structured Logging (server/utils/logger.js)

```javascript
const winston = require("winston");

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "vaultbank-api" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

module.exports = logger;
```

## Key Events to Log

1. **User Actions**

   - Login/logout
   - Transfers
   - Account changes
   - Security events

2. **System Events**

   - API requests/responses
   - Database queries
   - External service calls
   - Error occurrences

3. **Business Events**
   - Transactions processed
   - Rewards calculated
   - Alerts triggered
   - Admin actions

# 5. Performance Monitoring

## Metrics to Track

1. **API Performance**

   - Response times (p50, p95, p99)
   - Request rates
   - Error rates

2. **Database Performance**

   - Query execution times
   - Connection pool usage
   - Deadlock occurrences

3. **Business Metrics**
   - Daily active users
   - Transaction volumes
   - Revenue metrics
   - User acquisition

## Tools for Performance Monitoring

1. **Application Performance Monitoring (APM)**

   - New Relic
   - DataDog
   - AWS X-Ray

2. **Infrastructure Monitoring**
   - AWS CloudWatch
   - Google Cloud Monitoring
   - Azure Monitor

# 6. Incident Response Procedures

## Severity Levels

1. **P1 - Critical** (Immediate response)

   - Complete service outage
   - Security breach
   - Data loss

2. **P2 - High** (Response within 1 hour)

   - Partial service degradation
   - High error rates
   - Performance issues

3. **P3 - Medium** (Response within 4 hours)

   - Minor functionality issues
   - Cosmetic problems
   - Non-critical alerts

4. **P4 - Low** (Response within 24 hours)
   - Feature requests
   - Documentation issues
   - Minor bugs

## Runbook Template

1. **Incident Detection**

   - Monitoring alert received
   - Initial assessment
   - Severity classification

2. **Response Actions**

   - Immediate mitigation steps
   - Root cause investigation
   - Fix implementation

3. **Communication**
   - Stakeholder notifications
   - Status updates
   - Post-incident review

# 7. Backup Monitoring

## Backup Verification

1. **Daily Automated Tests**

   - Restore to test environment
   - Verify data integrity
   - Confirm backup completion

2. **Monitoring Backup Jobs**

   - Failed backup alerts
   - Large backup size changes
   - Long backup duration

3. **Recovery Time Objectives (RTO)**
   - Database: < 30 minutes
   - Application: < 15 minutes
   - Full system: < 1 hour

---

**Next Steps:**

1. Set up Sentry projects for both frontend and backend
2. Configure uptime monitoring service
3. Implement structured logging
4. Test alert mechanisms
5. Create incident response documentation
