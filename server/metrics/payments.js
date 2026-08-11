/**
 * Payment-specific Prometheus metrics (Sprint 2)
 * -------------------------------------------------
 * Builds on top of `server/metrics.js` (which already initialises
 * `prom-client`). Adds the counters and histograms we care about
 * for live payments + webhooks + reconciliation.
 *
 * Counters
 *   * vaultbank_payment_attempts_total{provider,method,outcome}
 *   * vaultbank_payment_success_total{provider,method}
 *   * vaultbank_payment_failure_total{provider,method,reason}
 *   * vaultbank_webhook_events_total{provider,event_type,result}
 *   * vaultbank_webhook_signature_failures_total{provider}
 *   * vaultbank_reconciliation_mismatches_total{provider,status}
 *   * vaultbank_idempotency_replays_total
 *
 * Histogram
 *   * vaultbank_payment_duration_seconds{provider,method}
 *
 * Plus a tiny Sentry capture helper that no-ops when SENTRY_DSN is unset.
 */

const client = require('prom-client');

let _initialized = false;
const counters = {};
const histograms = {};

function ensure() {
    if (_initialized) return;
    _initialized = true;

    counters.paymentAttempts = new client.Counter({
        name: 'vaultbank_payment_attempts_total',
        help: 'Total payment attempts',
        labelNames: ['provider', 'method', 'outcome'],
    });

    counters.paymentSuccess = new client.Counter({
        name: 'vaultbank_payment_success_total',
        help: 'Total successful payments',
        labelNames: ['provider', 'method'],
    });

    counters.paymentFailure = new client.Counter({
        name: 'vaultbank_payment_failure_total',
        help: 'Total failed payments',
        labelNames: ['provider', 'method', 'reason'],
    });

    counters.webhookEvents = new client.Counter({
        name: 'vaultbank_webhook_events_total',
        help: 'Total webhook events received (post-dedup)',
        labelNames: ['provider', 'event_type', 'result'],
    });

    counters.webhookSignatureFailures = new client.Counter({
        name: 'vaultbank_webhook_signature_failures_total',
        help: 'Webhook signature verification failures',
        labelNames: ['provider'],
    });

    counters.reconciliationMismatches = new client.Counter({
        name: 'vaultbank_reconciliation_mismatches_total',
        help: 'Reconciliation rows by status',
        labelNames: ['provider', 'status'],
    });

    counters.idempotencyReplays = new client.Counter({
        name: 'vaultbank_idempotency_replays_total',
        help: 'Idempotency-Key replays (same key, same response)',
    });

    histograms.paymentDuration = new client.Histogram({
        name: 'vaultbank_payment_duration_seconds',
        help: 'Time to create a payment intent, by provider and method',
        labelNames: ['provider', 'method'],
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });
}

/**
 * Record a payment attempt. outcome is 'success' | 'failure' | 'mock'.
 */
function recordPaymentAttempt({ provider, method, outcome, reason, durationMs }) {
    ensure();
    const p = provider || 'unknown';
    const m = method || 'unknown';
    const o = outcome || 'unknown';
    counters.paymentAttempts.inc({ provider: p, method: m, outcome: o });
    if (o === 'success') {
        counters.paymentSuccess.inc({ provider: p, method: m });
    } else if (o === 'failure') {
        counters.paymentFailure.inc({ provider: p, method: m, reason: reason || 'unknown' });
    }
    if (typeof durationMs === 'number') {
        histograms.paymentDuration.observe({ provider: p, method: m }, durationMs / 1000);
    }
}

function recordWebhookEvent({ provider, eventType, result }) {
    ensure();
    counters.webhookEvents.inc({
        provider: provider || 'unknown',
        event_type: eventType || 'unknown',
        result: result || 'unknown',
    });
}

function recordWebhookSignatureFailure(provider) {
    ensure();
    counters.webhookSignatureFailures.inc({ provider: provider || 'unknown' });
}

function recordReconciliationMismatches(provider, status, count) {
    ensure();
    if (!count) return;
    counters.reconciliationMismatches.inc({ provider: provider || 'unknown', status: status || 'unknown' }, count);
}

function recordIdempotencyReplay() {
    ensure();
    counters.idempotencyReplays.inc();
}

/**
 * Sentry capture helper. Reads SENTRY_DSN at call time so it can be
 * changed at runtime. No-op when Sentry is not configured.
 */
function captureException(err, context) {
    if (!err) return;
    if (!process.env.SENTRY_DSN) return;
    try {
        // Lazy require so the SDK is only loaded when needed.
        const Sentry = require('@sentry/node');
        Sentry.captureException(err, { extra: context || {} });
    } catch (sentryErr) {
        console.warn('[payments-metrics] Sentry capture failed:', sentryErr.message);
    }
}

module.exports = {
    recordPaymentAttempt,
    recordWebhookEvent,
    recordWebhookSignatureFailure,
    recordReconciliationMismatches,
    recordIdempotencyReplay,
    captureException,
    // expose the registry so /metrics route can call register.metrics()
    registry: client.register,
};
