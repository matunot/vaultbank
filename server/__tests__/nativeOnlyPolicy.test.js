const { denyLegacyProviderRail } = require('../middleware/nativeOnlyPolicy');
const express = require('express');
const request = require('supertest');
// Load under Jest's test environment so auth's production fail-closed boot check is not triggered.
const issuingRouter = require('../routes/issuing');

function response() {
  const res = { statusCode: null, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

describe('VaultBank native-only provider policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test('allows legacy provider routes outside production for isolated development tests', () => {
    process.env.NODE_ENV = 'test';
    const res = response();
    expect(denyLegacyProviderRail(res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });


  test('production issuing guard does not block the SPA or unrelated native APIs', async () => {
    process.env.NODE_ENV = 'production';
    const app = express();

    app.use('/', issuingRouter);
    app.get('/', (_req, res) => res.status(200).send('<html><body>SPA shell</body></html>'));
    app.get('/api/payments/readiness', (_req, res) => res.status(200).json({ success: true }));

    const homepage = await request(app).get('/');
    expect(homepage.status).toBe(200);
    expect(homepage.text).toMatch(/<html>/);

    const nativeApi = await request(app).get('/api/payments/readiness');
    expect(nativeApi.status).toBe(200);

    const disabledIssuing = await request(app).get('/api/issuing/status');
    expect(disabledIssuing.status).toBe(503);
    expect(disabledIssuing.body).toMatchObject({ code: 'LEGACY_PROVIDER_RAIL_DISABLED' });
  });

  test('blocks provider routes in production with a stable 503 response', () => {
    process.env.NODE_ENV = 'production';
    const res = response();
    expect(denyLegacyProviderRail(res)).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'LEGACY_PROVIDER_RAIL_DISABLED',
    });
  });
});
