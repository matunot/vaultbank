/**
 * PayPal adapter unit tests — mock-mode round trip + webhook trust rules.
 *
 * No network: keys are unset so the adapter stays in mock mode, and
 * verifyWebhookSignature fails closed (false) without credentials.
 *
 * Run with: `cd server && npx jest __tests__/paypal.test.js`
 */

const paypal = require('../payments/paypal');

const SAVED = {};
for (const k of [
    'PAYMENT_PROVIDER_PAYPAL_CLIENT_ID',
    'PAYMENT_PROVIDER_PAYPAL_SECRET',
    'PAYPAL_WEBHOOK_ID',
]) {
    SAVED[k] = process.env[k];
    delete process.env[k];
}
afterAll(() => {
    for (const [k, v] of Object.entries(SAVED)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

describe('paypal adapter (mock mode)', () => {
    test('create → status → capture round trip', async () => {
        const created = await paypal.createPaymentIntent({
            amount: 25.5,
            currency: 'USD',
            description: 'Test deposit',
            userId: 'u1',
            returnUrl: 'https://app/?deposit=paypal-success',
            cancelUrl: 'https://app/?deposit=cancelled',
            customId: 'u1:a1',
        });
        expect(created.mock).toBe(true);
        expect(created.approvalUrl).toContain('sandbox.paypal.com');
        expect(created.amount).toBe(25.5);

        const st = await paypal.getStatus(created.providerId);
        expect(st.status).toBe('CREATED');

        const cap = await paypal.capturePayment(created.providerId);
        expect(cap.status).toBe('COMPLETED');
        expect(cap.captureId).toMatch(/^CAP_MOCK_/);
        expect(cap.mock).toBe(true);
    });

    test('capture of unknown order is not_found', async () => {
        const cap = await paypal.capturePayment('PAYPAL_MOCK_NOPE123');
        expect(cap.status).toBe('not_found');
    });

    test('getStatus of unknown order is not_found', async () => {
        const st = await paypal.getStatus('PAYPAL_MOCK_NOPE123');
        expect(st.status).toBe('not_found');
    });
});

describe('paypal webhook trust', () => {
    test('no webhook id configured → mock trust (dev only)', () => {
        const out = paypal.verifyWebhook({ body: { id: 'x', event_type: 'Y' } });
        expect(out.verified).toBe(true);
        expect(out.mock).toBe(true);
    });

    test('webhook id configured but event mismatches → rejected', () => {
        process.env.PAYPAL_WEBHOOK_ID = 'WH-REAL';
        const out = paypal.verifyWebhook({ body: { id: 'x', event_type: 'Y' } });
        expect(out.verified).toBe(false);
        delete process.env.PAYPAL_WEBHOOK_ID;
    });

    test('signature check fails closed without keys (no network)', async () => {
        const ok = await paypal.verifyWebhookSignature({
            transmissionId: 't',
            transmissionTime: 'now',
            certUrl: 'https://example.com',
            authAlgo: 'SHA256withRSA',
            transmissionSig: 'sig',
            webhookId: 'WH-x',
            event: { id: 'e' },
        });
        expect(ok).toBe(false);
    });

    test('access token is null without keys (no network)', async () => {
        const tok = await paypal.getAccessToken();
        expect(tok).toBeNull();
    });
});
