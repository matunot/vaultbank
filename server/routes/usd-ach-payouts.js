'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  db, findUserById, createNotification, createAuditLog,
} = require('../config/database');
const {
  ensureVaultLedgerSchema, ensureCustomerLedgerAccount,
  changeVerifiedAvailableBalance, postBalancedJournal,
} = require('../services/ledgerJournalService');
const { buildNachaCreditFile, validAbaRoutingNumber, parseUsdCents, parseEffectiveDate, MAX_ENTRIES } = require('../services/nachaAchFile');

const MIN_PAYOUT_CENTS = 1000n;       // $10.00 pilot minimum
const MAX_PAYOUT_CENTS = 1000000n;    // $10,000.00 pilot cap
const UTR_RE = /^[A-Za-z0-9/-]{6,120}$/;
let tablesReady = false;

function encryptionKey() {
  const hex = String(process.env.VB_USD_ACH_ENCRYPTION_KEY || '').trim();
  return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

function fieldReady(value, maxLength, pattern = /^[\x20-\x7E]+$/) {
  const text = String(value == null ? '' : value);
  return text.trim().length > 0 && text.length <= maxLength && pattern.test(text);
}

function readiness() {
  const enabledFlag = process.env.VB_USD_ACH_EXPORT_ENABLED === 'true';
  const keyReady = !!encryptionKey();
  const odfiRoutingNumber = String(process.env.VB_USD_ACH_ODFI_ROUTING_NUMBER || '').trim();
  const immediateOrigin = String(process.env.VB_USD_ACH_IMMEDIATE_ORIGIN || '');
  const odfiName = String(process.env.VB_USD_ACH_ODFI_NAME || '').trim();
  const immediateOriginName = String(process.env.VB_USD_ACH_IMMEDIATE_ORIGIN_NAME || '').trim();
  const companyName = String(process.env.VB_USD_ACH_COMPANY_NAME || '').trim();
  const companyId = String(process.env.VB_USD_ACH_COMPANY_ID || '').trim();
  const companyEntryDescription = String(process.env.VB_USD_ACH_ENTRY_DESCRIPTION || 'PAYOUT').trim();
  const odfiConfigReady = validAbaRoutingNumber(odfiRoutingNumber)
    && fieldReady(immediateOrigin, 10)
    && fieldReady(odfiName, 23)
    && fieldReady(immediateOriginName, 23)
    && fieldReady(companyName, 16, /^[A-Za-z0-9 &.,/+\-]+$/)
    && fieldReady(companyId, 10, /^[A-Za-z0-9 &.,/+\-]+$/)
    && fieldReady(companyEntryDescription, 10, /^[A-Za-z0-9 &.,/+\-]+$/);
  const available = enabledFlag && keyReady && odfiConfigReady;
  const reason = !enabledFlag ? 'disabled-by-operator'
    : (!keyReady ? 'encryption-key-missing-or-invalid'
      : (!odfiConfigReady ? 'odfi-profile-incomplete-or-invalid' : 'configured-file-export-only'));
  return {
    available,
    enabled: available,
    customerAccessEnabled: available && process.env.VB_USD_ACH_CUSTOMER_ACCESS_ENABLED === 'true',
    provider: 'vaultbank-native-ach-file-export',
    currency: 'USD',
    mode: 'odfi-file-export-with-manual-bank-reconciliation',
    automaticTransfer: false,
    odfiConfigReady,
    encryptionKeyReady: keyReady,
    reason,
    minAmount: Number(MIN_PAYOUT_CENTS) / 100,
    maxAmount: Number(MAX_PAYOUT_CENTS) / 100,
    maxBatchEntries: MAX_ENTRIES,
  };
}

function requireAvailable(res) {
  const cfg = readiness();
  if (!cfg.available) {
    res.status(503).json({
      success: false,
      code: 'USD_ACH_EXPORT_NOT_CONFIGURED',
      message: 'USD ACH export is disabled or the authorized ODFI file profile is incomplete.',
      availability: { available: false, reason: cfg.reason },
    });
    return false;
  }
  return true;
}

function isAdmin(req) {
  return !!req.user && ['admin', 'super_admin'].includes(String(req.user.role || '').toLowerCase());
}

function requireCustomerAccess(req, res) {
  if (isAdmin(req)) return true;
  if (process.env.VB_USD_ACH_CUSTOMER_ACCESS_ENABLED !== 'true') {
    res.status(403).json({
      success: false,
      code: 'USD_ACH_CUSTOMER_ACCESS_DISABLED',
      message: 'USD ACH payout requests are restricted to the authorized admin pilot.',
    });
    return false;
  }
  if (!req.user || req.user.email_verified !== true || req.user.kyc_status !== 'verified') {
    res.status(403).json({
      success: false,
      code: 'CUSTOMER_VERIFICATION_REQUIRED',
      message: 'Verify your email and complete identity verification before requesting a USD bank payout.',
    });
    return false;
  }
  return true;
}

function safeIdempotencyKey(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function moneyFromCents(cents) {
  return String(cents / 100n) + '.' + String(cents % 100n).padStart(2, '0');
}

function parsePilotAmount(value) {
  const cents = parseUsdCents(value);
  if (cents < MIN_PAYOUT_CENTS || cents > MAX_PAYOUT_CENTS) {
    const error = new Error('USD payout must be between $10.00 and $10,000.00 for the current pilot.');
    error.code = 'USD_ACH_AMOUNT_INVALID';
    throw error;
  }
  return { cents, amount: moneyFromCents(cents) };
}

function makeReference(prefix = 'VBACH') {
  return prefix + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

function encryptSecret(value) {
  const key = encryptionKey();
  if (!key) {
    const error = new Error('USD ACH encryption key is missing or invalid.');
    error.code = 'USD_ACH_ENCRYPTION_KEY_NOT_READY';
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptSecret(value) {
  const key = encryptionKey();
  if (!key) {
    const error = new Error('USD ACH encryption key is missing or invalid.');
    error.code = 'USD_ACH_ENCRYPTION_KEY_NOT_READY';
    throw error;
  }
  const [version, ivHex, tagHex, payloadHex] = String(value || '').split(':');
  if (version !== 'v1' || !/^[0-9a-f]{24}$/i.test(ivHex || '') || !/^[0-9a-f]{32}$/i.test(tagHex || '') || !/^(?:[0-9a-f]{2})+$/i.test(payloadHex || '')) {
    const error = new Error('Encrypted ACH beneficiary data cannot be decoded.');
    error.code = 'USD_ACH_CIPHERTEXT_INVALID';
    throw error;
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(payloadHex, 'hex')), decipher.final()]).toString('utf8');
}

function destinationFingerprint({ beneficiaryName, routingNumber, accountNumber, accountType }) {
  const key = encryptionKey();
  if (!key) throw new Error('USD ACH encryption key is missing or invalid.');
  const normalized = [
    normalizeName(beneficiaryName).toUpperCase(),
    String(routingNumber),
    String(accountNumber).toUpperCase(),
    String(accountType).toLowerCase(),
  ].join('|');
  return crypto.createHmac('sha256', key).update(normalized).digest('hex');
}

function serializeRequest(row, includeCustomer = false) {
  const result = {
    id: row.id,
    requestReference: row.request_reference,
    amount: Number(row.amount),
    currency: 'USD',
    beneficiaryName: row.beneficiary_name,
    destinationAccountMasked: row.destination_account_masked,
    destinationRoutingMasked: row.destination_routing_masked,
    accountType: row.account_type,
    status: row.status,
    reviewNote: row.review_note || null,
    batchId: row.batch_id || null,
    bankReference: row.bank_reference || null,
    evidenceNote: row.evidence_note || null,
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
    exportedAt: row.exported_at || null,
    settledAt: row.settled_at || null,
    updatedAt: row.updated_at,
  };
  if (includeCustomer) {
    result.customerName = row.customer_name || null;
    result.customerEmail = row.customer_email || null;
  }
  return result;
}

function serializeBatch(row) {
  return {
    id: row.id,
    batchReference: row.batch_reference,
    effectiveDate: row.effective_date,
    fileCreationDate: row.file_creation_date,
    fileIdModifier: row.file_id_modifier,
    fileSha256: row.file_sha256,
    payoutCount: Number(row.payout_count),
    totalAmount: Number(row.total_amount),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function audit(userId, action, resourceId, details, req) {
  try {
    await createAuditLog({
      userId, action, resourceType: 'usd_ach_payout',
      resourceId, details,
      ipAddress: req ? req.ip : null,
      userAgent: req && req.headers ? req.headers['user-agent'] : null,
    });
  } catch (_) { /* audit outage must not reverse an already committed money movement */ }
}

async function ensureTables() {
  if (tablesReady) return;
  await db.ensureConnection();
  await db.query(`
    CREATE TABLE IF NOT EXISTS usd_ach_payout_batches (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      batch_reference TEXT NOT NULL UNIQUE,
      created_by UUID NOT NULL REFERENCES users(id),
      idempotency_key TEXT NOT NULL,
      effective_date DATE NOT NULL,
      file_creation_date DATE NOT NULL,
      file_id_modifier TEXT NOT NULL CHECK (file_id_modifier ~ '^[A-Z0-9]$'),
      trace_sequence_start INTEGER NOT NULL DEFAULT 1,
      trace_sequence_end INTEGER NOT NULL DEFAULT 1,
      file_sha256 TEXT NOT NULL,
      encrypted_file_content TEXT NOT NULL,
      request_ids JSONB NOT NULL,
      payout_count INTEGER NOT NULL CHECK (payout_count > 0),
      total_amount NUMERIC(15,2) NOT NULL CHECK (total_amount > 0),
      status TEXT NOT NULL DEFAULT 'file_generated'
        CHECK (status IN ('file_generated','bank_confirmed','reconciled','rejected')),
      evidence_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (created_by, idempotency_key),
      UNIQUE (file_creation_date, file_id_modifier)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS usd_ach_payout_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      request_reference TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      beneficiary_name TEXT NOT NULL,
      destination_encrypted TEXT NOT NULL,
      destination_fingerprint TEXT NOT NULL,
      destination_account_masked TEXT NOT NULL,
      destination_routing_masked TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('checking','savings')),
      authorization_version TEXT NOT NULL,
      authorized_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved','approved','exported','settled','failed_refunded')),
      batch_id UUID REFERENCES usd_ach_payout_batches(id),
      review_note TEXT,
      approved_by UUID REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      exported_at TIMESTAMPTZ,
      bank_reference TEXT,
      evidence_note TEXT,
      verified_by_admin_id UUID REFERENCES users(id),
      settled_at TIMESTAMPTZ,
      failed_refunded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS usd_ach_request_user_idempotency_uq ON usd_ach_payout_requests (user_id, idempotency_key)');
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS usd_ach_request_bank_reference_uq ON usd_ach_payout_requests (bank_reference) WHERE bank_reference IS NOT NULL');
  await db.query('CREATE INDEX IF NOT EXISTS usd_ach_request_status_created_idx ON usd_ach_payout_requests (status, created_at)');
  await db.query('CREATE INDEX IF NOT EXISTS usd_ach_request_batch_idx ON usd_ach_payout_requests (batch_id, status)');
  await db.query('ALTER TABLE usd_ach_payout_batches ADD COLUMN IF NOT EXISTS trace_sequence_start INTEGER NOT NULL DEFAULT 1');
  await db.query('ALTER TABLE usd_ach_payout_batches ADD COLUMN IF NOT EXISTS trace_sequence_end INTEGER NOT NULL DEFAULT 1');
  tablesReady = true;
}

function odfiConfig() {
  return {
    odfiRoutingNumber: String(process.env.VB_USD_ACH_ODFI_ROUTING_NUMBER || '').trim(),
    immediateOrigin: String(process.env.VB_USD_ACH_IMMEDIATE_ORIGIN || ''),
    odfiName: String(process.env.VB_USD_ACH_ODFI_NAME || ''),
    immediateOriginName: String(process.env.VB_USD_ACH_IMMEDIATE_ORIGIN_NAME || ''),
    companyName: String(process.env.VB_USD_ACH_COMPANY_NAME || ''),
    companyId: String(process.env.VB_USD_ACH_COMPANY_ID || ''),
    companyEntryDescription: String(process.env.VB_USD_ACH_ENTRY_DESCRIPTION || 'PAYOUT'),
  };
}

function getBatchFileModifier(usedModifiers) {
  const candidates = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return candidates.find((candidate) => !usedModifiers.has(candidate)) || null;
}

function batchConfirmedNotSent(batch) {
  return !!batch && batch.status === 'rejected';
}

async function returnBatchPayload(row, replay = false) {
  const fileContent = row.status === 'file_generated' ? decryptSecret(row.encrypted_file_content) : null;
  return {
    success: true,
    replay,
    batch: serializeBatch(row),
    fileContent,
    message: row.status === 'file_generated'
      ? 'NACHA file generated only. VaultBank has not sent funds; upload only through your authorized ODFI process and reconcile official bank confirmation.'
      : 'This batch is no longer exportable. It has been rejected or reconciled; no fresh file was produced.',
  };
}

router.get('/api/usd-ach/availability', (req, res) => {
  const cfg = readiness();
  return res.status(200).json({
    success: true,
    available: cfg.available,
    customerAccessEnabled: cfg.customerAccessEnabled,
    provider: cfg.provider,
    currency: cfg.currency,
    mode: cfg.mode,
    automaticTransfer: false,
    reason: cfg.reason,
    minAmount: cfg.minAmount,
    maxAmount: cfg.maxAmount,
    maxBatchEntries: cfg.maxBatchEntries,
  });
});

router.post('/api/usd-ach/payouts', authenticateToken, async (req, res) => {
  let client = null;
  try {
    const cfg = readiness();
    if (!cfg.available) return res.status(503).json({ success: false, code: 'USD_ACH_EXPORT_NOT_CONFIGURED', message: 'USD ACH export is disabled or the authorized ODFI file profile is incomplete.', availability: { available: false, reason: cfg.reason } });
    if (!requireCustomerAccess(req, res)) return;
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!safeIdempotencyKey(idempotencyKey)) return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Supply an Idempotency-Key of 8-100 safe characters and reuse it for retries.' });
    let amountInfo;
    try { amountInfo = parsePilotAmount(req.body && req.body.amount); }
    catch (error) { return res.status(400).json({ success: false, code: error.code || 'USD_ACH_AMOUNT_INVALID', message: error.message }); }

    const beneficiaryName = normalizeName(req.body && req.body.beneficiaryName);
    const routingNumber = String(req.body && req.body.routingNumber || '').trim();
    const accountNumber = String(req.body && req.body.accountNumber || '').trim().toUpperCase();
    const accountType = String(req.body && req.body.accountType || '').trim().toLowerCase();
    if (beneficiaryName.length < 2 || beneficiaryName.length > 22 || !/^[A-Za-z0-9 &.,/+\-]+$/.test(beneficiaryName)) {
      return res.status(400).json({ success: false, code: 'USD_ACH_BENEFICIARY_INVALID', message: 'Beneficiary name must be 2-22 characters using supported ASCII bank-file characters.' });
    }
    if (!validAbaRoutingNumber(routingNumber)) return res.status(400).json({ success: false, code: 'USD_ACH_ROUTING_INVALID', message: 'Enter a valid nine-digit ABA routing number.' });
    if (!/^[A-Za-z0-9-]{1,17}$/.test(accountNumber)) return res.status(400).json({ success: false, code: 'USD_ACH_ACCOUNT_INVALID', message: 'Account number must be 1-17 letters, digits, or hyphens.' });
    if (!['checking','savings'].includes(accountType)) return res.status(400).json({ success: false, code: 'USD_ACH_ACCOUNT_TYPE_INVALID', message: 'Choose checking or savings.' });
    if (req.body.authorizationAccepted !== true) return res.status(400).json({ success: false, code: 'USD_ACH_AUTHORIZATION_REQUIRED', message: 'Confirm the bank payout authorization before continuing.' });

    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const profileName = normalizeName(user.full_name || user.fullName || '').toLowerCase();
    if (!profileName || profileName !== beneficiaryName.toLowerCase()) {
      return res.status(400).json({ success: false, code: 'USD_ACH_BENEFICIARY_MUST_MATCH_PROFILE', message: 'For this pilot, beneficiary name must match the VaultBank profile name.' });
    }

    await ensureVaultLedgerSchema();
    await ensureTables();
    const encryptedDestination = encryptSecret(JSON.stringify({ routingNumber, accountNumber, accountType }));
    const fingerprint = destinationFingerprint({ beneficiaryName, routingNumber, accountNumber, accountType });
    const existingResult = await db.query(
      'SELECT * FROM usd_ach_payout_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1',
      [req.user.id, idempotencyKey]
    );
    if (existingResult.rows.length) {
      const existing = existingResult.rows[0];
      if (String(existing.amount) !== amountInfo.amount || existing.destination_fingerprint !== fingerprint) {
        return res.status(409).json({ success: false, code: 'USD_ACH_IDEMPOTENCY_MISMATCH', message: 'This idempotency key was used with different payout details.' });
      }
      return res.status(200).json({ success: true, replay: true, request: serializeRequest(existing), message: 'Original payout request returned; no additional funds were reserved.' });
    }

    client = await db.getClient();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vaultbank-usd-ach-payout'))");
    const accountResult = await client.query(
      "SELECT id, balance::text AS balance, available_balance::text AS available_balance, currency, status FROM accounts WHERE user_id = $1 AND currency = 'USD' AND status = 'active' ORDER BY created_at ASC LIMIT 1 FOR UPDATE",
      [req.user.id]
    );
    if (!accountResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACCOUNT_REQUIRED', message: 'Open an active USD account before requesting a bank payout.' });
    }
    const account = accountResult.rows[0];
    await ensureCustomerLedgerAccount(client, account.id);
    try { await changeVerifiedAvailableBalance(client, account.id, amountInfo.amount, 'debit'); }
    catch (error) {
      if (error && error.code === 'VB_LEDGER_VERIFIED_FUNDS_INSUFFICIENT') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, code: 'USD_ACH_UNVERIFIED_FUNDS', message: 'Only externally verified spendable USD can be reserved for an ACH payout.' });
      }
      throw error;
    }
    const requestReference = makeReference();
    const inserted = await client.query(
      "INSERT INTO usd_ach_payout_requests (user_id, account_id, request_reference, idempotency_key, amount, currency, beneficiary_name, destination_encrypted, destination_fingerprint, destination_account_masked, destination_routing_masked, account_type, authorization_version, authorized_at, status) VALUES ($1,$2,$3,$4,$5,'USD',$6,$7,$8,$9,$10,$11,'usd-ach-payout-v1',NOW(),'reserved') RETURNING *",
      [req.user.id, account.id, requestReference, idempotencyKey, amountInfo.amount, beneficiaryName, encryptedDestination, fingerprint, '****' + accountNumber.slice(-4), '*****' + routingNumber.slice(-4), accountType]
    );
    const balanceUpdate = await client.query(
      "UPDATE accounts SET balance = balance - $2, available_balance = available_balance - $2 WHERE id = $1 AND user_id = $3 AND currency = 'USD' AND status = 'active' AND available_balance >= $2 RETURNING (balance + $2) AS balance_before, balance AS balance_after",
      [account.id, amountInfo.amount, req.user.id]
    );
    if (!balanceUpdate.rows.length) {
      const error = new Error('Insufficient available USD balance.');
      error.code = 'USD_ACH_INSUFFICIENT_FUNDS';
      throw error;
    }
    await client.query(
      "INSERT INTO transactions (account_id, user_id, type, status, amount, currency, balance_before, balance_after, description, category, external_reference, metadata) VALUES ($1,$2,'withdrawal','processing',$3,'USD',$4,$5,$6,'expense',$7,$8::jsonb)",
      [account.id, req.user.id, -Number(amountInfo.amount), Number(balanceUpdate.rows[0].balance_before), Number(balanceUpdate.rows[0].balance_after), 'VaultBank USD ACH payout ' + requestReference + ' to ' + ('****' + accountNumber.slice(-4)), requestReference, JSON.stringify({ rail: 'vaultbank-native-ach-file-export', requestReference, automaticTransfer: false, destinationAccountMasked: '****' + accountNumber.slice(-4), destinationRoutingMasked: '*****' + routingNumber.slice(-4) })]
    );
    await postBalancedJournal(client, {
      eventType: 'payout_reserved',
      sourceType: 'usd_ach_payout',
      sourceId: requestReference,
      currency: 'USD',
      description: 'USD payout reserved pending ODFI file submission and bank settlement',
      actorUserId: req.user.id,
      metadata: { destinationAccountMasked: '****' + accountNumber.slice(-4), destinationRoutingMasked: '*****' + routingNumber.slice(-4), automaticTransfer: false },
      entries: [
        { accountId: account.id, side: 'debit', amount: amountInfo.amount },
        { systemCode: 'OUTBOUND_PAYOUTS_PAYABLE', side: 'credit', amount: amountInfo.amount },
      ],
    });
    await client.query('COMMIT');
    const row = inserted.rows[0];
    await audit(req.user.id, 'usd_ach_payout_requested', row.id, { requestReference, amount: amountInfo.amount, destinationAccountMasked: row.destination_account_masked, destinationRoutingMasked: row.destination_routing_masked }, req);
    try {
      await createNotification(req.user.id, {
        type: 'transaction',
        title: 'USD bank payout reserved',
        message: 'USD ' + amountInfo.amount + ' is reserved for an ACH file. No bank transfer has been sent; an authorized operator must export the file and verify bank settlement.',
      });
    } catch (_) {}
    return res.status(201).json({ success: true, request: serializeRequest(row), message: 'USD funds reserved. This request has not been sent to a bank.' });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    if (error && error.code === '23505') return res.status(409).json({ success: false, code: 'USD_ACH_IDEMPOTENCY_CONFLICT', message: 'The payout request key or reference already exists; check request history before retrying.' });
    if (error && ['VB_LEDGER_SCHEMA_NOT_READY','VB_LEDGER_ACCOUNT_NOT_READY','USD_ACH_ENCRYPTION_KEY_NOT_READY'].includes(error.code)) return res.status(503).json({ success: false, code: error.code, message: error.message });
    console.error('USD ACH payout request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not create the USD payout request.' });
  } finally {
    if (client) client.release();
  }
});

router.get('/api/usd-ach/payouts', authenticateToken, async (req, res) => {
  try {
    await ensureTables();
    const result = await db.query('SELECT * FROM usd_ach_payout_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    return res.status(200).json({ success: true, requests: result.rows.map((row) => serializeRequest(row)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not load USD ACH payout history.' });
  }
});

router.get('/api/usd-ach/admin/requests', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const status = String(req.query.status || 'reserved');
    if (!['reserved','approved','exported','settled','failed_refunded'].includes(status)) return res.status(400).json({ success: false, message: 'Unsupported payout status.' });
    const result = await db.query(
      'SELECT p.*, u.full_name AS customer_name, u.email AS customer_email FROM usd_ach_payout_requests p JOIN users u ON u.id = p.user_id WHERE p.status = $1 ORDER BY p.created_at ASC LIMIT 500',
      [status]
    );
    return res.status(200).json({ success: true, requests: result.rows.map((row) => serializeRequest(row, true)) });
  } catch (error) {
    console.error('USD ACH admin queue failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load USD ACH requests.' });
  }
});

router.post('/api/usd-ach/admin/requests/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  const note = String(req.body && req.body.note || '').trim();
  if (note.length < 10 || note.length > 500) return res.status(400).json({ success: false, code: 'USD_ACH_APPROVAL_NOTE_REQUIRED', message: 'Approval note must be 10-500 characters.' });
  try {
    await ensureTables();
    const result = await db.query(
      "UPDATE usd_ach_payout_requests SET status = 'approved', review_note = $2, approved_by = $3, approved_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'reserved' RETURNING *",
      [req.params.id, note, req.user.id]
    );
    if (!result.rows.length) return res.status(409).json({ success: false, code: 'USD_ACH_REQUEST_NOT_RESERVED', message: 'Only reserved requests can be approved.' });
    await audit(req.user.id, 'usd_ach_payout_approved', result.rows[0].id, { note }, req);
    return res.status(200).json({ success: true, request: serializeRequest(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not approve USD ACH request.' });
  }
});

router.post('/api/usd-ach/admin/batches', authenticateToken, requireAdmin, async (req, res) => {
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  const requestIds = Array.isArray(req.body && req.body.requestIds) ? req.body.requestIds.map(String) : [];
  const effectiveDate = String(req.body && req.body.effectiveDate || '').trim();
  if (!safeIdempotencyKey(idempotencyKey)) return res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A batch Idempotency-Key of 8-100 safe characters is required.' });
  if (requestIds.length < 1 || requestIds.length > MAX_ENTRIES || new Set(requestIds).size !== requestIds.length || requestIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    return res.status(400).json({ success: false, code: 'USD_ACH_BATCH_IDS_INVALID', message: 'Choose 1-500 unique payout request IDs.' });
  }
  if (!requireAvailable(res)) return;
  const cfg = odfiConfig();
  try { parseEffectiveDate(effectiveDate); }
  catch (error) { return res.status(400).json({ success: false, code: 'USD_ACH_EFFECTIVE_DATE_INVALID', message: error.message }); }

  let client;
  try {
    await ensureVaultLedgerSchema();
    await ensureTables();
    const existingResult = await db.query('SELECT * FROM usd_ach_payout_batches WHERE created_by = $1 AND idempotency_key = $2 LIMIT 1', [req.user.id, idempotencyKey]);
    if (existingResult.rows.length) {
      if (existingResult.rows[0].status !== 'file_generated') {
        return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_ALREADY_RESOLVED', message: 'This batch is already resolved and cannot be re-exported.' });
      }
      return res.status(200).json(await returnBatchPayload(existingResult.rows[0], true));
    }
    client = await db.getClient();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vaultbank-usd-ach-export'))");
    const selected = await client.query(
      "SELECT p.* FROM usd_ach_payout_requests p WHERE p.id = ANY($1::uuid[]) AND p.status = 'approved' ORDER BY p.created_at ASC FOR UPDATE OF p",
      [requestIds]
    );
    if (selected.rows.length !== requestIds.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_REQUESTS_NOT_APPROVED', message: 'Every chosen payout must be approved, unexported, and unique.' });
    }

    const fileCreationDate = new Date().toISOString().slice(0, 10);
    const used = await client.query('SELECT file_id_modifier FROM usd_ach_payout_batches WHERE file_creation_date = $1 FOR UPDATE', [fileCreationDate]);
    const usedModifiers = new Set(used.rows.map((row) => String(row.file_id_modifier)));
    const fileIdModifier = getBatchFileModifier(usedModifiers);
    if (!fileIdModifier) {
      await client.query('ROLLBACK');
      return res.status(503).json({ success: false, code: 'USD_ACH_FILE_MODIFIER_EXHAUSTED', message: 'All 36 ACH file ID modifiers are used for this date; ask the ODFI for the next permitted batch profile.' });
    }
    const maxTrace = await client.query('SELECT COALESCE(MAX(trace_sequence_end), 0) AS max_trace FROM usd_ach_payout_batches');
    const traceSequenceStart = Number(maxTrace.rows[0].max_trace || 0) + 1;
    const destinations = selected.rows.map((row) => {
      const destination = JSON.parse(decryptSecret(row.destination_encrypted));
      return {
        routingNumber: destination.routingNumber,
        accountNumber: destination.accountNumber,
        accountType: destination.accountType,
        beneficiaryName: row.beneficiary_name,
        amount: String(row.amount),
        requestReference: row.request_reference,
      };
    });
    const file = buildNachaCreditFile({
      config: cfg, payouts: destinations, effectiveDate, fileIdModifier,
      traceSequenceStart, now: new Date(),
    });
    const fileSha256 = crypto.createHash('sha256').update(file.content, 'ascii').digest('hex');
    const batchReference = makeReference('VBACH-BATCH');
    const totalAmount = file.totalCredit;
    const batchResult = await client.query(
      "INSERT INTO usd_ach_payout_batches (batch_reference, created_by, idempotency_key, effective_date, file_creation_date, file_id_modifier, trace_sequence_start, trace_sequence_end, file_sha256, encrypted_file_content, request_ids, payout_count, total_amount, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,'file_generated') RETURNING *",
      [batchReference, req.user.id, idempotencyKey, effectiveDate, fileCreationDate, fileIdModifier, traceSequenceStart, traceSequenceStart + selected.rows.length - 1, fileSha256, encryptSecret(file.content), JSON.stringify(requestIds), selected.rows.length, totalAmount]
    );
    const batch = batchResult.rows[0];
    const update = await client.query(
      "UPDATE usd_ach_payout_requests SET status = 'exported', batch_id = $1, exported_at = NOW(), updated_at = NOW() WHERE id = ANY($2::uuid[]) AND status = 'approved' RETURNING id",
      [batch.id, requestIds]
    );
    if (update.rows.length !== requestIds.length) {
      const error = new Error('A payout was no longer approved for export.');
      error.code = 'USD_ACH_BATCH_CONFLICT';
      throw error;
    }
    await client.query('COMMIT');
    await audit(req.user.id, 'usd_ach_file_generated', batch.id, { batchReference, fileSha256, count: file.entryCount, totalAmount, effectiveDate }, req);
    const response = await returnBatchPayload(batch, false);
    response.batch = serializeBatch(batch);
    response.fileSha256 = fileSha256;
    response.fileRecords = file.recordCount;
    response.traceNumbers = file.traceNumbers;
    return res.status(201).json(response);
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    if (error && error.code === '23505') {
      try {
        const existing = await db.query('SELECT * FROM usd_ach_payout_batches WHERE created_by = $1 AND idempotency_key = $2 LIMIT 1', [req.user.id, idempotencyKey]);
        if (existing.rows.length && existing.rows[0].status === 'file_generated') return res.status(200).json(await returnBatchPayload(existing.rows[0], true));
      } catch (_) {}
    }
    if (error && error.code === 'USD_ACH_BATCH_CONFLICT') return res.status(409).json({ success: false, code: error.code, message: error.message });
    if (error && ['VB_LEDGER_SCHEMA_NOT_READY','USD_ACH_ENCRYPTION_KEY_NOT_READY'].includes(error.code)) return res.status(503).json({ success: false, code: error.code, message: error.message });
    console.error('USD ACH batch export failed:', error.message);
    return res.status(500).json({ success: false, message: 'ACH batch file was not confirmed. Check the admin batch list before retrying.' });
  } finally {
    if (client) client.release();
  }
});

router.get('/api/usd-ach/admin/batches', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const result = await db.query('SELECT * FROM usd_ach_payout_batches ORDER BY created_at DESC LIMIT 50');
    return res.status(200).json({ success: true, batches: result.rows.map((row) => serializeBatch(row)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not load USD ACH batches.' });
  }
});

router.get('/api/usd-ach/admin/batches/:id/file', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const result = await db.query('SELECT * FROM usd_ach_payout_batches WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'ACH batch not found.' });
    const row = result.rows[0];
    if (row.status !== 'file_generated') {
      return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_NOT_EXPORTABLE', message: 'This ACH batch is rejected or already reconciled and can no longer be downloaded.' });
    }
    return res.status(200).json({ success: true, batch: serializeBatch(row), fileContent: decryptSecret(row.encrypted_file_content) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not reload the ACH file.' });
  }
});

router.post('/api/usd-ach/admin/requests/:id/settle', authenticateToken, requireAdmin, async (req, res) => {
  const bankReference = String(req.body && req.body.bankReference || '').trim();
  const evidenceNote = String(req.body && req.body.evidenceNote || '').trim();
  let settledAmount;
  try { settledAmount = parsePilotAmount(req.body && req.body.settlementAmount); }
  catch (error) { return res.status(400).json({ success: false, code: 'USD_ACH_SETTLEMENT_AMOUNT_INVALID', message: error.message }); }
  if (!UTR_RE.test(bankReference)) return res.status(400).json({ success: false, code: 'USD_ACH_BANK_REFERENCE_REQUIRED', message: 'Enter the ODFI/bank reference from official settlement evidence.' });
  if (evidenceNote.length < 10 || evidenceNote.length > 500) return res.status(400).json({ success: false, code: 'USD_ACH_EVIDENCE_REQUIRED', message: 'Official settlement evidence note must be 10-500 characters.' });
  let client;
  try {
    await ensureVaultLedgerSchema();
    await ensureTables();
    client = await db.getClient();
    await client.query('BEGIN');
    const selected = await client.query('SELECT * FROM usd_ach_payout_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payout = selected.rows[0];
    if (!payout) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'USD ACH payout not found.' });
    }
    if (payout.status === 'settled' && payout.bank_reference === bankReference && String(payout.amount) === settledAmount.amount) {
      await client.query('ROLLBACK');
      return res.status(200).json({ success: true, replay: true, request: serializeRequest(payout) });
    }
    if (payout.status !== 'exported') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_PAYOUT_NOT_EXPORTED', message: 'Only a payout in an exported ACH file can be settled.' });
    }
    const batchState = await client.query('SELECT status FROM usd_ach_payout_batches WHERE id = $1 FOR UPDATE', [payout.batch_id]);
    if (!batchState.rows.length || batchState.rows[0].status !== 'file_generated') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_NOT_ACTIVE', message: 'The ACH batch was rejected or resolved; this payout cannot be settled from it.' });
    }
    if (String(payout.amount) !== settledAmount.amount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_SETTLEMENT_AMOUNT_MISMATCH', message: 'Settlement amount must exactly match the exported ACH payout.' });
    }
    const updated = await client.query(
      "UPDATE usd_ach_payout_requests SET status='settled', bank_reference=$2, evidence_note=$3, verified_by_admin_id=$4, settled_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='exported' RETURNING *",
      [payout.id, bankReference, evidenceNote, req.user.id]
    );
    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_PAYOUT_STATE_CONFLICT', message: 'Payout was concurrently updated.' });
    }
    const txn = await client.query("UPDATE transactions SET status='completed' WHERE external_reference=$1 AND type='withdrawal' AND status='processing' RETURNING id", [payout.request_reference]);
    if (!txn.rows.length) {
      const error = new Error('Reserved payout withdrawal transaction is missing.');
      error.code = 'USD_ACH_LEDGER_ROW_MISSING';
      throw error;
    }
    await postBalancedJournal(client, {
      eventType: 'payout_settled',
      sourceType: 'usd_ach_payout',
      sourceId: payout.request_reference,
      currency: 'USD',
      description: 'USD ACH payout settlement confirmed against official bank evidence',
      actorUserId: req.user.id,
      metadata: { bankReference, evidenceNote, verification: 'manual-bank-confirmation' },
      entries: [
        { systemCode: 'OUTBOUND_PAYOUTS_PAYABLE', side: 'debit', amount: String(payout.amount) },
        { systemCode: 'BANK_SETTLEMENT_ASSET', side: 'credit', amount: String(payout.amount) },
      ],
    });
    const remaining = await client.query(
      "SELECT COUNT(*)::int AS pending FROM usd_ach_payout_requests WHERE batch_id = $1 AND status NOT IN ('settled','failed_refunded')",
      [payout.batch_id]
    );
    if (Number(remaining.rows[0].pending) === 0) {
      await client.query("UPDATE usd_ach_payout_batches SET status='reconciled', evidence_note=$2, updated_at=NOW() WHERE id=$1", [payout.batch_id, 'All entries individually reconciled; ' + evidenceNote]);
    }
    await client.query('COMMIT');
    await audit(req.user.id, 'usd_ach_payout_settled', payout.id, { requestReference: payout.request_reference, amount: settledAmount.amount, bankReference }, req);
    try { await createNotification(payout.user_id, { type: 'transaction', title: 'USD bank payout confirmed', message: 'USD ' + settledAmount.amount + ' was reconciled against bank evidence. Reference: ' + payout.request_reference + '.' }); } catch (_) {}
    return res.status(200).json({ success: true, request: serializeRequest(updated.rows[0]) });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    if (error && error.code === '23505') return res.status(409).json({ success: false, code: 'USD_ACH_BANK_REFERENCE_ALREADY_USED', message: 'This bank reference has already been applied to another payout.' });
    console.error('USD ACH payout settlement failed:', error.message);
    return res.status(500).json({ success: false, message: 'Settlement was not recorded; reconcile the batch before retrying.' });
  } finally { if (client) client.release(); }
});

router.post('/api/usd-ach/admin/requests/:id/refund', authenticateToken, requireAdmin, async (req, res) => {
  const evidenceNote = String(req.body && req.body.evidenceNote || '').trim();
  const bankConfirmedNotSent = req.body && req.body.bankConfirmedNotSent === true;
  if (!bankConfirmedNotSent || evidenceNote.length < 10 || evidenceNote.length > 500) {
    return res.status(400).json({ success: false, code: 'USD_ACH_REFUND_EVIDENCE_REQUIRED', message: 'Confirm the ODFI/bank shows the entry was not sent/accepted and provide evidence (10-500 characters).' });
  }
  let client;
  try {
    await ensureVaultLedgerSchema();
    await ensureTables();
    client = await db.getClient();
    await client.query('BEGIN');
    const selected = await client.query('SELECT * FROM usd_ach_payout_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payout = selected.rows[0];
    if (!payout) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'USD ACH payout not found.' });
    }
    if (payout.status === 'failed_refunded') {
      await client.query('ROLLBACK');
      return res.status(200).json({ success: true, replay: true, request: serializeRequest(payout) });
    }
    if (!['reserved','approved','exported'].includes(payout.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_REFUND_NOT_ALLOWED', message: 'This payout is already settled or cannot be refunded from its current status.' });
    }
    if (payout.status === 'exported') {
      const batchState = await client.query('SELECT status FROM usd_ach_payout_batches WHERE id=$1 FOR UPDATE', [payout.batch_id]);
      if (!batchConfirmedNotSent(batchState.rows[0])) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_REJECTION_REQUIRED', message: 'First mark the whole exported batch rejected using official evidence that the ODFI did not accept it; then refund individual entries.' });
      }
    }
    await ensureCustomerLedgerAccount(client, payout.account_id);
    await changeVerifiedAvailableBalance(client, payout.account_id, String(payout.amount), 'credit');
    const accountUpdate = await client.query(
      "UPDATE accounts SET balance=balance+$2, available_balance=available_balance+$2 WHERE id=$1 AND user_id=$3 AND currency='USD' AND status='active' RETURNING (balance-$2) AS balance_before,balance AS balance_after",
      [payout.account_id, String(payout.amount), payout.user_id]
    );
    if (!accountUpdate.rows.length) {
      const error = new Error('USD account is not active; no refund was posted.');
      error.code = 'USD_ACH_ACCOUNT_NOT_ACTIVE';
      throw error;
    }
    await client.query(
      "UPDATE transactions SET status='failed' WHERE external_reference=$1 AND type='withdrawal' AND status='processing'",
      [payout.request_reference]
    );
    const refundReference = payout.request_reference + '-REFUND';
    await client.query(
      "INSERT INTO transactions (account_id,user_id,type,status,amount,currency,balance_before,balance_after,description,category,external_reference,metadata) VALUES ($1,$2,'refund','completed',$3,'USD',$4,$5,$6,'transfer',$7,$8::jsonb)",
      [payout.account_id,payout.user_id,Number(payout.amount),Number(accountUpdate.rows[0].balance_before),Number(accountUpdate.rows[0].balance_after),'USD ACH payout refund ' + payout.request_reference,refundReference,JSON.stringify({rail:'vaultbank-native-ach-file-export',reason:evidenceNote,bankConfirmedNotSent:true})]
    );
    const updated = await client.query(
      "UPDATE usd_ach_payout_requests SET status='failed_refunded', evidence_note=$2, verified_by_admin_id=$3, failed_refunded_at=NOW(), updated_at=NOW() WHERE id=$1 AND status IN ('reserved','approved','exported') RETURNING *",
      [payout.id,evidenceNote,req.user.id]
    );
    if (!updated.rows.length) {
      const error = new Error('USD ACH payout changed state during refund.');
      error.code = 'USD_ACH_REFUND_STATE_CONFLICT';
      throw error;
    }
    await postBalancedJournal(client, {
      eventType: 'payout_refunded',
      sourceType: 'usd_ach_payout',
      sourceId: refundReference,
      currency: 'USD',
      description: 'USD ACH payout refund after confirmed no-send/rejection evidence',
      actorUserId: req.user.id,
      metadata: { originalRequestReference: payout.request_reference, evidenceNote, bankConfirmedNotSent: true },
      entries: [
        { systemCode: 'OUTBOUND_PAYOUTS_PAYABLE', side: 'debit', amount: String(payout.amount) },
        { accountId: payout.account_id, side: 'credit', amount: String(payout.amount) },
      ],
    });
    const pending = await client.query(
      "SELECT COUNT(*)::int AS pending FROM usd_ach_payout_requests WHERE batch_id=$1 AND status NOT IN ('settled','failed_refunded')",
      [payout.batch_id]
    );
    if (payout.batch_id && Number(pending.rows[0].pending) === 0) {
      await client.query("UPDATE usd_ach_payout_batches SET status='reconciled', evidence_note=$2, updated_at=NOW() WHERE id=$1", [payout.batch_id, 'All entries reconciled: ' + evidenceNote]);
    }
    await client.query('COMMIT');
    await audit(req.user.id, 'usd_ach_payout_refunded', payout.id, { requestReference: payout.request_reference, amount: String(payout.amount), evidenceNote }, req);
    return res.status(200).json({ success: true, request: serializeRequest(updated.rows[0]) });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    console.error('USD ACH payout refund failed:', error.message);
    return res.status(500).json({ success: false, message: 'Refund was not confirmed; check the ledger and bank evidence before retrying.' });
  } finally { if (client) client.release(); }
});

router.post('/api/usd-ach/admin/batches/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  const evidenceNote = String(req.body && req.body.evidenceNote || '').trim();
  if (req.body.confirmedNotAccepted !== true || evidenceNote.length < 10 || evidenceNote.length > 500) {
    return res.status(400).json({ success: false, code: 'USD_ACH_BATCH_REJECTION_EVIDENCE_REQUIRED', message: 'Confirm the ODFI rejected/did not accept this file and record the official evidence (10-500 characters).' });
  }
  let client;
  try {
    await ensureTables();
    client = await db.getClient();
    await client.query('BEGIN');
    const selected = await client.query('SELECT * FROM usd_ach_payout_batches WHERE id=$1 FOR UPDATE', [req.params.id]);
    const batch = selected.rows[0];
    if (!batch) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'ACH batch not found.' });
    }
    if (batch.status !== 'file_generated') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_NOT_REJECTABLE', message: 'Only a not-yet-reconciled generated batch can be marked rejected.' });
    }
    const changed = await client.query(
      "UPDATE usd_ach_payout_batches SET status='rejected', evidence_note=$2, updated_at=NOW() WHERE id=$1 AND status='file_generated' RETURNING *",
      [batch.id, evidenceNote]
    );
    if (!changed.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'USD_ACH_BATCH_STATE_CONFLICT', message: 'The batch was concurrently resolved.' });
    }
    await client.query('COMMIT');
    await audit(req.user.id, 'usd_ach_batch_rejected', batch.id, { batchReference: batch.batch_reference, evidenceNote }, req);
    return res.status(200).json({ success: true, batch: serializeBatch(changed.rows[0]), message: 'The file can no longer be downloaded. Refund individual reservations only after the ODFI confirms no entries were sent or accepted.' });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    console.error('USD ACH batch rejection failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not record ACH batch rejection.' });
  } finally { if (client) client.release(); }
});

module.exports = router;
module.exports.readiness = readiness;
module.exports.ensureTables = ensureTables;
module.exports.parsePilotAmount = parsePilotAmount;
