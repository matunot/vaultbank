/**
 * VaultBank-owned direct UPI collection pilot.
 *
 * This rail does not call a payment processor. It builds a UPI intent/QR for
 * the bank-linked VPA configured by the VaultBank operator. Payment intents
 * remain pending until an administrator verifies the incoming credit against
 * the receiving bank's official statement. Browser returns, screenshots, SMS,
 * and email alerts are never accepted as settlement proof.
 *
 * Disabled by default and fail-closed unless a real VPA/payee name is configured.
 */
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const router = express.Router();
const { ensureVaultLedgerSchema, ensureCustomerLedgerAccount, changeVerifiedAvailableBalance, postBalancedJournal } = require('../services/ledgerJournalService');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { db, createNotification, createAuditLog } = require('../config/database');

const CURRENCY = 'INR';
const MIN_AMOUNT_PAISE = 100;
const MAX_AMOUNT_PAISE = 1000000; // Pilot cap: INR 10,000 per intent.
const MAX_OPEN_INTENTS = 3;
const EXPIRY_MINUTES = 30;
const VPA_RE = /^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$/;
const UTR_RE = /^[A-Za-z0-9/-]{6,80}$/;

// Customer access remains off unless the operator explicitly enables the pilot.
// Admins keep access for reconciliation. Non-admin customers must be verified.
function requireVerifiedCustomerOrAdmin(req, res, next) {
  if (req.user && ['admin', 'super_admin'].includes(req.user.role)) return next();
  if (process.env.VB_DIRECT_UPI_CUSTOMER_ACCESS_ENABLED !== 'true') {
    return res.status(403).json({
      success: false,
      code: 'DIRECT_UPI_CUSTOMER_ACCESS_DISABLED',
      message: 'Direct UPI is restricted to the authorized admin pilot.',
    });
  }
  if (!req.user || req.user.email_verified !== true || req.user.kyc_status !== 'verified') {
    return res.status(403).json({
      success: false,
      code: 'CUSTOMER_VERIFICATION_REQUIRED',
      message: 'Verify your email and complete identity verification before using Direct UPI.',
    });
  }
  return next();
}

let schemaReady = false;

function readiness() {
  const enabledFlag = process.env.VB_UPI_DEPOSIT_ENABLED === 'true';
  const vpa = String(process.env.VB_UPI_RECEIVING_VPA || '').trim();
  const payeeName = String(process.env.VB_UPI_RECEIVING_NAME || '').trim();
  const valid = VPA_RE.test(vpa) && payeeName.length >= 2 && payeeName.length <= 70;
  return {
    available: enabledFlag && valid,
    enabled: enabledFlag && valid,
    configured: valid,
    provider: 'vaultbank-direct-upi',
    mode: 'manual-bank-statement-verification',
    currency: CURRENCY,
    vpa: enabledFlag && valid ? vpa : null,
    payeeName: enabledFlag && valid ? payeeName : null,
    verification: 'manual-bank-statement',
    autoCredit: false,
    reason: !enabledFlag ? 'disabled-by-operator' : (!valid ? 'receiving-vpa-or-payee-not-configured' : 'configured-manual-verification'),
    minAmount: MIN_AMOUNT_PAISE / 100,
    maxAmount: MAX_AMOUNT_PAISE / 100,
    expiryMinutes: EXPIRY_MINUTES,
    maxOpenIntents: MAX_OPEN_INTENTS,
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await db.ensureConnection();
  await db.query(
    "CREATE TABLE IF NOT EXISTS direct_upi_deposit_intents (" +
    "id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), " +
    "user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, " +
    "account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, " +
    "reference TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL, " +
    "amount NUMERIC(15,2) NOT NULL CHECK (amount > 0), " +
    "currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'), " +
    "status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settling','settled','failed','cancelled','expired')), " +
    "bank_utr TEXT, evidence_note TEXT, verified_by_admin_id UUID REFERENCES users(id), " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, settled_at TIMESTAMPTZ)"
  );
  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS direct_upi_deposit_utr_uq " +
    "ON direct_upi_deposit_intents (bank_utr) WHERE bank_utr IS NOT NULL"
  );
  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS direct_upi_deposit_user_idempotency_uq " +
    "ON direct_upi_deposit_intents (user_id, idempotency_key)"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS direct_upi_deposit_user_created_idx " +
    "ON direct_upi_deposit_intents (user_id, created_at DESC)"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS direct_upi_deposit_pending_idx " +
    "ON direct_upi_deposit_intents (status, expires_at)"
  );
  schemaReady = true;
}

