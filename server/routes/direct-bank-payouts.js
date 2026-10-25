/**
 * VaultBank-owned manual bank payout rail.
 *
 * No payment processor or bank API is called. The user requests a payout,
 * funds are reserved atomically, and the bank transfer is initiated manually
 * by an authorized VaultBank operator through its bank's own interface.
 * The ledger is completed only after the operator matches the bank statement
 * and records the real UTR; refunds are allowed only after confirming no
 * transfer was sent. Disabled by default.
 *
 * Destination account numbers are AES-256-GCM encrypted at rest. The key must
 * be a 32-byte hex secret provided by the operator (not committed to Git).
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { db, findUserById, createNotification, createAuditLog } = require('../config/database');

const CURRENCY = 'INR';
const MIN_AMOUNT_PAISE = 1000; // INR 10.00
const MAX_AMOUNT_PAISE = 1000000; // INR 10,000.00 pilot cap.
const ACCOUNT_RE = /^[0-9]{6,20}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UTR_RE = /^[A-Za-z0-9/-]{6,80}$/;
let tablesReady = false;

function getEncryptionKey() {
  const keyHex = String(process.env.VB_DIRECT_PAYOUT_ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return null;
  return Buffer.from(keyHex, 'hex');
}

function readiness() {
  const enabledFlag = process.env.VB_DIRECT_BANK_PAYOUTS_ENABLED === 'true';
  const encryptionKeyReady = !!getEncryptionKey();
  return {
    available: enabledFlag && encryptionKeyReady,
    enabled: enabledFlag && encryptionKeyReady,
    provider: 'vaultbank-manual-bank-payout',
    mode: 'manual-bank-transfer',
    currency: CURRENCY,
    autoTransfer: false,
    encryptionKeyReady,
    reason: !enabledFlag ? 'disabled-by-operator' : (!encryptionKeyReady ? 'destination-encryption-key-missing-or-invalid' : 'configured-manual-bank-transfer'),
    minAmount: MIN_AMOUNT_PAISE / 100,
    maxAmount: MAX_AMOUNT_PAISE / 100,
  };
}

async function ensureTables() {
  if (tablesReady) return;
  await db.ensureConnection();
  await db.query(
    "CREATE TABLE IF NOT EXISTS direct_bank_payout_requests (" +
    "id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), " +
    "user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, " +
    "account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, " +
    "request_reference TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL, " +
    "amount NUMERIC(15,2) NOT NULL CHECK (amount > 0), currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'), " +
    "beneficiary_name TEXT NOT NULL, destination_account_encrypted TEXT NOT NULL, " +
    "destination_fingerprint TEXT NOT NULL, destination_account_masked TEXT NOT NULL, destination_ifsc TEXT NOT NULL, " +
    "status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','succeeded','failed_refunded')), " +
    "bank_utr TEXT, evidence_note TEXT, verified_by_admin_id UUID REFERENCES users(id), " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)"
  );
  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS direct_bank_payout_user_idempotency_uq " +
    "ON direct_bank_payout_requests (user_id, idempotency_key)"
  );
  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS direct_bank_payout_utr_uq " +
    "ON direct_bank_payout_requests (bank_utr) WHERE bank_utr IS NOT NULL"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS direct_bank_payout_user_created_idx " +
    "ON direct_bank_payout_requests (user_id, created_at DESC)"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS direct_bank_payout_status_created_idx " +
    "ON direct_bank_payout_requests (status, created_at)"
  );
  const { rows } = await db.query(
    "SELECT COALESCE((SELECT indisunique FROM pg_index WHERE indexrelid = to_regclass('public.direct_bank_payout_user_idempotency_uq')), false) AS ready"
  );
  if (!rows[0] || !rows[0].ready) {
    const error = new Error('Manual payout schema is missing its unique idempotency index.');
    error.code = 'DIRECT_PAYOUT_SCHEMA_NOT_READY';
    throw error;
  }
  tablesReady = true;
}

function parseAmountToPaise(value) {
  const amountText = typeof value === 'number' ? String(value) : String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) return null;
  const [wholeText, fractionText = ''] = amountText.split('.');
  const paise = Number(wholeText) * 100 + Number(fractionText.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(paise) || paise < MIN_AMOUNT_PAISE || paise > MAX_AMOUNT_PAISE) return null;
  return paise;
}

function encryptAccountNumber(accountNumber) {
  const key = getEncryptionKey();
  if (!key) {
    const error = new Error('Direct payout encryption key is missing or invalid.');
    error.code = 'DIRECT_PAYOUT_ENCRYPTION_KEY_NOT_READY';
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(':');
}

function decryptAccountNumber(value) {
  const key = getEncryptionKey();
  if (!key) {
    const error = new Error('Direct payout encryption key is missing or invalid.');
    error.code = 'DIRECT_PAYOUT_ENCRYPTION_KEY_NOT_READY';
    throw error;
  }
  const [version, ivHex, tagHex, ciphertextHex] = String(value || '').split(':');
  if (version !== 'v1' || !/^[0-9a-f]{24}$/i.test(ivHex || '') || !/^[0-9a-f]{32}$/i.test(tagHex || '') || !/^(?:[0-9a-f]{2})+$/i.test(ciphertextHex || '')) {
    const error = new Error('Stored beneficiary account data could not be decoded.');
    error.code = 'DIRECT_PAYOUT_CIPHERTEXT_INVALID';
    throw error;
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}

function destinationFingerprint(name, accountNumber, ifsc) {
  const key = getEncryptionKey();
  if (!key) return null;
  return crypto.createHmac('sha256', key)
    .update([name.trim().toLowerCase(), accountNumber, ifsc.toUpperCase()].join('|'))
    .digest('hex');
}

function makeReference() {
  return 'VBW-' + crypto.randomBytes(10).toString('hex').toUpperCase();
}

function serializeRequest(row, includeSensitive = false) {
  const result = {
    id: row.id,
    requestReference: row.request_reference,
    amount: Number(row.amount),
    currency: row.currency,
    beneficiaryName: row.beneficiary_name,
    destinationAccountMasked: row.destination_account_masked,
    destinationIfsc: row.destination_ifsc,
    status: row.status,
    bankUtr: row.bank_utr || null,
    evidenceNote: row.evidence_note || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
  if (includeSensitive) result.destinationAccountNumber = decryptAccountNumber(row.destination_account_encrypted);
  return result;
}

async function audit(userId, action, resourceId, details, req) {
  try {
    await createAuditLog({
      userId,
      action,
      resourceType: 'direct_bank_payout_request',
      resourceId,
      details,
      ipAddress: req ? req.ip : null,
      userAgent: req && req.headers ? req.headers['user-agent'] : null,
    });
  } catch (_) { /* audit logging is best effort after commit */ }
}

