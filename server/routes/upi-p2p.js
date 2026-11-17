/**
 * VaultTag: a private VaultBank directory alias that resolves to a user-
 * submitted real UPI VPA. It only creates discovery data for direct UPI
 * intents. VaultBank does not issue UPI IDs, authenticate the VPA owner,
 * initiate UPI payments, or verify settlement through this route.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { upiP2PLimiter } = require('../middleware/rateLimiter');
const { createAuditLog } = require('../config/database');

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
const VPA_RE = /^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$/;
const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'api', 'bank', 'help', 'official',
  'security', 'support', 'system', 'upi', 'vault', 'vaultbank',
]);

function serializeProfile(row) {
  if (!row) return null;
  return {
    handle: row.handle,
    vpa: row.vpa,
    payeeName: row.payee_name,
    isListed: row.is_listed === true,
    verification: 'user-submitted-not-bank-verified',
  };
}

function requireVerifiedEmail(req, res, next) {
  if (!req.user || req.user.email_verified !== true) {
    return res.status(403).json({
      success: false,
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: 'Verify your VaultBank email before creating or using a VaultTag.',
    });
  }
  return next();
}

function ensureDatabase(req, res) {
  if (db.isDemo) {
    res.status(503).json({
      success: false,
      code: 'PERSISTENT_DATABASE_REQUIRED',
      message: 'VaultTag needs the persistent VaultBank database. Demo mode cannot save routing profiles.',
    });
    return false;
  }
  return true;
}

router.get('/api/upi-p2p/profile', authenticateToken, requireVerifiedEmail, async (req, res) => {
  if (!ensureDatabase(req, res)) return;
  try {
    const result = await db.query(
      'SELECT handle, vpa, payee_name, is_listed FROM vb_upi_p2p_profiles WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    return res.status(200).json({ success: true, profile: serializeProfile(result.rows[0]) });
  } catch (error) {
    if (error && error.code === '42P01') {
      return res.status(503).json({
        success: false,
        code: 'VAULTTAG_SCHEMA_NOT_READY',
        message: 'VaultTag storage migration has not been applied yet.',
      });
    }
    console.error('[upi-p2p] profile read failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load your VaultTag profile.' });
  }
});

router.put('/api/upi-p2p/profile', authenticateToken, requireVerifiedEmail, upiP2PLimiter, async (req, res) => {
  if (!ensureDatabase(req, res)) return;
  const handle = String(req.body && req.body.handle || '').trim().toLowerCase();
  const vpa = String(req.body && req.body.vpa || '').trim();
  const payeeName = String(req.body && req.body.payeeName || '').trim().replace(/\s+/g, ' ');
  const isListed = !(req.body && req.body.isListed === false);

  if (!HANDLE_RE.test(handle) || RESERVED_HANDLES.has(handle)) {
    return res.status(400).json({
      success: false,
      code: 'VAULTTAG_INVALID',
      message: 'Choose a 3-24 character VaultTag using lowercase letters, numbers, dot, underscore or hyphen. Reserved names cannot be used.',
    });
  }
  if (!VPA_RE.test(vpa)) {
    return res.status(400).json({
      success: false,
      code: 'UPI_VPA_INVALID',
      message: 'Enter a valid UPI ID such as name@bank.',
    });
  }
  if (payeeName.length < 2 || payeeName.length > 70) {
    return res.status(400).json({
      success: false,
      code: 'PAYEE_NAME_INVALID',
      message: 'Enter the bank account holder name shown by your UPI provider (2-70 characters).',
    });
  }

  try {
    const result = await db.query(
      `INSERT INTO vb_upi_p2p_profiles (user_id, handle, vpa, payee_name, is_listed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET handle = EXCLUDED.handle,
           vpa = EXCLUDED.vpa,
           payee_name = EXCLUDED.payee_name,
           is_listed = EXCLUDED.is_listed,
           updated_at = NOW()
       RETURNING handle, vpa, payee_name, is_listed`,
      [req.user.id, handle, vpa, payeeName, isListed]
    );
    try {
      await createAuditLog({
        userId: req.user.id,
        action: 'upi_p2p_profile_updated',
        resourceType: 'upi_p2p_profile',
        resourceId: req.user.id,
        details: { handle, isListed },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.warn('[upi-p2p] profile audit log unavailable:', auditError.message);
    }
    return res.status(200).json({ success: true, profile: serializeProfile(result.rows[0]) });
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(409).json({
        success: false,
        code: 'VAULTTAG_TAKEN',
        message: 'That VaultTag is already in use. Choose a different one.',
      });
    }
    if (error && error.code === '42P01') {
      return res.status(503).json({
        success: false,
        code: 'VAULTTAG_SCHEMA_NOT_READY',
        message: 'VaultTag storage migration has not been applied yet.',
      });
    }
    console.error('[upi-p2p] profile update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save your VaultTag profile.' });
  }
});

router.post('/api/upi-p2p/resolve', authenticateToken, requireVerifiedEmail, upiP2PLimiter, async (req, res) => {
  if (!ensureDatabase(req, res)) return;
  const handle = String(req.body && req.body.handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return res.status(400).json({
      success: false,
      code: 'VAULTTAG_INVALID',
      message: 'Enter a valid VaultTag (3-24 characters).',
    });
  }
  try {
    const result = await db.query(
      'SELECT handle, vpa, payee_name, is_listed FROM vb_upi_p2p_profiles WHERE LOWER(handle) = $1 AND is_listed = TRUE LIMIT 1',
      [handle]
    );
    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: 'VAULTTAG_NOT_FOUND',
        message: 'No public VaultTag found. Ask the recipient to check their VaultTag spelling or share their UPI ID directly.',
      });
    }
    return res.status(200).json({
      success: true,
      profile: serializeProfile(result.rows[0]),
      message: 'This UPI ID and payee name were supplied by the VaultBank user. Confirm the beneficiary name shown in your UPI app before entering your UPI PIN.',
    });
  } catch (error) {
    if (error && error.code === '42P01') {
      return res.status(503).json({
        success: false,
        code: 'VAULTTAG_SCHEMA_NOT_READY',
        message: 'VaultTag storage migration has not been applied yet.',
      });
    }
    console.error('[upi-p2p] resolve failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not resolve that VaultTag.' });
  }
});

module.exports = router;
