# Sentry Monitoring Setup for VaultBank

This guide provides instructions for integrating Sentry error monitoring into both the frontend and backend of VaultBank.

## 🎯 Overview

Sentry provides real-time error tracking and monitoring for your application. This setup includes:

1. **Frontend Integration**: React error boundary and global error handling
2. **Backend Integration**: Express error middleware and unhandled exception capture
3. **Environment Configuration**: Development vs Production settings

## 🚀 Frontend Setup

### 1. Install Sentry SDK

```bash
cd client
npm install @sentry/react @sentry/tracing
```

### 2. Create Sentry Configuration File

Create `client/src/utils/sentry.js`:

```javascript
import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";

// Initialize Sentry only if DSN is provided
export const initSentry = () => {
  const sentryDsn = process.env.REACT_APP_SENTRY_DSN;
  const environment = process.env.REACT_APP_SENTRY_ENV || "development";

  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment,
      integrations: [new Integrations.BrowserTracing()],
      tracesSampleRate: 1.0,
      release: process.env.REACT_APP_VERSION || "unknown",
      // Capture unhandled promise rejections
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "Network Error",
        "Failed to fetch",
        "Load failed",
        "Script error",
        "Cancel",
        "AbortError",
      ],
      beforeSend(event) {
        // Filter out sensitive data
        if (
          event.request?.url?.includes("/auth/") ||
          event.request?.url?.includes("/login")
        ) {
          return null;
        }
        return event;
      },
    });

    console.log(`🚀 Sentry initialized in ${environment} mode`);
  } else {
    console.log(
      "📝 Sentry DSN not configured, running without error monitoring"
    );
  }
};

// Error boundary component
export const SentryErrorBoundary = ({ children }) => {
  if (process.env.REACT_APP_SENTRY_DSN) {
    return (
      <Sentry.ErrorBoundary
        fallback={({ error, componentStack, resetError }) => (
          <div className="p-4 bg-red-50 rounded-lg border border-red-200">
            <h3 className="text-red-600 font-semibold">Something went wrong</h3>
            <p className="text-sm text-gray-600 mt-2">
              We've been notified about this issue.
            </p>
            <button
              onClick={resetError}
              className="mt-3 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Try again
            </button>
          </div>
        )}
        onError={(error, componentStack) => {
          // Additional error logging
          console.error("Sentry Error Boundary:", error, componentStack);
        }}
      >
        {children}
      </Sentry.ErrorBoundary>
    );
  }

  // Fallback for when Sentry is not configured
  return <>{children}</>;
};

// Capture manual errors
export const captureError = (error, context = {}) => {
  if (process.env.REACT_APP_SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.keys(context).forEach((key) => {
        scope.setExtra(key, context[key]);
      });
      Sentry.captureException(error);
    });
  } else {
    console.error("Error (not sent to Sentry):", error, context);
  }
};

// Capture messages
export const captureMessage = (message, level = "info", context = {}) => {
  if (process.env.REACT_APP_SENTRY_DSN) {
    Sentry.withScope((scope) => {
      Object.keys(context).forEach((key) => {
        scope.setExtra(key, context[key]);
      });
      Sentry.captureMessage(message, level);
    });
  } else {
    console.log(`[${level}] ${message}:`, context);
  }
};
```

### 3. Update App Entry Point

Modify `client/src/index.js` to initialize Sentry:

```javascript
import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import { initSentry, SentryErrorBoundary } from "./utils/sentry";

// Initialize Sentry first
initSentry();

ReactDOM.render(
  <React.StrictMode>
    <SentryErrorBoundary>
      <App />
    </SentryErrorBoundary>
  </React.StrictMode>,
  document.getElementById("root")
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
```

### 4. Add Environment Variables

Add to `.env`:

```
REACT_APP_SENTRY_DSN=your-sentry-dsn-here
REACT_APP_SENTRY_ENV=development
```

Add to Vercel environment variables:

```
REACT_APP_SENTRY_DSN=https://your-sentry-dsn@sentry.io/123456
REACT_APP_SENTRY_ENV=production
```

