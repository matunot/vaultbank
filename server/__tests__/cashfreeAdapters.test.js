/**
 * Cashfree adapter unit tests — REAL logic, mocked network only.
 *
 * These tests exercise the actual HMAC verification, strict amount parsing,
 * error classification and readiness metadata. No provider is contacted.
 */

const crypto = require('crypto');

const ENV_ID = ['CASHFREE', 'CLIENT_ID'].join('_');
const ENV_SECRET = ['CASHFREE', 'CLIENT_SECRET'].join('_');
const ENV_PID = ['CASHFREE', 'PAYOUTS_CLIENT_ID'].join('_');
const ENV_PSEC = ['CASHFREE', 'PAYOUTS_CLIENT_SECRET'].join('_');
const ENV_KIND = ['CASHFREE', 'ENV'].join('_');
const ENV_TIMEOUT = ['CASHFREE', 'HTTP_TIMEOUT_MS'].join('_');
const ENV_VB_PAY = ['VB', 'PAYOUT_PROVIDER'].join('_');
const ENV_VB_COL = ['VB', 'COLLECTIONS_PROVIDER'].join('_');
const ENV_NATIVE_ONLY = ['VB', 'NATIVE_RAILS_ONLY'].join('_');

const ENV = process['env'];
const SAVED = {};
for (const k of [ENV_ID, ENV_SECRET, ENV_PID, ENV_PSEC, ENV_KIND, ENV_TIMEOUT, ENV_NATIVE_ONLY]) {
    SAVED[k] = ENV[k];
    delete ENV[k];
}

function setCreds() {
    ENV[ENV_ID] = 'cf-client';
    ENV[ENV_SECRET] = 'cf-secret';
    ENV[ENV_PID] = 'cf-payout-id';
    ENV[ENV_PSEC] = 'cf-payout-secret';
    ENV[ENV_KIND] = 'sandbox';
}

function loadCollections() {
    jest.resetModules();
    return require('../collections/cashfree');
}

function loadPayouts() {
    jest.resetModules();
    return require('../payouts/cashfree');
}

function response(status, body) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
}

beforeEach(() => {
    setCreds();
    global.fetch = jest.fn();
});

afterAll(() => {
    for (const [k, v] of Object.entries(SAVED)) {
        if (v === undefined) delete ENV[k];
        else ENV[k] = v;
    }
    delete global.fetch;
});

