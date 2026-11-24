'use strict';

const { readConfig, describe: describeConfig } = require('../config/lightsparkGrid');
const { createGridClient } = require('../services/lightsparkGrid/client');

const KEY = 'a'.repeat(64);
function env(overrides = {}) {
  return {
    LIGHTSPARK_GRID_ENABLED: 'true',
    LIGHTSPARK_GRID_MODE: 'sandbox',
    LIGHTSPARK_GRID_CLIENT_ID: 'grid-client-id',
    LIGHTSPARK_GRID_CLIENT_SECRET: 'grid-client-secret',
    LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----',
    VB_LIGHTSPARK_GRID_ENCRYPTION_KEY: KEY,
    ...overrides,
  };
}

describe('Lightspark Grid configuration', () => {
  test('is inert unless explicitly enabled and fully configured', () => {
    expect(readConfig({}).enabled).toBe(false);
    expect(readConfig(env({ LIGHTSPARK_GRID_ENABLED: 'false' })).enabled).toBe(false);
    expect(readConfig(env({ LIGHTSPARK_GRID_CLIENT_SECRET: '' })).enabled).toBe(false);
    expect(readConfig(env({ VB_LIGHTSPARK_GRID_ENCRYPTION_KEY: 'short' })).enabled).toBe(false);
  });

  test('rejects unsafe base URLs and production without acknowledgement', () => {
    expect(readConfig(env({ LIGHTSPARK_GRID_API_BASE_URL: 'http://api.lightspark.com/grid/2025-10-13' })).enabled).toBe(false);
    expect(readConfig(env({ LIGHTSPARK_GRID_API_BASE_URL: 'https://evil.example.com' })).enabled).toBe(false);
    const prod = readConfig(env({ LIGHTSPARK_GRID_MODE: 'production' }));
    expect(prod.enabled).toBe(false);
    expect(prod.issues.join(' ')).toMatch(/ACKNOWLEDGED/);
    expect(readConfig(env({ LIGHTSPARK_GRID_MODE: 'production', LIGHTSPARK_GRID_PRODUCTION_ACKNOWLEDGED: 'true' })).enabled).toBe(true);
  });

  test('describe never leaks credentials', () => {
    const text = JSON.stringify(describeConfig(readConfig(env())));
    expect(text).not.toContain('grid-client-secret');
    expect(text).not.toContain(KEY);
    expect(text).toContain('credentialsPresent');
  });
});

describe('Lightspark Grid HTTP transport', () => {
  function response(body, status = 200) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => (name === 'x-request-id' ? 'grid-req-1' : null) },
      text: async () => JSON.stringify(body),
    };
  }

  test('uses Basic auth and forwards a stable idempotency key', async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return response({ id: 'ok' });
    });
    const client = createGridClient({ config: readConfig(env()), fetchImpl, sleep: async () => {} });
    const result = await client.request({
      method: 'POST', path: '/quotes', body: { hello: 'world' }, idempotencyKey: 'stable-key',
    });
    expect(result.data.id).toBe('ok');
    expect(calls[0].init.headers.Authorization).toBe('Basic ' + Buffer.from('grid-client-id:grid-client-secret').toString('base64'));
    expect(calls[0].init.headers['Idempotency-Key']).toBe('stable-key');
    expect(calls[0].init.redirect).toBe('manual');
  });

  test('retries safe GET requests on transient failures', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ code: 'BUSY' }, 503))
      .mockResolvedValueOnce(response({ data: [] }));
    const client = createGridClient({ config: readConfig(env()), fetchImpl, sleep: async () => {} });
    const result = await client.request({ path: '/exchange-rates' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data.data).toEqual([]);
  });

  test('never blindly retries a POST without an idempotency key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ code: 'BUSY' }, 503));
    const client = createGridClient({ config: readConfig(env()), fetchImpl, sleep: async () => {} });
    await expect(client.request({ method: 'POST', path: '/quotes', body: {} })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('classifies a timeout as ambiguous', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const client = createGridClient({
      config: readConfig(env()),
      fetchImpl: jest.fn().mockRejectedValue(timeout),
      sleep: async () => {},
    });
    await expect(client.request({ path: '/config' })).rejects.toMatchObject({
      code: 'GRID_REQUEST_TIMEOUT', ambiguous: true, retryable: true,
    });
  });

  test('does not log credentials or request bodies', async () => {
    const logs = [];
    const client = createGridClient({
      config: readConfig(env()),
      fetchImpl: jest.fn().mockResolvedValue(response({ ok: true })),
      logger: (entry) => logs.push(entry),
    });
    await client.request({ method: 'POST', path: '/quotes', body: { secret: 'do-not-log' }, idempotencyKey: 'k' });
    const text = JSON.stringify(logs);
    expect(text).not.toContain('grid-client-secret');
    expect(text).not.toContain('do-not-log');
  });

  test('rejects user-influenced paths', async () => {
    const client = createGridClient({ config: readConfig(env()), fetchImpl: jest.fn() });
    await expect(client.request({ path: '/../internal' })).rejects.toMatchObject({ code: 'GRID_INVALID_PATH' });
    await expect(client.request({ path: 'https://evil.example.com' })).rejects.toMatchObject({ code: 'GRID_INVALID_PATH' });
  });
});