function isSafeIdempotencyKey(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(value);
}

router.get('/api/direct-bank-payouts/availability', (req, res) => {
  const status = readiness();
  res.status(200).json({
    success: true,
    available: status.available,
    provider: status.provider,
    mode: status.mode,
    currency: CURRENCY,
    autoTransfer: false,
    encryptionKeyReady: status.encryptionKeyReady,
    reason: status.reason,
    minAmount: status.minAmount,
    maxAmount: status.maxAmount,
  });
});

router.post('/api/direct-bank-payouts/requests', authenticateToken, async (req, res) => {
  let client;
  let requestReference = null;
  let amountPaise = null;
  let idempotencyKey = '';
  let fingerprint = null;
  try {
    const cfg = readiness();
    if (!cfg.available) {
      return res.status(503).json({
        success: false,
        code: 'DIRECT_BANK_PAYOUTS_NOT_CONFIGURED',
        message: 'VaultBank manual bank payouts are disabled or the destination encryption key is not configured.',
        availability: { available: false, reason: cfg.reason },
      });
    }
    amountPaise = parseAmountToPaise(req.body && req.body.amount);
    if (amountPaise == null) {
      return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_AMOUNT_INVALID', message: 'Amount must be INR 10.00 to INR 10,000.00 with at most two decimals.' });
    }
    idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!isSafeIdempotencyKey(idempotencyKey)) {
      return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'An Idempotency-Key header of 8-100 safe characters is required.' });
    }

    const beneficiaryName = String((req.body && req.body.beneficiaryName) || '').trim().replace(/\s+/g, ' ');
    const bankAccount = String((req.body && req.body.bankAccount) || '').trim();
    const ifsc = String((req.body && req.body.ifsc) || '').trim().toUpperCase();
    if (beneficiaryName.length < 2 || beneficiaryName.length > 100 || !ACCOUNT_RE.test(bankAccount) || !IFSC_RE.test(ifsc)) {
      return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_DESTINATION_INVALID', message: 'Enter the beneficiary name, a valid bank account number and valid IFSC.' });
    }

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const profileName = String(user.full_name || user.fullName || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!profileName || profileName !== beneficiaryName.toLowerCase()) {
      return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_BENEFICIARY_MUST_MATCH_PROFILE', message: 'For this pilot, the destination beneficiary name must match your VaultBank profile name.' });
    }

    const accountResult = await db.query(
      "SELECT * FROM accounts WHERE user_id = $1 AND currency = 'INR' AND status = 'active' ORDER BY created_at ASC LIMIT 1",
      [req.user.id]
    );
    if (!accountResult.rows.length) {
      return res.status(409).json({ success: false, code: 'INR_ACCOUNT_REQUIRED', message: 'Open an INR account before requesting a manual bank payout.' });
    }
    const account = accountResult.rows[0];
    const amount = Number(amountPaise) / 100;
    const encrypted = encryptAccountNumber(bankAccount);
    fingerprint = destinationFingerprint(beneficiaryName, bankAccount, ifsc);
    await ensureTables();

    // Fast idempotent replay path avoids holding/decrypting any unnecessary state.
    const existingResult = await db.query(
      'SELECT * FROM direct_bank_payout_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
      [req.user.id, idempotencyKey]
    );
    if (existingResult.rows.length) {
      const existing = existingResult.rows[0];
      if (Number(existing.amount) !== amount || existing.destination_fingerprint !== fingerprint) {
        return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_IDEMPOTENCY_MISMATCH', message: 'This request key was used with different payout details. Start a new request with a new key.' });
      }
      return res.status(200).json({ success: true, replay: true, request: serializeRequest(existing) });
    }

    requestReference = makeReference();
    client = await db.getClient();
    await client.query('BEGIN');
    try {
      const claim = await client.query(
        "INSERT INTO direct_bank_payout_requests " +
        "(user_id, account_id, request_reference, idempotency_key, amount, currency, beneficiary_name, destination_account_encrypted, destination_fingerprint, destination_account_masked, destination_ifsc, status) " +
        "VALUES ($1, $2, $3, $4, $5, 'INR', $6, $7, $8, $9, $10, 'reserved') RETURNING *",
        [req.user.id, account.id, requestReference, idempotencyKey, amount, beneficiaryName, encrypted, fingerprint, '****' + bankAccount.slice(-4), ifsc]
      );
      const row = claim.rows[0];
      const debit = await client.query(
        "UPDATE accounts SET balance = balance - $2, available_balance = available_balance - $2 " +
        "WHERE id = $1 AND user_id = $3 AND currency = 'INR' AND status = 'active' AND available_balance >= $2 " +
        "RETURNING (balance + $2) AS balance_before, balance AS balance_after",
        [account.id, amount, req.user.id]
      );
      if (!debit.rows.length) {
        const err = new Error('Insufficient available INR balance.');
        err.code = 'DIRECT_PAYOUT_INSUFFICIENT_FUNDS';
        throw err;
      }
      await client.query(
        "INSERT INTO transactions (account_id, user_id, type, status, amount, currency, balance_before, balance_after, description, category, external_reference, metadata) " +
        "VALUES ($1, $2, 'withdrawal', 'processing', $3, 'INR', $4, $5, $6, 'expense', $7, $8::jsonb)",
        [account.id, req.user.id, -amount, Number(debit.rows[0].balance_before), Number(debit.rows[0].balance_after), 'VaultBank manual bank payout ' + requestReference + ' to ' + ('****' + bankAccount.slice(-4)), requestReference, JSON.stringify({ rail: 'vaultbank-manual-bank-payout', automaticTransfer: false, requestReference, destinationIfsc: ifsc, destinationAccountMasked: '****' + bankAccount.slice(-4) })]
      );
      await client.query('COMMIT');
      await audit(req.user.id, 'direct_bank_payout_requested', row.id, { requestReference, amount, destinationIfsc: ifsc, destinationAccountMasked: '****' + bankAccount.slice(-4) }, req);
      try {
        await createNotification(req.user.id, {
          type: 'transaction',
          title: 'Bank payout request reserved',
          message: 'INR ' + amount.toFixed(2) + ' is reserved. An authorized VaultBank operator must send the bank transfer and record its UTR.',
        });
      } catch (_) {}
      return res.status(201).json({
        success: true,
        request: serializeRequest(row),
        message: 'Funds are reserved. This request does not initiate a bank transfer; the operator must send it through the bank and confirm the statement UTR.',
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (error && error.code === 'DIRECT_PAYOUT_INSUFFICIENT_FUNDS') {
        return res.status(400).json({ success: false, code: error.code, message: error.message });
      }
      if (error && error.code === '23505') {
        const replayResult = await db.query(
          'SELECT * FROM direct_bank_payout_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
          [req.user.id, idempotencyKey]
        );
        const existing = replayResult.rows[0];
        if (existing && Number(existing.amount) === amount && existing.destination_fingerprint === fingerprint) {
          return res.status(200).json({ success: true, replay: true, request: serializeRequest(existing) });
        }
        if (existing) return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_IDEMPOTENCY_MISMATCH', message: 'This idempotency key has already been used for different payout details.' });
      }
      throw error;
    } finally {
      client.release();
      client = null;
    }
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
    }
    if (error && error.code === 'DIRECT_PAYOUT_SCHEMA_NOT_READY') {
      return res.status(503).json({ success: false, code: error.code, message: error.message });
    }
    if (error && error.code === 'DIRECT_PAYOUT_ENCRYPTION_KEY_NOT_READY') {
      return res.status(503).json({ success: false, code: error.code, message: 'Payout encryption is not configured. No bank details were stored.' });
    }
    console.error('Direct bank payout request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not create the manual bank payout request.' });
  }
});