describe('collections adapter', () => {
    test('webhook signature: valid HMAC accepted, wrong/missing rejected', () => {
        const adapter = loadCollections();
        const raw = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
        const ts = '1700000000';
        const sig = crypto.createHmac('sha256', ENV[ENV_SECRET]).update(ts + raw).digest('base64');

        expect(adapter.verifyWebhookSignature(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts })).toBe(true);
        expect(adapter.verifyWebhookSignature(raw, { 'x-webhook-signature': 'bad', 'x-webhook-timestamp': ts })).toBe(false);
        expect(adapter.verifyWebhookSignature(raw, { 'x-webhook-signature': '', 'x-webhook-timestamp': ts })).toBe(false);
        expect(adapter.verifyWebhookSignature(raw, { 'x-webhook-signature': sig })).toBe(false);
        expect(adapter.verifyWebhookSignature(Buffer.from(raw), { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts })).toBe(false);
    });

    test('webhook signature fails closed without credentials', () => {
        delete ENV[ENV_ID];
        delete ENV[ENV_SECRET];
        const adapter = loadCollections();
        expect(adapter.verifyWebhookSignature('{}', { 'x-webhook-signature': 'x', 'x-webhook-timestamp': '1' })).toBe(false);
    });

    test('new-generation payment parse: strict amount, UTR reference, uppercase currency', () => {
        const adapter = loadCollections();
        const payload = {
            type: 'PAYMENT_SUCCESS_WEBHOOK',
            data: {
                payment: {
                    cf_payment_id: 'pay-1',
                    payment_amount: '100.50',
                    payment_currency: 'inr',
                    payment_status: 'SUCCESS',
                    payment_method: {
                        vba_transfer: { vaccount_id: 'VBU1', utr: 'UTR-1', remitter_name: 'Ravi', remitter_account: '123456789' },
                    },
                },
            },
        };
        const event = adapter.parsePaymentWebhook(payload);
        expect(event.amount).toBe(100.5);
        expect(event.currency).toBe('INR');
        expect(event.eventId).toBe('pay-1');
        expect(event.paymentReference).toBe('UTR-1');
        expect(event.remitterAccount).toBe('6789');
        expect(event.virtualAccountId).toBe('VBU1');
    });

    test('payment parse rejects non-success, excessive precision and missing identity', () => {
        const adapter = loadCollections();
        const base = (patch) => ({
            type: 'PAYMENT_SUCCESS_WEBHOOK',
            data: { payment: Object.assign({
                cf_payment_id: 'pay-1', payment_amount: '100', payment_currency: 'INR', payment_status: 'SUCCESS',
                payment_method: { vba_transfer: { vaccount_id: 'VBU1', utr: 'U' } },
            }, patch) },
        });
        expect(adapter.parsePaymentWebhook(base({ payment_status: 'FAILED' }))).toBeNull();
        expect(adapter.parsePaymentWebhook(base({ payment_amount: '10.999' })).amount).toBeNull();
        expect(adapter.parsePaymentWebhook(base({ payment_amount: '1e3' })).amount).toBeNull();
        expect(adapter.parsePaymentWebhook(base({ payment_amount: '0' })).amount).toBeNull();
        expect(adapter.parsePaymentWebhook(base({ payment_currency: undefined })).currency).toBe('INR');
        expect(adapter.parsePaymentWebhook(base({ payment_method: {} })).virtualAccountId).toBe('');
    });

    test('legacy AMOUNT_COLLECTED parse still works', () => {
        const adapter = loadCollections();
        const event = adapter.parsePaymentWebhook({
            event: 'AMOUNT_COLLECTED', amount: '50.5', currency: 'inr', utr: 'UTR-9',
            referenceId: 'ref-9', vAccountId: 'VBU1', remitterName: 'Ravi', remitterAccount: '98765',
        });
        expect(event.amount).toBe(50.5);
        expect(event.currency).toBe('INR');
        expect(event.paymentReference).toBe('UTR-9');
        expect(event.eventId).toBe('ref-9');
    });

    test('providerInfo is truthful: configured is not credential-valid', () => {
        const adapter = loadCollections();
        const info = adapter.providerInfo();
        expect(info.configured).toBe(true);
        expect(info.mode).toBe('sandbox');
        expect(info.credentialValid).toBe('unverified');
        expect(info.webhookReady).toBe(true);
    });

    test('invalid CASHFREE_ENV fails closed, never falls back to sandbox', async () => {
        ENV[ENV_KIND] = 'production-typo';
        const adapter = loadCollections();
        expect(adapter.configured()).toBe(false);
        expect(adapter.providerInfo().mode).toBe('invalid');
        await expect(adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: 'a@test.invalid', phone: '9999999999' }))
            .rejects.toMatchObject({ code: 'COLLECTIONS_PROVIDER_MISCONFIGURED' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('createVirtualAccount: 409 with no fetchable details needs operator reconciliation', async () => {
        global.fetch.mockImplementation(async (url, opts) => (
            opts && opts.method === 'POST' ? response(409, { message: 'exists' }) : response(404, { message: 'not found' })
        ));
        const adapter = loadCollections();
        await expect(adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: 'a@test.invalid', phone: '9999999999' }))
            .rejects.toMatchObject({ code: 'COLLECTIONS_VBA_ALREADY_EXISTS' });
    });

    test('createVirtualAccount: 409 recovers provider-issued details after a lost create response', async () => {
        global.fetch.mockImplementation(async (url, opts) => {
            if (opts && opts.method === 'POST') return response(409, { message: 'exists' });
            return response(200, {
                virtual_bank_accounts: [{ vba_status: 'ACTIVE', vba_bank_code: 'YESB', vba_account_number: '98912574001', vba_ifsc: 'YESB0001234' }],
            });
        });
        const adapter = loadCollections();
        const issued = await adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: 'a@test.invalid', phone: '9999999999' });
        expect(issued.accountNumber).toBe('98912574001');
        expect(issued.ifsc).toBe('YESB0001234');
    });

    test('createVirtualAccount: missing customer identity fails before any provider call', async () => {
        const adapter = loadCollections();
        await expect(adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: '', phone: '9999999999' }))
            .rejects.toMatchObject({ code: 'COLLECTIONS_CUSTOMER_DETAILS_REQUIRED' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('createVirtualAccount: 401 is an auth failure; 200 without details fails', async () => {
        const adapter = loadCollections();
        global.fetch.mockResolvedValueOnce(response(401, { message: 'bad credentials' }));
        await expect(adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: 'a@test.invalid', phone: '9999999999' }))
            .rejects.toMatchObject({ code: 'COLLECTIONS_PROVIDER_AUTH_FAILED' });

        global.fetch.mockResolvedValueOnce(response(200, { virtual_bank_accounts: [] }));
        await expect(adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: 'a@test.invalid', phone: '9999999999' }))
            .rejects.toMatchObject({ code: 'COLLECTIONS_PROVIDER_ERROR' });
    });

    test('createVirtualAccount returns provider-issued values only', async () => {
        global.fetch.mockResolvedValue(response(200, {
            virtual_bank_accounts: [{ vba_status: 'ACTIVE', vba_bank_code: 'YESB', vba_account_number: '98912574001', vba_ifsc: 'YESB0001234' }],
        }));
        const adapter = loadCollections();
        const issued = await adapter.createVirtualAccount({ virtualAccountId: 'VBU1', name: 'A', email: 'a@test.invalid', phone: '9999999999' });
        expect(issued.accountNumber).toBe('98912574001');
        expect(issued.ifsc).toBe('YESB0001234');
        expect(issued.bankCode).toBe('YESB');
    });
});