## 🛤️ Backend Setup

### 1. Install Sentry SDK

```bash
cd server
npm install @sentry/node @sentry/tracing
```

### 2. Create Sentry Configuration File

Create `server/utils/sentry.js`:

```javascript
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

let isSentryInitialized = false;

const initSentry = () => {
  const sentryDsn = process.env.SENTRY_DSN;
  const environment = process.env.SENTRY_ENV || "development";

  if (sentryDsn && !isSentryInitialized) {
    Sentry.init({
      dsn: sentryDsn,
      environment,
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app: require("../index") }),
        nodeProfilingIntegration(),
      ],
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
      release: process.env.VERSION || "unknown",
      // Filter sensitive data
      beforeSend(event) {
        // Remove sensitive request data
        if (event.request) {
          if (event.request.url && event.request.url.includes("/auth/")) {
            return null;
          }
          if (event.request.headers) {
            event.request.headers = {
              ...event.request.headers,
              authorization: "[REDACTED]",
              cookie: "[REDACTED]",
            };
          }
        }
        return event;
      },
    });

    isSentryInitialized = true;
    console.log(`🚀 Sentry initialized in ${environment} mode for backend`);
  } else if (!sentryDsn) {
    console.log(
      "📝 Sentry DSN not configured for backend, running without error monitoring"
    );
  }
};

const captureError = (error, context = {}) => {
  if (isSentryInitialized) {
    Sentry.withScope((scope) => {
      Object.keys(context).forEach((key) => {
        scope.setExtra(key, context[key]);
      });
      Sentry.captureException(error);
    });
  } else {
    console.error("Backend Error (not sent to Sentry):", error, context);
  }
};

const captureMessage = (message, level = "info", context = {}) => {
  if (isSentryInitialized) {
    Sentry.withScope((scope) => {
      Object.keys(context).forEach((key) => {
        scope.setExtra(key, context[key]);
      });
      Sentry.captureMessage(message, level);
    });
  } else {
    console.log(`[Backend ${level}] ${message}:`, context);
  }
};

// Request handler for Express
const SentryRequestHandler = Sentry.Handlers.requestHandler();
const SentryErrorHandler = Sentry.Handlers.errorHandler();

// Graceful shutdown
const closeSentry = async () => {
  if (isSentryInitialized) {
    await Sentry.close(2000);
    console.log("📤 Sentry client closed gracefully");
  }
};

module.exports = {
  initSentry,
  captureError,
  captureMessage,
  SentryRequestHandler,
  SentryErrorHandler,
  closeSentry,
};
```

### 3. Update Server Entry Point

Modify `server/index.js` to integrate Sentry:

```javascript
// Add near the top with other requires
const {
  initSentry,
  captureError,
  SentryRequestHandler,
  SentryErrorHandler,
} = require("./utils/sentry");

// Initialize Sentry early
initSentry();

// Add Sentry request handler as first middleware (after security middleware)
app.use(SentryRequestHandler);

// Add Sentry error handler before other error handlers
app.use(SentryErrorHandler);

// Add error handling for unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  captureError(reason, {
    promise: promise.toString(),
    type: "unhandledRejection",
  });
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  captureError(error, { type: "uncaughtException" });
  console.error("Uncaught Exception:", error);
  // Give Sentry time to send the error before exiting
  setTimeout(() => process.exit(1), 1000);
});

// Add graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  await closeSentry();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down gracefully");
  await closeSentry();
  process.exit(0);
});
```

### 4. Add Environment Variables

Add to `.env`:

```
SENTRY_DSN=your-backend-sentry-dsn-here
SENTRY_ENV=development
```

Add to Railway environment variables:

```
SENTRY_DSN=https://your-backend-sentry-dsn@sentry.io/123456
SENTRY_ENV=production
```

## 📝 Environment Variables Summary