router.get('/api/direct-bank-payouts/requests', authenticateToken, async (req, res) => {
  try {
    await ensureTables();
    const result = await db.query(
      'SELECT * FROM direct_bank_payout_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    return res.status(200).json({ success: true, requests: result.rows.map((row) => serializeRequest(row)) });
  } catch (error) {
    console.error('Direct bank payout list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load your manual bank payout requests.' });
  }
});

router.get('/api/direct-bank-payouts/admin/requests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const status = String(req.query.status || 'reserved');
    const result = await db.query(
      'SELECT p.*, u.full_name, u.email FROM direct_bank_payout_requests p JOIN users u ON u.id = p.user_id WHERE p.status = $1 ORDER BY p.created_at ASC LIMIT 100',
      [status]
    );
    const requests = result.rows.map((row) => Object.assign(serializeRequest(row, true), {
      customerName: row.full_name,
      customerEmail: row.email,
    }));
    return res.status(200).json({ success: true, requests });
  } catch (error) {
    console.error('Direct bank payout admin queue failed:', error.message);
    if (error && error.code === 'DIRECT_PAYOUT_ENCRYPTION_KEY_NOT_READY') {
      return res.status(503).json({ success: false, code: error.code, message: 'The encryption key is missing; payout queue details cannot be decrypted.' });
    }
    return res.status(500).json({ success: false, message: 'Could not load manual bank payout queue.' });
  }
});

