'use strict';

const crypto = require('node:crypto');

jest.mock('../config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  isDemo: false,
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    if (!req.user) req.user = { id: 'user-1', email: 'person@example.test', email_verified: false };
    next();
  },
}));

jest.mock('../middleware/rateLimiter', () => ({
  authStrictLimiter: (_req, _res, next) => next(),
}));

const database = require('../config/db');
const nodemailer = require('nodemailer');
const service = require('../services/emailVerificationService');
const router = require('../routes/email-verification');

function responseMock() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

async function callRoute(path, method, options = {}) {
  const layer = router.stack.find((entry) =>
    entry.route && entry.route.path === path && entry.route.methods[method]
  );
  if (!layer) throw new Error('Route not found: ' + method.toUpperCase() + ' ' + path);
  const req = {
    method: method.toUpperCase(),
    user: { id: 'user-1', email: 'person@example.test', email_verified: false },
    ip: '127.0.0.1',
    headers: {},
    body: {},
    params: {},
    query: {},
    ...options,
  };
  const res = responseMock();
  for (const item of layer.route.stack) {
    let continued = false;
    await item.handle(req, res, () => { continued = true; });
    if (!continued) break;
  }
  return res;
}

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'VAULTBANK_APP_URL'];
const SAVED_ENV = {};

beforeAll(() => {
  for (const key of SMTP_KEYS) SAVED_ENV[key] = process.env[key];
});

afterAll(() => {
  for (const key of SMTP_KEYS) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key];
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of SMTP_KEYS) delete process.env[key];
  database.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('email verification delivery and endpoints', () => {
  test('does not create verification tokens when SMTP is not configured', async () => {
    const result = await service.sendVerificationForUser({
      userId: 'user-1',
      email: 'person@example.test',
      requestIp: '127.0.0.1',
    });

    expect(result).toEqual({ sent: false, reason: 'smtp-not-configured' });
    expect(database.query).not.toHaveBeenCalled();
    expect(database.getClient).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test('request endpoint fails closed and explains SMTP setup is missing', async () => {
    const res = await callRoute('/api/auth/email-verification/request', 'post');

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'EMAIL_VERIFICATION_UNAVAILABLE',
      reason: 'smtp-not-configured',
    });
  });

  test('confirm endpoint rejects malformed or expired links without DB access', async () => {
    const res = await callRoute('/api/auth/email-verification/confirm', 'post', {
      user: undefined,
      body: { token: 'not-a-verification-token' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('EMAIL_VERIFICATION_INVALID');
    expect(database.getClient).not.toHaveBeenCalled();
  });

  test('delivery stores only a token hash and sends a 30-minute one-time link', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'mailer@example.test';
    process.env.SMTP_PASS = 'test-password';
    process.env.VAULTBANK_APP_URL = 'https://vaultbank-md20.onrender.com';

    const client = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      release: jest.fn(),
    };
    database.getClient.mockResolvedValue(client);
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'email-1' });
    nodemailer.createTransport.mockReturnValue({ sendMail });

    const result = await service.sendVerificationForUser({
      userId: 'user-1',
      email: 'person@example.test',
      requestIp: '127.0.0.1',
    });

    expect(result).toMatchObject({ sent: true, expiresInMinutes: 30 });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO email_verification_tokens'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe('user-1');
    expect(insertCall[1][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertCall[1][1]).not.toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    expect(insertCall[2]).toBeUndefined();
    const sentText = sendMail.mock.calls[0][0].text;
    expect(sentText).toContain('verify-email=');
    expect(sentText).toContain('within 30 minutes');
    expect(client.release).toHaveBeenCalled();
  });

  test('confirmation atomically marks the user verified and consumes the token', async () => {
    const token = crypto.randomBytes(32).toString('base64url');
    const expectedHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    const client = {
      query: jest.fn(async (sql, params) => {
        const statement = String(sql);
        if (statement.includes('SELECT user_id') && statement.includes('email_verification_tokens')) {
          expect(params).toEqual([expectedHash]);
          return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
        }
        if (statement.includes('UPDATE users SET email_verified = TRUE')) {
          expect(params).toEqual(['user-1']);
          return { rows: [{ id: 'user-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    database.getClient.mockResolvedValue(client);

    // Prime schema readiness here only if the service has not already done so.
    const result = await service.confirmEmailVerification(token);

    expect(result).toEqual({ ok: true });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING id',
      ['user-1'],
    );
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE email_verification_tokens SET consumed_at = NOW() WHERE token_hash = $1 AND consumed_at IS NULL',
      [expectedHash],
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
