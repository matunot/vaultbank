'use strict';

const { createQuoteService, validateProviderQuote, assertMinorAmount, stableIdempotencyKey } = require('../services/lightsparkGrid/quotes');
const { buildAccountInfo } = require('../services/lightsparkGrid/accounts');
const { createPlatformService, CACHE_TTL_MS } = require('../services/lightsparkGrid/platform');

const CUSTOMER_ID = 'Customer:11111111-1111-1111-1111-111111111111';
const INTERNAL_ID = 'InternalAccount:22222222-2222-2222-2222-222222222222';
const EXTERNAL_ID = 'ExternalAccount:33333333-3333-3333-3333-333333333333';

function quoteResponse(overrides = {}) {
  return {
    id: 'Quote:44444444-4444-4444-4444-444444444444',
    status: 'PENDING',
    transactionId: 'Transaction:55555555-5555-5555-5555-555555555555',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    source: { sourceType: 'ACCOUNT', accountId: INTERNAL_ID },
    destination: { destinationType: 'ACCOUNT', accountId: EXTERNAL_ID },
    sendingCurrency: { code: 'USD', decimals: 2 },
    receivingCurrency: { code: 'EUR', decimals: 2 },
    totalSendingAmount: 10000,
    totalReceivingAmount: 9200,
    exchangeRate: 0.92,
    feesIncluded: 50,
    ...overrides,
  };
}

function fakeAccounts() {
  return {
    async getInternalAccount(userId, currency) {
      return { provider_account_id: INTERNAL_ID, currency, status: 'ACTIVE', user_id: userId };
    },
  };
}

function fakeData(providerQuote = quoteResponse()) {
  const saved = [];
  return {
    saved,
    async getBeneficiary(userId, id) {
      return { id, user_id: userId, provider_external_account_id: EXTERNAL_ID };
    },
    async saveQuote(row) {
      const stored = { ...row, id: row.id || 'quote-local' };
      saved.push(stored);
      return stored;
    },
    async getQuote(userId, id) {
      const found = saved.find((row) => row.id === id && row.user_id === userId);
      return found || null;
    },
  };
}

