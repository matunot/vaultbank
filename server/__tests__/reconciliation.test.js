/**
 * Sprint 2 — Unit tests for the reconciliation engine.
 *
 * `compare()` and `classify()` are pure functions, so we can test them
 * without any DB. The DB-backed path is exercised by the live run.
 */
const recon = require('../payments/reconciliation');

describe('payments/reconciliation', () => {
    test('classify returns missing when no matching ledger row', () => {
        const r = recon.classify({ id: 'ch_123', amount: 10, currency: 'USD' }, new Map());
        expect(r.status).toBe('missing');
        expect(r.payment).toBeNull();
    });

    test('classify returns matched when amount and currency agree', () => {
        const ledger = new Map();
        ledger.set('ch_123', { id: 1, amount: 10, currency: 'USD' });
        const r = recon.classify({ id: 'ch_123', amount: 10, currency: 'USD' }, ledger);
        expect(r.status).toBe('matched');
    });

    test('classify returns mismatch when amount differs', () => {
        const ledger = new Map();
        ledger.set('ch_123', { id: 1, amount: 10, currency: 'USD' });
        const r = recon.classify({ id: 'ch_123', amount: 12, currency: 'USD' }, ledger);
        expect(r.status).toBe('mismatch');
        expect(r.ledgerAmount).toBe(10);
        expect(r.reason).toMatch(/differs/);
    });

    test('compare() returns a row per provider tx', () => {
        const providerTxs = [
            { id: 'ch_1', amount: 5, currency: 'USD' },
            { id: 'ch_2', amount: 7, currency: 'USD' },
            { id: 'ch_3', amount: 9, currency: 'USD' },
        ];
        const ledgerRows = [
            { id: 100, provider_id: 'ch_1', amount: 5, currency: 'USD' },
            { id: 101, provider_id: 'ch_2', amount: 7, currency: 'USD' },
            // ch_3 has no matching ledger row
        ];
        const result = recon.compare(providerTxs, ledgerRows);
        expect(result).toHaveLength(3);
        expect(result[0].status).toBe('matched');
        expect(result[1].status).toBe('matched');
        expect(result[2].status).toBe('missing');
    });

    test('countByStatus aggregates correctly', () => {
        const rows = [
            { status: 'matched' },
            { status: 'matched' },
            { status: 'mismatch' },
            { status: 'missing' },
        ];
        const c = recon.countByStatus(rows);
        expect(c.matched).toBe(2);
        expect(c.mismatch).toBe(1);
        expect(c.missing).toBe(1);
        expect(c.unknown).toBe(0);
    });

    test('runReconciliation rejects bad date range', async () => {
        await expect(
            recon.runReconciliation({
                provider: 'stripe',
                startAt: '2026-06-02T00:00:00Z',
                endAt: '2026-06-01T00:00:00Z',
            })
        ).rejects.toThrow(/endAt must be after startAt/);
    });

    test('runReconciliation rejects unknown provider', async () => {
        await expect(
            recon.runReconciliation({
                provider: 'notreal',
                startAt: '2026-06-01T00:00:00Z',
                endAt: '2026-06-02T00:00:00Z',
            })
        ).rejects.toThrow(/Unknown provider/);
    });

    test('runReconciliation in mock mode returns zero counts', async () => {
        // No Stripe / Razorpay / PayPal keys -> adapters return [] -> all rows missing
        const result = await recon.runReconciliation({
            provider: 'stripe',
            startAt: '2026-06-01T00:00:00Z',
            endAt: '2026-06-02T00:00:00Z',
            dryRun: true,
        });
        expect(result.dryRun).toBe(true);
        expect(result.total).toBe(0);
        expect(result.counts.matched).toBe(0);
    });
});
