/**
 * Sprint 2 -- Unit tests for the payment-specific metrics module.
 */
const metrics = require('../metrics/payments');

describe('metrics/payments', () => {
    test('recordPaymentAttempt increments the counters', async () => {
        const before = await metrics.registry.getSingleMetricAsString('vaultbank_payment_attempts_total');
        metrics.recordPaymentAttempt({ provider: 'stripe', method: 'stripe_card', outcome: 'success', durationMs: 123 });
        metrics.recordPaymentAttempt({ provider: 'stripe', method: 'stripe_card', outcome: 'failure', reason: 'card_declined' });
        metrics.recordPaymentAttempt({ provider: 'razorpay', method: 'upi', outcome: 'mock' });
        const after = await metrics.registry.getSingleMetricAsString('vaultbank_payment_attempts_total');
        expect(after.length).toBeGreaterThan(before.length);
    });

    test('recordWebhookEvent and recordWebhookSignatureFailure', async () => {
        metrics.recordWebhookEvent({ provider: 'stripe', eventType: 'payment_intent.succeeded', result: 'processed' });
        metrics.recordWebhookSignatureFailure('paypal');
        const out = await metrics.registry.getSingleMetricAsString('vaultbank_webhook_events_total');
        expect(out).toContain('vaultbank_webhook_events_total');
        const sig = await metrics.registry.getSingleMetricAsString('vaultbank_webhook_signature_failures_total');
        expect(sig).toContain('paypal');
    });

    test('recordReconciliationMismatches no-ops on zero', async () => {
        const before = await metrics.registry.getSingleMetricAsString('vaultbank_reconciliation_mismatches_total');
        metrics.recordReconciliationMismatches('stripe', 'mismatch', 0);
        const after = await metrics.registry.getSingleMetricAsString('vaultbank_reconciliation_mismatches_total');
        expect(after).toBe(before);
    });

    test('captureException is a no-op without SENTRY_DSN', () => {
        const old = process.env.SENTRY_DSN;
        delete process.env.SENTRY_DSN;
        try { metrics.captureException(new Error('test')); }
        finally { if (old !== undefined) process.env.SENTRY_DSN = old; }
    });
});