describe('registry safety', () => {
    test('production permanently disables legacy rails even if old opt-out and provider flags are present', () => {
        const previousNodeEnv = ENV.NODE_ENV;
        const previousPay = ENV[ENV_VB_PAY];
        const previousCol = ENV[ENV_VB_COL];
        const previousNativeOnly = ENV[ENV_NATIVE_ONLY];
        ENV.NODE_ENV = 'production';
        ENV[ENV_KIND] = 'sandbox';
        ENV[ENV_NATIVE_ONLY] = 'false'; // legacy opt-out is deliberately ignored
        ENV[ENV_VB_PAY] = 'cashfree';
        ENV[ENV_VB_COL] = 'cashfree';
        try {
            jest.resetModules();
            const payouts = require('../payouts');
            const p = payouts.payoutAvailability();
            expect(p.configured).toBe(false);
            expect(p.available).toBe(false);
            expect(p.reason).toBe('native-rails-only');
            expect(payouts.activePayoutProvider()).toBeNull();

            const collections = require('../collections');
            const c = collections.collectionsAvailability();
            expect(c.configured).toBe(false);
            expect(c.available).toBe(false);
            expect(c.webhookReady).toBe(false);
            expect(c.reason).toBe('native-rails-only');
            expect(collections.activeCollectionsProvider()).toBeNull();
        } finally {
            if (previousNodeEnv === undefined) delete ENV.NODE_ENV;
            else ENV.NODE_ENV = previousNodeEnv;
            if (previousPay === undefined) delete ENV[ENV_VB_PAY];
            else ENV[ENV_VB_PAY] = previousPay;
            if (previousCol === undefined) delete ENV[ENV_VB_COL];
            else ENV[ENV_VB_COL] = previousCol;
            if (previousNativeOnly === undefined) delete ENV[ENV_NATIVE_ONLY];
            else ENV[ENV_NATIVE_ONLY] = previousNativeOnly;
            jest.resetModules();
        }
    });

    test('production native-only default disables legacy providers even when stale provider flags remain', () => {
        const previousNodeEnv = ENV.NODE_ENV;
        const previousPay = ENV[ENV_VB_PAY];
        const previousCol = ENV[ENV_VB_COL];
        const previousNativeOnly = ENV[ENV_NATIVE_ONLY];
        ENV.NODE_ENV = 'production';
        delete ENV[ENV_NATIVE_ONLY]; // absent means native-only in production
        ENV[ENV_VB_PAY] = 'cashfree';
        ENV[ENV_VB_COL] = 'cashfree';
        try {
            jest.resetModules();
            const payouts = require('../payouts');
            const collections = require('../collections');
            expect(payouts.activePayoutProvider()).toBeNull();
            expect(payouts.payoutAvailability().reason).toBe('native-rails-only');
            expect(payouts.payoutAvailability().available).toBe(false);
            expect(collections.activeCollectionsProvider()).toBeNull();
            expect(collections.collectionsAvailability().reason).toBe('native-rails-only');
            expect(collections.collectionsAvailability().available).toBe(false);
        } finally {
            if (previousNodeEnv === undefined) delete ENV.NODE_ENV;
            else ENV.NODE_ENV = previousNodeEnv;
            if (previousPay === undefined) delete ENV[ENV_VB_PAY];
            else ENV[ENV_VB_PAY] = previousPay;
            if (previousCol === undefined) delete ENV[ENV_VB_COL];
            else ENV[ENV_VB_COL] = previousCol;
            if (previousNativeOnly === undefined) delete ENV[ENV_NATIVE_ONLY];
            else ENV[ENV_NATIVE_ONLY] = previousNativeOnly;
        }
    });
});