router.post('/api/direct-bank-payouts/admin/requests/:id/confirm', authenticateToken, requireAdmin, async (req, res) => {
  const bankUtr = String((req.body && req.body.bankUtr) || '').trim();
  const evidenceNote = String((req.body && req.body.evidenceNote) || '').trim();
  const settlementAmountPaise = parseAmountToPaise(req.body && req.body.settlementAmount);
  if (!UTR_RE.test(bankUtr)) return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_UTR_REQUIRED', message: 'A valid UTR from the official bank statement is required.' });
  if (!evidenceNote || evidenceNote.length < 10 || evidenceNote.length > 500) return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_EVIDENCE_REQUIRED', message: 'Add an evidence note from the bank statement (10-500 characters).' });
  if (settlementAmountPaise == null) return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_AMOUNT_INVALID', message: 'Enter the actual INR amount sent.' });

  let client;
  try {
    await ensureTables();
    client = await db.getClient();
    await client.query('BEGIN');
    const selected = await client.query('SELECT * FROM direct_bank_payout_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payout = selected.rows[0];
    if (!payout) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Payout request not found.' });
    }
    if (payout.status !== 'reserved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_NOT_PENDING', message: 'Only reserved payout requests can be confirmed. No additional ledger changes were made.' });
    }
    if (parseAmountToPaise(payout.amount) !== settlementAmountPaise) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_AMOUNT_MISMATCH', message: 'The bank debit amount must exactly match the reserved payout.' });
    }
    const updated = await client.query(
      "UPDATE direct_bank_payout_requests SET status = 'succeeded', bank_utr = $2, evidence_note = $3, verified_by_admin_id = $4, completed_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'reserved' RETURNING *",
      [payout.id, bankUtr, evidenceNote, req.user.id]
    );
    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_NOT_PENDING', message: 'Payout was concurrently resolved.' });
    }
    await client.query(
      "UPDATE transactions SET status = 'completed' WHERE external_reference = $1 AND type = 'withdrawal'",
      [payout.request_reference]
    );
    await client.query('COMMIT');
    try {
      await createNotification(payout.user_id, {
        type: 'transaction',
        title: 'Bank payout completed',
        message: 'INR ' + Number(payout.amount).toFixed(2) + ' was sent to your bank account. Reference: ' + payout.request_reference + '.',
      });
    } catch (_) {}
    await audit(req.user.id, 'direct_bank_payout_confirmed', payout.id, { reference: payout.request_reference, amount: Number(payout.amount), bankUtr }, req);
    return res.status(200).json({ success: true, request: serializeRequest(updated.rows[0]) });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    if (error && error.code === '23505') return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_UTR_ALREADY_USED', message: 'This UTR has already been applied to another payout.' });
    console.error('Direct bank payout confirmation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Payout confirmation failed; do not assume the payout is recorded.' });
  } finally {
    if (client) client.release();
  }
});