function parseAmountToPaise(value) {
  const input = typeof value === 'number' ? String(value) : String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return null;
  const parts = input.split('.');
  const whole = Number(parts[0]);
  const fraction = (parts[1] || '').padEnd(2, '0');
  const paise = whole * 100 + Number(fraction || '0');
  if (!Number.isSafeInteger(paise) || paise < MIN_AMOUNT_PAISE || paise > MAX_AMOUNT_PAISE) return null;
  return paise;
}

function toRupees(paise) {
  return (Number(paise) / 100).toFixed(2);
}

function makeReference() {
  return 'VB' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function makeUpiUri(cfg, amount, reference) {
  const params = new URLSearchParams({
    pa: cfg.vpa,
    pn: cfg.payeeName,
    am: amount,
    cu: CURRENCY,
    tn: reference,
  });
  return 'upi://pay?' + params.toString();
}

async function paymentPayload(intent, cfg) {
  const amount = Number(intent.amount).toFixed(2);
  const upiUri = makeUpiUri(cfg, amount, intent.reference);
  const qrDataUrl = await QRCode.toDataURL(upiUri, { errorCorrectionLevel: 'M', margin: 1, width: 320, type: 'image/png' });
  return {
    intent: serializeIntent(intent),
    transfer: {
      provider: cfg.provider,
      vpa: cfg.vpa,
      payeeName: cfg.payeeName,
      amount,
      currency: CURRENCY,
      reference: intent.reference,
      upiUri,
      qrDataUrl,
      note: 'Payment goes directly to the VaultBank operator-configured bank-linked UPI ID. This request does not credit your balance. Your balance changes only after an authorized administrator verifies the incoming credit on the receiving bank statement.',
      verification: 'manual-bank-statement',
    },
  };
}

function serializeIntent(row) {
  return {
    id: row.id,
    reference: row.reference,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    settledAt: row.settled_at || null,
    bankUtr: row.bank_utr || null,
  };
}

async function audit(userId, action, resourceId, details, req) {
  try {
    await createAuditLog({
      userId,
      action,
      resourceType: 'direct_upi_deposit_intent',
      resourceId,
      details,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (_) {
    // Telemetry failure must not reverse an already committed money path.
  }
}

async function sweepExpired() {
  await db.query(
    "UPDATE direct_upi_deposit_intents SET status = 'expired' WHERE status = 'pending' AND expires_at <= NOW()"
  );
}

router.get('/api/direct-upi/availability', (req, res) => {
  const status = readiness();
  res.status(200).json({
    success: true,
    available: status.available,
    provider: status.provider,
    currency: CURRENCY,
    verification: status.verification,
    autoCredit: false,
    minAmount: status.minAmount,
    maxAmount: status.maxAmount,
    reason: status.reason,
  });
});

router.get('/api/direct-upi/config', authenticateToken, requireVerifiedCustomerOrAdmin, (req, res) => {
  const status = readiness();
  res.status(200).json({
    success: true,
    enabled: status.available,
    provider: status.provider,
    currency: CURRENCY,
    vpa: status.vpa,
    payeeName: status.payeeName,
    verification: status.verification,
    autoCredit: false,
    minAmount: status.minAmount,
    maxAmount: status.maxAmount,
    expiryMinutes: status.expiryMinutes,
    maxOpenIntents: status.maxOpenIntents,
    reason: status.reason,
  });
});

router.post('/api/direct-upi/intents', authenticateToken, requireVerifiedCustomerOrAdmin, async (req, res) => {
  let idempotencyKey = '';
  let requestAmountPaise = null;
  let cfg = null;
  try {
    cfg = readiness();
    if (!cfg.available) {
      return res.status(503).json({
        success: false,
        code: 'DIRECT_UPI_NOT_CONFIGURED',
        message: 'VaultBank Direct UPI is disabled or its receiving VPA is not configured.',
        availability: { available: false, reason: cfg.reason },
      });
    }
    const amountPaise = parseAmountToPaise(req.body && req.body.amount);
    if (amountPaise == null) {
      return res.status(400).json({
        success: false,
        code: 'DIRECT_UPI_AMOUNT_INVALID',
        message: 'Amount must be INR 1.00 to INR 10,000.00 with at most two decimal places.',
      });
    }
    requestAmountPaise = amountPaise;
    idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
      return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'An Idempotency-Key header with 8-100 safe characters is required.' });
    }
    await ensureSchema();
    await sweepExpired();

    const existingResult = await db.query(
      'SELECT * FROM direct_upi_deposit_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
      [req.user.id, idempotencyKey]
    );
    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (parseAmountToPaise(existing.amount) !== amountPaise) {
        return res.status(409).json({ success: false, code: 'DIRECT_UPI_IDEMPOTENCY_MISMATCH', message: 'This request key was already used with a different amount. Generate a new intent key.' });
      }
      if (existing.status !== 'pending' || new Date(existing.expires_at).getTime() <= Date.now()) {
        return res.status(409).json({ success: false, code: 'DIRECT_UPI_INTENT_NOT_PENDING', message: 'This idempotent request already exists but is no longer pending. Create a new intent with a new key.' });
      }
      const payload = await paymentPayload(existing, cfg);
      return res.status(200).json({ success: true, idempotentReplay: true, ...payload });
    }

    const accountResult = await db.query(
      "SELECT id FROM accounts WHERE user_id = $1 AND currency = 'INR' AND status = 'active' ORDER BY created_at ASC LIMIT 1",
      [req.user.id]
    );
    if (accountResult.rows.length === 0) {
      return res.status(409).json({
        success: false,
        code: 'INR_ACCOUNT_REQUIRED',
        message: 'Open an INR VaultBank account before creating a UPI deposit intent.',
      });
    }
    const open = await db.query(
      "SELECT COUNT(*) AS open_count FROM direct_upi_deposit_intents WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()",
      [req.user.id]
    );
    if (Number(open.rows[0].open_count) >= MAX_OPEN_INTENTS) {
      return res.status(429).json({
        success: false,
        code: 'DIRECT_UPI_TOO_MANY_OPEN',
        message: 'You already have three open UPI deposit intents. Wait for expiry or cancel one.',
      });
    }

    const amount = toRupees(amountPaise);
    const reference = makeReference();
    const inserted = await db.query(
      "INSERT INTO direct_upi_deposit_intents (user_id, account_id, reference, idempotency_key, amount, currency, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'INR', NOW() + ($6 || ' minutes')::interval) RETURNING *",
      [req.user.id, accountResult.rows[0].id, reference, idempotencyKey, amount, String(EXPIRY_MINUTES)]
    );
    const intent = inserted.rows[0];
    await audit(req.user.id, 'direct_upi_intent_created', intent.id, { reference, amount, currency: CURRENCY }, req);
    const payload = await paymentPayload(intent, cfg);
    return res.status(201).json({ success: true, ...payload });
  } catch (error) {
    if (error && error.code === '23505' && idempotencyKey) {
      try {
        const existingResult = await db.query(
          'SELECT * FROM direct_upi_deposit_intents WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
          [req.user.id, idempotencyKey]
        );
        const existing = existingResult.rows[0];
        if (existing && requestAmountPaise != null && parseAmountToPaise(existing.amount) === requestAmountPaise && existing.status === 'pending' && new Date(existing.expires_at).getTime() > Date.now()) {
          const payload = await paymentPayload(existing, cfg);
          return res.status(200).json({ success: true, idempotentReplay: true, ...payload });
        }
        if (existing) return res.status(409).json({ success: false, code: 'DIRECT_UPI_IDEMPOTENCY_MISMATCH', message: 'This request key has already been used; no second intent was created.' });
      } catch (recoveryError) {
        console.error('Direct UPI idempotency recovery error:', recoveryError.message);
      }
    }
    console.error('Direct UPI intent error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not create a direct UPI deposit intent.' });
  }
});

