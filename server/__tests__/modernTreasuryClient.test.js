'use strict';

const modernTreasury = require('../services/modernTreasuryClient');

describe('Modern Treasury API client', () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    MODERN_TREASURY_ORGANIZATION_ID: process.env.MODERN_TREASURY_ORGANIZATION_ID,
    MODERN_TREASURY_API_KEY: process.env.MODERN_TREASURY_API_KEY,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv.MODERN_TREASURY_ORGANIZATION_ID === undefined) delete process.env.MODERN_TREASURY_ORGANIZATION_ID;
    else process.env.MODERN_TREASURY_ORGANIZATION_ID = originalEnv.MODERN_TREASURY_ORGANIZATION_ID;
    if (originalEnv.MODERN_TREASURY_API_KEY === undefined) delete process.env.MODERN_TREASURY_API_KEY;
    else process.env.MODERN_TREASURY_API_KEY = originalEnv.MODERN_TREASURY_API_KEY;
  });

  test('uses HTTP Basic auth with organization ID and API key', async () => {
    process.env.MODERN_TREASURY_ORGANIZATION_ID = 'org-example';
    process.env.MODERN_TREASURY_API_KEY = 'secret-example';
    const calls = [];
    global.fetch = jest.fn(async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ping: 'pong' }) };
    });

    await modernTreasury.request('/ping');

    expect(calls[0].url).toBe('https://app.moderntreasury.com/api/ping');
    expect(calls[0].options.headers.Authorization).toBe(
      'Basic ' + Buffer.from('org-example:secret-example').toString('base64'),
    );
    expect(calls[0].options.method).toBe('GET');
  });

  test('refuses non-read-only methods', async () => {
    process.env.MODERN_TREASURY_ORGANIZATION_ID = 'org-example';
    process.env.MODERN_TREASURY_API_KEY = 'secret-example';
    await expect(modernTreasury.request('/payment_orders', { method: 'POST' }))
      .rejects.toMatchObject({ code: 'MODERN_TREASURY_READ_ONLY', status: 405 });
  });

  test('fails closed when credentials are missing', async () => {
    delete process.env.MODERN_TREASURY_ORGANIZATION_ID;
    delete process.env.MODERN_TREASURY_API_KEY;
    await expect(modernTreasury.request('/ping'))
      .rejects.toMatchObject({ code: 'MODERN_TREASURY_NOT_CONFIGURED', status: 503 });
  });

  test('maps invalid credentials to a safe error without exposing provider response', async () => {
    process.env.MODERN_TREASURY_ORGANIZATION_ID = 'org-example';
    process.env.MODERN_TREASURY_API_KEY = 'secret-example';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'sensitive provider detail' }),
    }));
    await expect(modernTreasury.request('/ping'))
      .rejects.toMatchObject({ code: 'MODERN_TREASURY_AUTH_FAILED', status: 401 });
  });
});