router.post('/api/direct-bank-payouts/admin/requests/:id/refund', authenticateToken, requireAdmin, async (req, res) => {
  const note = String((req.body && req.body.evidenceNote) || '').trim();
  if (note.length < 10 || note.length > 500) return res.status(400).json({ success: false, code: 'DIRECT_PAYOUT_REFUND_EVIDENCE_REQUIRED', message: 'Explain the bank-statement evidence proving no transfer was sent (10-500 characters).' });
  let client;
  try {
    await ensureTables();
    client = await db.getClient();
    await client.query('BEGIN');
    const selected = await client.query('SELECT * FROM direct_bank_payout_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payout = selected.rows[0];
    if (!payout) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Payout request not found.' });
    }
    if (payout.status !== 'reserved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_NOT_PENDING', message: 'Only an unresolved reserved payout can be refunded.' });
    }
    const claimed = await client.query(
      "UPDATE direct_bank_payout_requests SET status = 'failed_refunded', evidence_note = $2, verified_by_admin_id = $3, updated_at = NOW() WHERE id = $1 AND status = 'reserved' RETURNING id",
      [payout.id, note, req.user.id]
    );
    if (!claimed.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_NOT_PENDING', message: 'Payout was concurrently resolved.' });
    }
    const refundExternalRef = payout.request_reference + '-REFUND';
    const seen = await client.query('SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1', [refundExternalRef]);
    if (!seen.rows.length) {
      const refund = await client.query(
        "UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1 AND user_id = $3 AND currency = 'INR' RETURNING (balance - $2) AS balance_before, balance AS balance_after",
        [payout.account_id, Number(payout.amount), payout.user_id]
      );
      if (!refund.rows.length) {
        const error = new Error('Refund account missing.');
        error.code = 'DIRECT_PAYOUT_REFUND_ACCOUNT_MISSING';
        throw error;
      }
      await client.query(
        "INSERT INTO transactions (account_id, user_id, type, status, amount, currency, balance_before, balance_after, description, category, external_reference, metadata) " +
        "VALUES ($1, $2, 'refund', 'completed', $3, 'INR', $4, $5, $6, 'income', $7, $8::jsonb)",
        [payout.account_id, payout.user_id, Number(payout.amount), Number(refund.rows[0].balance_before), Number(refund.rows[0].balance_after), 'Manual bank payout ' + payout.request_reference + ' refunded after bank review', refundExternalRef, JSON.stringify({ rail: 'vaultbank-manual-bank-payout', requestReference: payout.request_reference, evidenceNote: note })]
      );
    }
    await client.query(
      "UPDATE transactions SET status = 'failed_refunded' WHERE external_reference = $1 AND type = 'withdrawal'",
      [payout.request_reference]
    );
    await client.query('COMMIT');
    try {
      await createNotification(payout.user_id, {
        type: 'warning',
        title: 'Bank payout request cancelled — funds returned',
        message: 'INR ' + Number(payout.amount).toFixed(2) + ' was returned to your balance after the operator verified no bank transfer was sent.',
      });
    } catch (_) {}
    await audit(req.user.id, 'direct_bank_payout_refunded', payout.id, { reference: payout.request_reference, amount: Number(payout.amount), evidenceNote: note }, req);
    return res.status(200).json({ success: true, refunded: true, requestReference: payout.request_reference });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    if (error && error.code === '23505') return res.status(409).json({ success: false, code: 'DIRECT_PAYOUT_UTR_ALREADY_USED', message: 'Bank UTR conflict; no additional payout change was committed.' });
    console.error('Direct bank payout refund failed:', error.message);
    return res.status(500).json({ success: false, message: 'Refund was not confirmed. Review the ledger before retrying.' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
module.exports.readiness = readiness;
module.exports.parseAmountToPaise = parseAmountToPaise;
module.exports.encryptAccountNumber = encryptAccountNumber;
module.exports.decryptAccountNumber = decryptAccountNumber;
module.exports.destinationFingerprint = destinationFingerprint;