router.get('/api/direct-upi/intents', authenticateToken, requireVerifiedCustomerOrAdmin, async (req, res) => {
  try {
    await ensureSchema();
    await sweepExpired();
    const result = await db.query(
      'SELECT * FROM direct_upi_deposit_intents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    return res.status(200).json({ success: true, intents: result.rows.map(serializeIntent) });
  } catch (error) {
    console.error('Direct UPI intent list error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load direct UPI deposit intents.' });
  }
});

router.post('/api/direct-upi/intents/:id/cancel', authenticateToken, requireVerifiedCustomerOrAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const result = await db.query(
      "UPDATE direct_upi_deposit_intents SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *",
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ success: false, code: 'DIRECT_UPI_INTENT_NOT_OPEN', message: 'This UPI intent is no longer pending.' });
    }
    await audit(req.user.id, 'direct_upi_intent_cancelled', result.rows[0].id, { reference: result.rows[0].reference }, req);
    return res.status(200).json({ success: true, intent: serializeIntent(result.rows[0]) });
  } catch (error) {
    console.error('Direct UPI cancel error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not cancel the UPI intent.' });
  }
});

router.get('/api/direct-upi/admin/intents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    await sweepExpired();
    const status = String(req.query.status || 'pending');
    const result = await db.query(
      "SELECT i.*, u.full_name, u.email " +
      "FROM direct_upi_deposit_intents i JOIN users u ON u.id = i.user_id " +
      "WHERE i.status = $1 ORDER BY i.created_at ASC LIMIT 100",
      [status]
    );
    return res.status(200).json({
      success: true,
      intents: result.rows.map((row) => Object.assign(serializeIntent(row), {
        customerName: row.full_name,
        customerEmail: row.email,
      })),
    });
  } catch (error) {
    console.error('Direct UPI admin queue error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the direct UPI review queue.' });
  }
});

