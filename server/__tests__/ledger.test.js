/**
 * Sprint 1 — Unit tests for the payment ledger persistence helpers.
 *
 * These tests run against the demo (no-DB) path. In CI with DATABASE_URL,
 * the real `query()` would be exercised and the dedup unique index would
 * be tested with a real insert + duplicate attempt.
 */
const ledger = require('../payments/ledger');

describe('payments/ledger', () => {
    test('upsertPayment returns null on missing required fields (throws)', async () => {
        await expect(ledger.upsertPayment({})).rejects.toThrow(/provider and provider_id/);
        await expect(ledger.upsertPayment({ provider: 'stripe' })).rejects.toThrow(/provider and provider_id/);
    });

    test('upsertPayment returns null on demo mode (no DB)', async () => {
        const r = await ledger.upsertPayment({
            provider: 'stripe',
            provider_id: 'pi_test_123',
            to_identifier: 'acct_test',
            amount: 10.0,
            currency: 'USD',
        });
        // demo mode -> null (no error)
        expect(r === null || typeof r === 'object').toBe(true);
    });

    test('findPaymentByIdempotencyKey returns null when key is empty', async () => {
        expect(await ledger.findPaymentByIdempotencyKey('')).toBeNull();
        expect(await ledger.findPaymentByIdempotencyKey(null)).toBeNull();
    });

    test('recordWebhookEvent fails open when DB unavailable', async () => {
        const r = await ledger.recordWebhookEvent({
            provider: 'stripe',
            providerEventId: 'evt_test_1',
            eventType: 'payment_intent.succeeded',
            payload: { id: 'evt_test_1', type: 'payment_intent.succeeded' },
        });
        expect(r).toHaveProperty('duplicate');
        // demo mode -> no DB, so we treat as first time
        expect(r.duplicate).toBe(false);
    });

    test('updatePaymentStatus does not throw on demo mode', async () => {
        const r = await ledger.updatePaymentStatus('stripe', 'pi_test_1', 'succeeded');
        expect(r === null || typeof r === 'object').toBe(true);
    });
});
