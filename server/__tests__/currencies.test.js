/**
 * Currency registry + currency-scoped receiving configuration.
 *
 * These are unit tests: no database, no money. They pin the invariants that
 * make multi-currency safe:
 *   - a registered currency is not automatically an enabled currency,
 *   - enabling a currency never creates an exchange rate,
 *   - receiving details never cross currencies,
 *   - the public endpoint exposes capability only, never account details.
 */

const express = require('express');
const request = require('supertest');
const registry = require('../config/currencies');
const receiving = require('../services/bankReceivingConfig');

const ENV = process.env;
const KEYS = [
    'VB_MULTICURRENCY_ENABLED',
    'VB_BANK_DEPOSIT_ENABLED',
    'VB_BANK_RECEIVING_CURRENCY',
    'VB_BANK_RECEIVING_BANK_NAME',
    'VB_BANK_RECEIVING_HOLDER',
    'VB_BANK_RECEIVING_DETAILS',
    'VB_BANK_RECEIVING_AED_BANK_NAME',
    'VB_BANK_RECEIVING_AED_HOLDER',
    'VB_BANK_RECEIVING_AED_DETAILS',
    'VB_BANK_RECEIVING_GBP_BANK_NAME',
    'VB_BANK_RECEIVING_GBP_HOLDER',
    'VB_BANK_RECEIVING_GBP_DETAILS',
];
const SAVED = {};
beforeAll(() => {
    for (const key of KEYS) {
        SAVED[key] = ENV[key];
        delete ENV[key];
    }
});
afterAll(() => {
    for (const key of KEYS) {
        if (SAVED[key] === undefined) delete ENV[key];
        else ENV[key] = SAVED[key];
    }
});
afterEach(() => {
    for (const key of KEYS) delete ENV[key];
});

function configureAed() {
    ENV.VB_MULTICURRENCY_ENABLED = 'true';
    ENV.VB_BANK_DEPOSIT_ENABLED = 'true';
    ENV.VB_BANK_RECEIVING_AED_BANK_NAME = 'Emirates Test Bank';
    ENV.VB_BANK_RECEIVING_AED_HOLDER = 'VaultBank AED Test Holder';
    ENV.VB_BANK_RECEIVING_AED_DETAILS = 'AE070331234567890123456';
}

describe('currency registry', () => {
    test('registers a broad ISO set while enabling only funded currencies by default', () => {
        expect(registry.CODES).toEqual(expect.arrayContaining(['USD', 'INR', 'AED', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'NZD', 'CHF', 'HKD']));
        expect(registry.isCurrencyEnabled('USD')).toBe(true);
        expect(registry.isCurrencyEnabled('INR')).toBe(true);
        expect(registry.isCurrencyEnabled('AED')).toBe(false);
        expect(registry.enabledCurrencies()).toEqual(['USD', 'INR']);
    });

    test('multi-currency is an explicit operator switch, read at call time', () => {
        ENV.VB_MULTICURRENCY_ENABLED = 'true';
        expect(registry.isCurrencyEnabled('aed')).toBe(true);
        expect(registry.enabledCurrencies()).toEqual(expect.arrayContaining(['USD', 'INR', 'AED', 'GBP']));
        ENV.VB_MULTICURRENCY_ENABLED = 'false';
        expect(registry.isCurrencyEnabled('AED')).toBe(false);
    });

    test('denomination never implies conversion', () => {
        for (const entry of registry.describeCurrencies()) {
            expect(entry.fx).toBe(false);
            expect(entry.minorUnits).toBe(2);
        }
    });

    test('unknown and disabled currencies fail with distinct codes', () => {
        expect(() => registry.assertEnabledCurrency('XYZ')).toThrow(expect.objectContaining({ code: 'VB_CURRENCY_UNKNOWN' }));
        expect(() => registry.assertEnabledCurrency('AED')).toThrow(expect.objectContaining({ code: 'VB_CURRENCY_DISABLED' }));
        ENV.VB_MULTICURRENCY_ENABLED = 'true';
        expect(registry.assertEnabledCurrency('aed')).toBe('AED');
    });
});

describe('currency-scoped bank receiving configuration', () => {
    test('AED details are invisible while multi-currency is disabled', () => {
        configureAed();
        ENV.VB_MULTICURRENCY_ENABLED = 'false';
        const config = receiving.receivingConfig('AED');
        expect(config.enabled).toBe(false);
        expect(config.reason).toBe('currency-not-enabled');
        expect(config.bankName).toBeNull();
        expect(config.details).toBeNull();
    });

    test('AED becomes configurable only with the operator switch and complete details', () => {
        configureAed();
        const config = receiving.receivingConfig('AED');
        expect(config).toMatchObject({ enabled: true, currency: 'AED', verification: 'manual' });
        expect(config.bankName).toBe('Emirates Test Bank');
        expect(receiving.receivingCurrencies()).toEqual(['AED']);
    });

    test('partial AED configuration fails closed instead of impersonating another currency', () => {
        configureAed();
        delete ENV.VB_BANK_RECEIVING_AED_DETAILS;
        const config = receiving.receivingConfig('AED');
        expect(config.enabled).toBe(false);
        expect(config.reason).toBe('receiving-account-not-configured');
        expect(config.bankName).toBeNull();
        expect(config.holder).toBeNull();
    });

    test('legacy USD details can never answer an AED request', () => {
        ENV.VB_BANK_DEPOSIT_ENABLED = 'true';
        ENV.VB_BANK_RECEIVING_CURRENCY = 'USD';
        ENV.VB_BANK_RECEIVING_BANK_NAME = 'Legacy USD Bank';
        ENV.VB_BANK_RECEIVING_HOLDER = 'VaultBank USD Holder';
        ENV.VB_BANK_RECEIVING_DETAILS = 'USD-ACCOUNT-0001';
        const usd = receiving.receivingConfig('USD');
        expect(usd.enabled).toBe(true);
        expect(usd.details).toBe('USD-ACCOUNT-0001');
        const aed = receiving.receivingConfig('AED');
        expect(aed.enabled).toBe(false);
        expect(aed.details).toBeNull();
    });

    test('readiness status omits every account detail', () => {
        configureAed();
        for (const entry of receiving.receivingStatus()) {
            expect(Object.keys(entry).sort()).toEqual(['currency', 'enabled', 'reason', 'verification']);
        }
    });
});

describe('GET /api/currencies', () => {
    const app = express();
    app.use('/', require('../routes/currencies'));

    test('public payload reports capability, configuration and no bank details', async () => {
        configureAed();
        const res = await request(app).get('/api/currencies');
        expect(res.status).toBe(200);
        expect(res.body.fx).toBe(false);
        const aed = res.body.currencies.find((currency) => currency.code === 'AED');
        expect(aed).toMatchObject({ enabled: true, internalTransfers: true, bankReceivingConfigured: true, fx: false, manualPayout: false });
        const usd = res.body.currencies.find((currency) => currency.code === 'USD');
        expect(usd.bankReceivingConfigured).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('Emirates Test Bank');
        expect(JSON.stringify(res.body)).not.toContain('AE070331234567890123456');
    });

    test('default deployment advertises USD/INR only as enabled', async () => {
        const res = await request(app).get('/api/currencies');
        const enabled = res.body.currencies.filter((currency) => currency.enabled).map((currency) => currency.code);
        expect(enabled).toEqual(['USD', 'INR']);
        expect(res.body.currencies.filter((currency) => currency.bankReceivingConfigured)).toEqual([]);
    });
});