router.post('/api/direct-upi/admin/intents/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
  const settlementAmountPaise = parseAmountToPaise(req.body && req.body.settlementAmount);
  const bankUtr = String((req.body && req.body.bankUtr) || '').trim();
  const evidenceNote = String((req.body && req.body.evidenceNote) || '').trim();
  if (settlementAmountPaise == null) {
    return res.status(400).json({ success: false, code: 'DIRECT_UPI_AMOUNT_INVALID', message: 'A valid INR settlement amount is required.' });
  }
  if (!UTR_RE.test(bankUtr)) {
    return res.status(400).json({ success: false, code: 'DIRECT_UPI_UTR_REQUIRED', message: 'Enter the bank transaction UTR/reference from the official bank statement.' });
  }
  if (evidenceNote.length < 10 || evidenceNote.length > 500) {
    return res.status(400).json({ success: false, code: 'DIRECT_UPI_EVIDENCE_REQUIRED', message: 'Evidence note must describe the matched bank statement line (10-500 characters).' });
  }

  let client;
  try {
    await ensureVaultLedgerSchema();
    await ensureSchema();
    client = await db.getClient();
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT * FROM direct_upi_deposit_intents WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const intent = result.rows[0];
    if (!intent) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'UPI deposit intent not found.' });
    }
    if (intent.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'DIRECT_UPI_INTENT_NOT_PENDING', message: 'Only pending intents can be verified; no additional credit was made.' });
    }
    if (new Date(intent.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE direct_upi_deposit_intents SET status = 'expired' WHERE id = $1", [intent.id]);
      await client.query('COMMIT');
      return res.status(409).json({ success: false, code: 'DIRECT_UPI_INTENT_EXPIRED', message: 'This intent expired; reconcile any actual bank credit manually before creating a new reviewed adjustment.' });
    }

    const expectedPaise = parseAmountToPaise(intent.amount);
    if (expectedPaise !== settlementAmountPaise) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: 'DIRECT_UPI_AMOUNT_MISMATCH',
        message: 'Statement amount must exactly match the intent amount. Do not auto-credit partial or excess payments; reconcile them separately.',
        expectedAmount: Number(intent.amount),
      });
    }

    try {
      await client.query(
        "UPDATE direct_upi_deposit_intents " +
        "SET status = 'settling', bank_utr = $2, evidence_note = $3, verified_by_admin_id = $4 " +
        "WHERE id = $1 AND status = 'pending'",
        [intent.id, bankUtr, evidenceNote, req.user.id]
      );
    } catch (error) {
      if (error && error.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, code: 'DIRECT_UPI_UTR_ALREADY_USED', message: 'This bank UTR has already been applied to another deposit intent.' });
      }
      throw error;
    }

    await ensureCustomerLedgerAccount(client, intent.account_id);
    await changeVerifiedAvailableBalance(client, intent.account_id, String(intent.amount), 'credit');
    const accountResult = await client.query(
      "UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 " +
      "WHERE id = $1 AND user_id = $3 AND currency = 'INR' AND status = 'active' " +
      "RETURNING (balance - $2) AS balance_before, balance AS balance_after",
      [intent.account_id, Number(intent.amount), intent.user_id]
    );
    if (accountResult.rows.length === 0) {
      const err = new Error('The target INR account is not active; no credit was made.');
      err.code = 'DIRECT_UPI_ACCOUNT_NOT_ACTIVE';
      throw err;
    }
    const balanceBefore = Number(accountResult.rows[0].balance_before);
    const balanceAfter = Number(accountResult.rows[0].balance_after);
    await client.query(
      "INSERT INTO transactions " +
      "(account_id, user_id, type, status, amount, currency, balance_before, balance_after, description, category, external_reference, metadata) " +
      "VALUES ($1, $2, 'deposit', 'completed', $3, 'INR', $4, $5, $6, 'income', $7, $8::jsonb)",
      [
        intent.account_id,
        intent.user_id,
        Number(intent.amount),
        balanceBefore,
        balanceAfter,
        'VaultBank Direct UPI deposit — reference ' + intent.reference,
        intent.reference,
        JSON.stringify({
          rail: 'vaultbank-direct-upi',
          manual_bank_statement_verification: true,
          verified_by_admin_id: req.user.id,
          bank_utr: bankUtr,
          intent_id: intent.id,
          evidence_note: evidenceNote,
        }),
      ]
    );
    await postBalancedJournal(client, {
      eventType: 'deposit_settled',
      sourceType: 'direct_upi_deposit',
      sourceId: String(intent.id),
      currency: 'INR',
      description: 'VaultBank Direct UPI deposit verified against the receiving bank statement',
      actorUserId: req.user.id,
      metadata: { reference: intent.reference, bankUtr, verification: 'manual-bank-statement' },
      entries: [
        { systemCode: 'INBOUND_SETTLEMENT_ASSET', side: 'debit', amount: String(intent.amount) },
        { accountId: intent.account_id, side: 'credit', amount: String(intent.amount) },
      ],
    });
    await client.query(
      "UPDATE direct_upi_deposit_intents SET status = 'settled', settled_at = NOW() WHERE id = $1 AND status = 'settling'",
      [intent.id]
    );
    await client.query('COMMIT');

    try {
      await createNotification(intent.user_id, {
        type: 'transaction',
        title: 'UPI deposit verified',
        message: 'INR ' + Number(intent.amount).toFixed(2) + ' was credited after bank-statement verification. Reference: ' + intent.reference,
      });
    } catch (_) {}
    await audit(req.user.id, 'direct_upi_deposit_verified', intent.id, {
      reference: intent.reference,
      amount: Number(intent.amount),
      bankUtr,
      intentUserId: intent.user_id,
    }, req);
    return res.status(200).json({
      success: true,
      credited: true,
      reference: intent.reference,
      bankUtr,
      amount: Number(intent.amount),
      balanceAfter,
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    if (error && error.code === '23505') {
      return res.status(409).json({ success: false, code: 'DIRECT_UPI_UTR_ALREADY_USED', message: 'This bank UTR has already been used; no additional credit was made.' });
    }
    if (error && error.code === 'DIRECT_UPI_ACCOUNT_NOT_ACTIVE') {
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    console.error('Direct UPI verification error:', error.message);
    return res.status(500).json({ success: false, message: 'UPI verification failed; the database transaction was rolled back.' });
  } finally {
    if (client) client.release();
  }
});

router.post('/api/direct-upi/admin/intents/:id/fail', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const note = String((req.body && req.body.note) || '').trim();
    if (note.length < 5 || note.length > 500) {
      return res.status(400).json({ success: false, code: 'DIRECT_UPI_REVIEW_NOTE_REQUIRED', message: 'Provide a review note (5-500 characters).' });
    }
    const result = await db.query(
      "UPDATE direct_upi_deposit_intents SET status = 'failed', evidence_note = $2, verified_by_admin_id = $3 WHERE id = $1 AND status = 'pending' RETURNING *",
      [req.params.id, note, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ success: false, code: 'DIRECT_UPI_INTENT_NOT_PENDING', message: 'Only pending intents can be marked failed.' });
    }
    await audit(req.user.id, 'direct_upi_intent_failed', result.rows[0].id, { reference: result.rows[0].reference, note }, req);
    return res.status(200).json({ success: true, intent: serializeIntent(result.rows[0]) });
  } catch (error) {
    console.error('Direct UPI failure review error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not close the UPI intent.' });
  }
});

module.exports = router;
module.exports.readiness = readiness;
module.exports.parseAmountToPaise = parseAmountToPaise;
module.exports.makeUpiUri = makeUpiUri;
