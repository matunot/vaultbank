const {
  CANONICAL_ORIGIN,
  normalizeOrigin,
  allowedProductionOrigins,
  isAllowedOrigin,
} = require('../middleware/corsPolicy');

describe('VaultBank CORS origin policy', () => {
  test('normalizes an origin and ignores URL paths', () => {
    expect(normalizeOrigin('https://custom.example.test/path?q=1')).toBe('https://custom.example.test');
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
  });

  test('production allows only canonical and explicitly configured origins', () => {
    const env = { NODE_ENV: 'production' };
    expect(isAllowedOrigin(CANONICAL_ORIGIN, env)).toBe(true);
    expect(isAllowedOrigin('https://attacker.example', env)).toBe(false);
    expect(isAllowedOrigin('https://vaultbank-md20.onrender.com.attacker.example', env)).toBe(false);
  });

  test('production can add a controlled custom origin via comma-separated configuration', () => {
    const env = {
      NODE_ENV: 'production',
      VB_CORS_ALLOWED_ORIGINS: 'https://custom.example.test/, https://preview.example.test',
    };
    const allowed = allowedProductionOrigins(env);
    expect(allowed.has('https://custom.example.test')).toBe(true);
    expect(isAllowedOrigin('https://preview.example.test', env)).toBe(true);
    expect(isAllowedOrigin('https://unapproved.example.test', env)).toBe(false);
  });

  test('does not break development origins or origin-less server-to-server requests', () => {
    expect(isAllowedOrigin('http://localhost:5173', { NODE_ENV: 'development' })).toBe(true);
    expect(isAllowedOrigin(undefined, { NODE_ENV: 'production' })).toBe(true);
  });
});