| Variable     | Frontend | Backend | Description                                         |
| ------------ | -------- | ------- | --------------------------------------------------- |
| `SENTRY_DSN` | ✅       | ✅      | Sentry project DSN                                  |
| `SENTRY_ENV` | ✅       | ✅      | Environment name (development, staging, production) |

**Frontend variables** use `REACT_APP_` prefix:

- `REACT_APP_SENTRY_DSN`
- `REACT_APP_SENTRY_ENV`

## 🎯 Usage Examples

### Frontend Usage

```javascript
import { captureError, captureMessage } from "./utils/sentry";

// Capture API errors
try {
  const response = await api.get("/user/data");
} catch (error) {
  captureError(error, {
    endpoint: "/user/data",
    userId: user.id,
    timestamp: new Date().toISOString(),
  });
  // Show user-friendly message
  toast.error("Failed to load data. Please try again.");
}

// Capture important events
captureMessage("User completed onboarding", "info", {
  userId: user.id,
  stepsCompleted: 5,
  durationSeconds: 120,
});
```

### Backend Usage

```javascript
const { captureError, captureMessage } = require("./utils/sentry");

// In route handlers
router.post("/api/payment", async (req, res) => {
  try {
    const result = await processPayment(req.body);
    res.json({ success: true, result });
  } catch (error) {
    captureError(error, {
      userId: req.user?.id,
      paymentAmount: req.body.amount,
      paymentMethod: req.body.method,
    });
    res
      .status(500)
      .json({ success: false, message: "Payment processing failed" });
  }
});

// Log important events
captureMessage("User upgraded to premium", "info", {
  userId: req.user.id,
  plan: "premium",
  previousPlan: "free",
});
```

## 🏥 Error Handling Best Practices

1. **Don't crash the app**: Always catch errors and provide fallback UI/behavior
2. **Filter sensitive data**: Never send PII, passwords, or tokens to Sentry
3. **Context matters**: Add relevant context (user ID, request details, etc.)
4. **User-friendly messages**: Show appropriate messages to users while logging technical details
5. **Breadcrumbs**: Use `Sentry.addBreadcrumb()` to track user actions leading to errors

## 🧪 Testing Plan

### Frontend Tests

1. **Development Mode**:

   - Set `REACT_APP_SENTRY_DSN` to undefined
   - Verify console logs show "Sentry DSN not configured"
   - Test error boundary fallback UI

2. **Production Mode**:

   - Set valid Sentry DSN
   - Trigger test errors in different components
   - Verify errors appear in Sentry dashboard
   - Test error boundary with actual errors
   - Verify breadcrumbs and context are captured

3. **Error Scenarios**:
   - API call failures
   - Component rendering errors
   - Unhandled promise rejections
   - Manual error capture

### Backend Tests

1. **Development Mode**:

   - Set `SENTRY_DSN` to undefined
   - Verify console logs show "Sentry DSN not configured"
   - Test error handling doesn't crash server

2. **Production Mode**:

   - Set valid Sentry DSN
   - Trigger test API errors
   - Verify errors appear in Sentry dashboard
   - Test unhandled exceptions and rejections
   - Verify request context is captured

3. **Error Scenarios**:
   - Route handler errors
   - Database connection failures
   - Authentication errors
   - Unhandled promise rejections
   - Uncaught exceptions

## 🚀 Deployment Checklist

1. [ ] Set up Sentry projects (frontend + backend)
2. [ ] Add DSN values to environment variables
3. [ ] Configure alert rules in Sentry
4. [ ] Set up release tracking
5. [ ] Configure source maps (frontend)
6. [ ] Test error reporting in staging
7. [ ] Verify production monitoring

## 📚 Resources

- [Sentry React Documentation](https://docs.sentry.io/platforms/javascript/guides/react/)
- [Sentry Node Documentation](https://docs.sentry.io/platforms/node/)
- [Sentry Performance Monitoring](https://docs.sentry.io/product/performance/)
- [Sentry Security Best Practices](https://docs.sentry.io/product/sentry-basics/data-management-sensitivity/)

Happy monitoring! 🎉
