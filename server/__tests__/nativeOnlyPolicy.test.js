const { denyLegacyProviderRail } = require('../middleware/nativeOnlyPolicy');

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
