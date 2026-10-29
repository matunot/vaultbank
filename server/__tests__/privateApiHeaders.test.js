const { privateApiHeaders } = require('../middleware/privateApiHeaders');

describe('private API response headers', () => {
  test('marks API responses as private and non-cacheable before continuing', () => {
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
    const next = jest.fn();
    privateApiHeaders({}, res, next);
    expect(res.headers).toEqual({
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
      Expires: '0',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