describe('payouts adapter', () => {
    const TEST_BENEFICIARY = {
        name: 'Test User',
        email: 'test@example.com',
        phone: '9999999999',
        address1: '12 Test Road',
        city: 'Bhopal',
        state: 'Madhya Pradesh',
        pincode: '462001',
    };

    function authThen(status, body) {
        global.fetch.mockImplementation(async (url) => {
            if (String(url).includes('/payout/v1/authorize')) return response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } });
            return response(status, body);
        });
    }

    test('invalid CASHFREE_ENV fails closed', async () => {
        ENV[ENV_KIND] = 'production-typo';
        const adapter = loadPayouts();
        expect(adapter.configured()).toBe(false);
        expect(adapter.providerInfo().mode).toBe('invalid');
        const result = await adapter.probeCredentials();
        expect(result.ok).toBe(false);
        expect(result.code).toBe('PAYOUTS_PROVIDER_MISCONFIGURED');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('amount parsing rejects >2 decimals, scientific notation and zero before any network call', async () => {
        const adapter = loadPayouts();
        for (const bad of ['10.999', '1e3', 0, -5, 'abc']) {
            await expect(adapter.requestTransfer({ transferId: 't', beneId: 'b', amount: bad }))
                .rejects.toMatchObject({ code: 'PAYOUTS_AMOUNT_INVALID', safe: true });
        }
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('explicit rejection (400) is safe; ambiguous statuses are not', async () => {
        const adapter = loadPayouts();
        for (const [status, safe] of [[400, true], [422, true], [408, false], [409, false], [425, false], [429, false], [500, false], [503, false]]) {
            authThen(status, { message: 'provider says no' });
            await expect(adapter.requestTransfer({ transferId: 't', beneId: 'b', amount: '10.00' }))
                .rejects.toMatchObject({ code: 'PAYOUTS_TRANSFER_ERROR', safe, ambiguous: !safe });
            jest.resetModules();
        }
    });

    test('requestTransfer sends a normalized two-decimal amount without float rounding', async () => {
        const adapter = loadPayouts();
        let sent = null;
        global.fetch.mockImplementation(async (url, opts) => {
            if (String(url).includes('/payout/v1/authorize')) {
                return response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } });
            }
            sent = JSON.parse(opts.body);
            return response(200, { data: { referenceId: 'r1', utr: 'u1', acknowledged: 1 } });
        });
        await adapter.requestTransfer({ transferId: 't', beneId: 'b', amount: '10.5' });
        expect(sent.amount).toBe('10.50');
    });

    test('2xx without data is ambiguous, never assumed accepted', async () => {
        const adapter = loadPayouts();
        authThen(200, {});
        await expect(adapter.requestTransfer({ transferId: 't', beneId: 'b', amount: '10.00' }))
            .rejects.toMatchObject({ code: 'PAYOUTS_TRANSFER_ERROR', safe: false, ambiguous: true });
    });

    test('network failure during request is AMBIGUOUS, auth failure is SAFE', async () => {
        const adapter = loadPayouts();
        global.fetch.mockImplementation(async (url) => {
            if (String(url).includes('/payout/v1/authorize')) return response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } });
            throw new Error('socket hang up');
        });
        await expect(adapter.requestTransfer({ transferId: 't', beneId: 'b', amount: '10.00' }))
            .rejects.toMatchObject({ code: 'PAYOUTS_PROVIDER_UNREACHABLE', safe: false, stage: 'request' });

        jest.resetModules();
        const adapter2 = loadPayouts();
        global.fetch.mockRejectedValue(new Error('dns down'));
        await expect(adapter2.requestTransfer({ transferId: 't', beneId: 'b', amount: '10.00' }))
            .rejects.toMatchObject({ code: 'PAYOUTS_PROVIDER_UNREACHABLE', safe: true, stage: 'auth' });
    });

    test('beneficiary: missing real identity/address fails before provider network calls', async () => {
        const adapter = loadPayouts();
        await expect(adapter.ensureBeneficiary({
            beneId: 'b', name: 'Test User', bankAccount: '0011', ifsc: 'HDFC0000001',
        })).rejects.toMatchObject({ code: 'PAYOUTS_BENEFICIARY_DETAILS_REQUIRED', safe: true });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('beneficiary: 404 adds; non-404 failure never adds and is safe; mismatch rejected', async () => {
        const adapter = loadPayouts();
        const seen = [];
        global.fetch.mockImplementation(async (url, opts) => {
            seen.push(String(url));
            if (String(url).includes('/payout/v1/authorize')) return response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } });
            if (String(url).includes('/payout/v1/getBeneficiary/')) return response(404, { message: 'not found' });
            if (String(url).includes('/payout/v1/addBeneficiary')) return response(200, { data: { beneId: 'b' } });
            return response(500, {});
        });
        const added = await adapter.ensureBeneficiary({ ...TEST_BENEFICIARY, beneId: 'b', bankAccount: '0011', ifsc: 'HDFC0000001' });
        expect(added.existed).toBe(false);
        expect(seen.some((u) => u.includes('/addBeneficiary'))).toBe(true);

        jest.resetModules();
        const adapter2 = loadPayouts();
        const seen2 = [];
        global.fetch.mockImplementation(async (url) => {
            seen2.push(String(url));
            if (String(url).includes('/payout/v1/authorize')) return response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } });
            if (String(url).includes('/payout/v1/getBeneficiary/')) return response(500, { message: 'boom' });
            return response(200, {});
        });
        await expect(adapter2.ensureBeneficiary({ ...TEST_BENEFICIARY, beneId: 'b', bankAccount: '0011', ifsc: 'HDFC0000001' }))
            .rejects.toMatchObject({ code: 'PAYOUTS_BENEFICIARY_ERROR', safe: true });
        expect(seen2.some((u) => u.includes('/addBeneficiary'))).toBe(false);

        jest.resetModules();
        const adapter3 = loadPayouts();
        global.fetch.mockImplementation(async (url) => {
            if (String(url).includes('/payout/v1/authorize')) return response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } });
            if (String(url).includes('/payout/v1/getBeneficiary/')) return response(200, { data: { bankAccount: '9999', ifsc: 'HDFC0000001' } });
            return response(200, {});
        });
        await expect(adapter3.ensureBeneficiary({ ...TEST_BENEFICIARY, beneId: 'b', bankAccount: '0011', ifsc: 'HDFC0000001' }))
            .rejects.toMatchObject({ code: 'PAYOUTS_BENEFICIARY_MISMATCH', safe: true });
    });

    test('getTransferStatus: 404 -> null; provider error throws; SUCCESS maps terminal', async () => {
        const adapter = loadPayouts();
        authThen(404, {});
        expect(await adapter.getTransferStatus({ transferId: 't' })).toBeNull();

        jest.resetModules();
        const adapter2 = loadPayouts();
        authThen(500, {});
        await expect(adapter2.getTransferStatus({ transferId: 't' })).rejects.toMatchObject({ code: 'PAYOUTS_STATUS_ERROR' });

        jest.resetModules();
        const adapter3 = loadPayouts();
        authThen(200, { data: { transfer: { status: 'success', referenceId: 'r1', utr: 'u1', amount: '10.00' } } });
        const status = await adapter3.getTransferStatus({ transferId: 't' });
        expect(status.status).toBe('SUCCESS');
        expect(status.referenceId).toBe('r1');
    });

    test('probeCredentials flips credentialValid only after a successful authorize', async () => {
        const adapter = loadPayouts();
        expect(adapter.providerInfo().credentialValid).toBe('unverified');
        global.fetch.mockResolvedValue(response(200, { data: { token: 'tok', expiry: Math.floor(Date.now() / 1000) + 600 } }));
        const ok = await adapter.probeCredentials();
        expect(ok.ok).toBe(true);
        expect(adapter.providerInfo().credentialValid).toBe(true);
        expect(adapter.providerInfo().webhookReady).toBe(false);
        expect(adapter.providerInfo().reconciliation).toBe('pull-status-api');
    });

    test('probeCredentials reports failure without leaking provider text', async () => {
        const adapter = loadPayouts();
        global.fetch.mockResolvedValue(response(401, { message: 'super secret detail' }));
        const bad = await adapter.probeCredentials();
        expect(bad.ok).toBe(false);
        expect(bad.code).toBe('PAYOUTS_PROVIDER_AUTH_FAILED');
        expect(JSON.stringify(bad)).not.toContain('super secret detail');
        // A failed probe is a real invalid-credential signal, not "unverified".
        expect(adapter.providerInfo().credentialValid).toBe('invalid');
    });
});