describe('Grid quote validation', () => {
  test('rejects non-integer and non-positive amounts', () => {
    expect(() => assertMinorAmount(0)).toThrow(/positive integer/);
    expect(() => assertMinorAmount(1.5)).toThrow(/positive integer/);
    expect(() => assertMinorAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow(/positive integer/);
  });

  test('rejects provider quotes using unsupported currency precision', () => {
    expect(() => validateProviderQuote(quoteResponse({
      receivingCurrency: { code: 'JPY', decimals: 0 },
    }))).toThrow(/precision/i);
  });

  test('rejects incomplete provider quotes', () => {
    expect(() => validateProviderQuote({ ...quoteResponse(), transactionId: undefined })).toThrow(/identifiers/);
  });

  test('idempotency keys are stable for identical quote requests', () => {
    const payload = { userId: 'u', amount: 1000, side: 'SENDING' };
    expect(stableIdempotencyKey('vb-grid-quote', payload))
      .toBe(stableIdempotencyKey('vb-grid-quote', payload));
  });
});

describe('Grid quote creation', () => {
  test('uses provider account ids and persists exact rates and fees', async () => {
    const bodySent = [];
    const client = {
      async request({ body }) { bodySent.push(body); return { data: quoteResponse() }; },
    };
    const data = fakeData();
    const service = createQuoteService({ client, accounts: fakeAccounts(), data });
    const quote = await service.createQuote({
      userId: 'user-1', beneficiaryId: 'bene-1', sendingCurrency: 'USD',
      sendingAmountMinor: 10000, lockedCurrencySide: 'SENDING',
    });
    expect(bodySent[0].source).toEqual({ sourceType: 'ACCOUNT', accountId: INTERNAL_ID });
    expect(bodySent[0].destination.accountId).toBe(EXTERNAL_ID);
    expect(bodySent[0].lockedCurrencyAmount).toBe(10000);
    expect(quote.exchangeRate).toBe('0.92');
    expect(quote.sendingAmountMinor).toBe(10000);
    expect(quote.receivingAmountMinor).toBe(9200);
  });

  test('refuses to execute an expired quote', async () => {
    const client = { request: jest.fn() };
    const data = fakeData();
    data.getQuote = async () => ({
      id: 'quote-local', user_id: 'user-1', provider_quote_id: 'Quote:1',
      expires_at: new Date(Date.now() - 1000).toISOString(), status: 'PENDING',
    });
    const service = createQuoteService({ client, accounts: fakeAccounts(), data });
    await expect(service.executeQuote({ userId: 'user-1', quoteId: 'quote-local', idempotencyKey: 'key-123456789' }))
      .rejects.toMatchObject({ code: 'GRID_QUOTE_EXPIRED' });
    expect(client.request).not.toHaveBeenCalled();
  });

  test('requires an idempotency key before executing', async () => {
    const client = { request: jest.fn() };
    const data = fakeData();
    data.getQuote = async () => ({
      id: 'quote-local', user_id: 'user-1', provider_quote_id: 'Quote:1',
      expires_at: new Date(Date.now() + 60000).toISOString(), status: 'PENDING',
    });
    const service = createQuoteService({ client, accounts: fakeAccounts(), data });
    await expect(service.executeQuote({ userId: 'user-1', quoteId: 'quote-local' }))
      .rejects.toMatchObject({ code: 'GRID_IDEMPOTENCY_REQUIRED' });
  });
});

describe('Grid beneficiary accountInfo validation', () => {
  test('accepts documented USD fields only', () => {
    const info = buildAccountInfo({
      accountType: 'USD_ACCOUNT', accountNumber: '1234567890', routingNumber: '021000021',
      bankAccountType: 'CHECKING', beneficiary: { fullName: 'Ada Lovelace', countryOfResidence: 'US' },
    });
    expect(info).toMatchObject({ accountType: 'USD_ACCOUNT', routingNumber: '021000021', bankAccountType: 'CHECKING' });
    expect(info.beneficiary).toEqual({ beneficiaryType: 'INDIVIDUAL', fullName: 'Ada Lovelace', countryOfResidence: 'US' });
  });

  test('rejects unsupported and malformed account types', () => {
    expect(() => buildAccountInfo({ accountType: 'DOGE_ACCOUNT' })).toThrow(/does not support/);
    expect(() => buildAccountInfo({
      accountType: 'USD_ACCOUNT', accountNumber: '1', routingNumber: '123',
      bankAccountType: 'CHECKING', beneficiary: { fullName: 'A' },
    })).toThrow(/routingNumber/);
    expect(() => buildAccountInfo({
      accountType: 'EUR_ACCOUNT', iban: 'invalid', beneficiary: { fullName: 'A' },
    })).toThrow(/IBAN/);
  });
});

describe('Provider-derived capabilities', () => {
  const config = {
    supportedCurrencies: [
      { currencyCode: 'USD', enabledTransactionTypes: ['OUTGOING', 'INCOMING'] },
      { currencyCode: 'EUR', enabledTransactionTypes: ['OUTGOING', 'INCOMING'] },
      { currencyCode: 'JPY', enabledTransactionTypes: ['OUTGOING'] },
    ],
  };
  test('excludes currencies whose ledger precision is not two decimals', () => {
    const rows = [
      { sourceCurrency: { code: 'USD', decimals: 2 }, destinationCurrency: { code: 'EUR', decimals: 2 } },
      { sourceCurrency: { code: 'USD', decimals: 2 }, destinationCurrency: { code: 'JPY', decimals: 0 } },
    ];
    const result = createPlatformService({ client: {} }).deriveCurrencyMeta(config, rows);
    expect(result.map((entry) => entry.code)).toEqual(['EUR', 'USD']);
  });

  test('caches provider responses within the TTL', async () => {
    const now = 1000000;
    const client = { request: jest.fn(async () => ({ data: { supportedCurrencies: [], data: [] } })) };
    const saved = [];
    const cache = {
      async getCapabilities() { return saved[0] || null; },
      async saveCapabilities(row) { saved.push({ ...row, fetched_at: new Date(now).toISOString() }); },
    };
    const service = createPlatformService({ client, cache, now: () => now });
    await service.getCapabilities();
    await service.getCapabilities();
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(CACHE_TTL_MS).toBeGreaterThan(0);
  });
});
