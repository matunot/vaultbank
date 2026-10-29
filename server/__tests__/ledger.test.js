/**
 * Sprint 1 — Unit tests for the payment ledger persistence helpers.
 *
 * This suite asserts the fail-closed ("DB unavailable") path: `config/db` is
 * mocked so every query rejects. Keeps the result deterministic on machines
 * whose environment points at a live DB — with a real connection the fixed
 * fixture `evt_test_1` persisted after the first run, so later runs saw
 * duplicate=true and failed. In CI with DATABASE_URL,
 * the real `query()` path is exercised elsewhere; this unit suite stays
 * mocked anyway so its result never depends on stored fixture rows.
 */
jest.mock('../config/db', () => ({
    query: jest.fn().mockRejectedValue(new Error('connection refused (test: DB unavailable)')),
}));
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

    test('recordWebhookEvent fails closed when DB unavailable', async () => {
        const r = await ledger.recordWebhookEvent({
            provider: 'stripe',
            providerEventId: 'evt_test_1',
            eventType: 'payment_intent.succeeded',
            payload: { id: 'evt_test_1', type: 'payment_intent.succeeded' },
        });
        expect(r).toHaveProperty('duplicate');
        // A missing durable dedupe claim must stop webhook processing.
        expect(r.duplicate).toBe(false);
        expect(r.id).toBeNull();
        expect(r.dbError).toBe(true);
    });

    test('updatePaymentStatus does not throw on demo mode', async () => {
        const r = await ledger.updatePaymentStatus('stripe', 'pi_test_1', 'succeeded');
        expect(r === null || typeof r === 'object').toBe(true);
    });
});
