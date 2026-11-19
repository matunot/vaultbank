'use strict';

const crypto = require('node:crypto');
const database = require('../config/db');

let schemaReady = false;

function resendConfigured() {
  const value = String(process.env.RESEND_API_KEY || '').trim();
  return value.length > 0 && !/placeholder|your[_ -]?value|changeme/i.test(value);
}

// Kept for compatibility with any legacy diagnostics; email verification now uses
// Resend's HTTPS API because SMTP ports are not reachable from Render Free services.
function smtpConfigured() {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  return required.every((key) => {
    const value = String(process.env[key] || '').trim();
    return value.length > 0 && !/placeholder|your[_ -]?value|changeme/i.test(value);
  });
}

function publicAppUrl() {
  const configured = String(process.env.VAULTBANK_APP_URL || 'https://vaultbank-md20.onrender.com').trim();
  const parsed = new URL(configured);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Email verification base URL must use HTTP or HTTPS.');
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Email verification base URL must use HTTPS outside local development.');
  }
  return parsed.origin;
}

async function ensureSchema() {
  if (schemaReady) return;
  await database.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await database.query(`
    CREATE INDEX IF NOT EXISTS email_verification_tokens_user_open_idx
      ON email_verification_tokens (user_id, expires_at)
      WHERE consumed_at IS NULL
  `);
  schemaReady = true;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

async function invalidateToken(tokenHash) {
  try {
    await database.query(
      'UPDATE email_verification_tokens SET consumed_at = NOW() WHERE token_hash = $1 AND consumed_at IS NULL',
      [tokenHash]
    );
  } catch (_) {
    // The delivery error is the actionable failure; do not mask it with cleanup errors.
  }
}

async function sendVerificationForUser({ userId, email }) {
  if (!userId || !email) return { sent: false, reason: 'user-details-missing' };
  if (!resendConfigured()) return { sent: false, reason: 'resend-not-configured' };

  let baseUrl;
  try {
    baseUrl = publicAppUrl();
  } catch (error) {
    return { sent: false, reason: 'verification-url-invalid' };
  }

  await ensureSchema();

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const client = await database.getClient();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    // Serialize concurrent resend requests, so only the newest link remains valid.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [userId, 'email-verification']
    );
    await client.query(
      'DELETE FROM email_verification_tokens WHERE expires_at < NOW() - INTERVAL \'7 days\''
    );
    await client.query(
      'UPDATE email_verification_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL',
      [userId]
    );
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [userId, tokenHash]
    );
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw error;
  } finally {
    client.release();
  }

  const verifyUrl = new URL('/?verify-email=' + encodeURIComponent(token), baseUrl).toString();
  const from = String(
    process.env.EMAIL_FROM || process.env.SMTP_FROM || 'VaultBank <onboarding@resend.dev>'
  ).trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + String(process.env.RESEND_API_KEY).trim(),
        'Content-Type': 'application/json',
        'Idempotency-Key': 'vaultbank-email-verification-' + tokenHash,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Verify your VaultBank email',
        text: [
          'Verify your email address for VaultBank.',
          '',
          'Open this one-time link within 30 minutes:',
          verifyUrl,
          '',
          'If you did not create this account, you can ignore this message.',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      await invalidateToken(tokenHash);
      console.warn('VaultBank verification email delivery failed: RESEND_HTTP_' + response.status);
      return { sent: false, reason: 'delivery-failed' };
    }

    return { sent: true, expiresInMinutes: 30 };
  } catch (error) {
    await invalidateToken(tokenHash);
    const code = error && (error.code || error.name) ? (error.code || error.name) : 'delivery-failed';
    console.warn('VaultBank verification email delivery failed:', code);
    return { sent: false, reason: 'delivery-failed' };
  }
}

async function confirmEmailVerification(token) {
  const value = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(value)) {
    return { ok: false, reason: 'invalid-or-expired' };
  }

  await ensureSchema();
  const tokenHash = hashToken(value);
  const client = await database.getClient();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const found = await client.query(
      `SELECT user_id
         FROM email_verification_tokens
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
        FOR UPDATE`,
      [tokenHash]
    );
    const row = found.rows && found.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return { ok: false, reason: 'invalid-or-expired' };
    }

    const updated = await client.query(
      'UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING id',
      [row.user_id]
    );
    if (!updated.rows || updated.rows.length === 0) {
      throw new Error('User associated with the verification token no longer exists.');
    }
    await client.query(
      'UPDATE email_verification_tokens SET consumed_at = NOW() WHERE token_hash = $1 AND consumed_at IS NULL',
      [tokenHash]
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return { ok: true };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  resendConfigured,
  smtpConfigured,
  sendVerificationForUser,
  confirmEmailVerification,
};
