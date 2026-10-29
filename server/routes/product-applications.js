'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { applicationLimiter } = require('../middleware/rateLimiter');
const { db, isDemo, createAuditLog, createNotification } = require('../config/database');

const KEY_RE = /^[A-Za-z0-9._:-]{8,100}$/;
const CURRENCIES = ['INR', 'USD'];
const CARD_TYPES = ['debit', 'credit'];
const CARD_STATUSES = ['needs_verification', 'received', 'under_review', 'waiting_for_issuer', 'closed'];
const LOAN_STATUSES = ['needs_verification', 'received', 'under_review', 'funding_required', 'declined', 'closed'];
const CARD_STATUS_LABELS = {
    needs_verification: 'needs verification',
    received: 'received',
    under_review: 'under review',
    waiting_for_issuer: 'waiting for an issuer connection',
    closed: 'closed',
};
const LOAN_STATUS_LABELS = {
    needs_verification: 'needs verification',
    received: 'received',
    under_review: 'under review',
    funding_required: 'awaiting a funded lender',
    declined: 'declined',
    closed: 'closed',
};
let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  if (isDemo) {
    const error = new Error('Product applications require persistent PostgreSQL.');
    error.code = 'PRODUCT_APPLICATIONS_REQUIRES_POSTGRES';
    throw error;
  }
  await db.ensureConnection();
  await db.query("CREATE TABLE IF NOT EXISTS card_program_requests (id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_type TEXT NOT NULL CHECK (card_type IN ('debit','credit')), currency TEXT NOT NULL CHECK (currency IN ('INR','USD')), status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('needs_verification','received','under_review','waiting_for_issuer','closed')), idempotency_key TEXT NOT NULL, review_note TEXT, reviewed_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,idempotency_key))");
  await db.query("CREATE INDEX IF NOT EXISTS card_program_requests_status_created_idx ON card_program_requests (status, created_at)");
  await db.query("CREATE TABLE IF NOT EXISTS loan_applications (id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount NUMERIC(15,2) NOT NULL CHECK (amount > 0), currency TEXT NOT NULL CHECK (currency IN ('INR','USD')), term_months INTEGER NOT NULL CHECK (term_months IN (3,6,12,24,36,60)), purpose TEXT NOT NULL CHECK (char_length(purpose) BETWEEN 8 AND 300), status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('needs_verification','received','under_review','funding_required','declined','closed')), idempotency_key TEXT NOT NULL, review_note TEXT, reviewed_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,idempotency_key))");
  await db.query("CREATE INDEX IF NOT EXISTS loan_applications_status_created_idx ON loan_applications (status, created_at)");
  schemaReady = true;
}

function eligibilityStatus(user) {
  return user && user.email_verified === true && user.kyc_status === 'verified'
    ? 'received'
    : 'needs_verification';
}

function readKey(req, res) {
  const key = String(req.headers['idempotency-key'] || '').trim();
  if (!KEY_RE.test(key)) {
    res.status(400).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Provide an Idempotency-Key between 8 and 100 safe characters.' });
    return null;
  }
  return key;
}

function cardDto(row, admin = false) {
  const value = { id: String(row.id), cardType: row.card_type, currency: row.currency, status: row.status, reviewNote: row.review_note || null, createdAt: row.created_at, updatedAt: row.updated_at };
  if (admin) value.customer = { userId: row.user_id, fullName: row.full_name || null, email: row.email || null, emailVerified: row.email_verified === true, kycStatus: row.kyc_status || 'unknown' };
  return value;
}

function loanDto(row, admin = false) {
  const value = { id: String(row.id), amount: Number(row.amount), currency: row.currency, termMonths: Number(row.term_months), purpose: row.purpose, status: row.status, reviewNote: row.review_note || null, createdAt: row.created_at, updatedAt: row.updated_at };
  if (admin) value.customer = { userId: row.user_id, fullName: row.full_name || null, email: row.email || null, emailVerified: row.email_verified === true, kycStatus: row.kyc_status || 'unknown' };
  return value;
}

async function audit(req, action, type, id, details) {
  try {
    // card_program_requests and loan_applications use BIGSERIAL ids, while
    // audit_logs.resource_id is UUID. Store the numeric application id in
    // details instead of writing an invalid UUID (which failed silently).
    await createAuditLog({
      userId: req.user.id,
      action,
      resourceType: type,
      resourceId: null,
      details: { ...details, requestId: String(id) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (error) {
    console.warn('Product application audit write failed:', error && error.code ? error.code : 'audit-error');
  }
}

async function notifyApplicant(userId, { title, message, metadata }) {
  try {
    await createNotification(userId, { type: 'info', title, message, metadata });
  } catch (error) {
    console.warn('Product application notification failed:', error && error.code ? error.code : 'notify-error');
  }
}

function parseAmount(value, currency) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  const min = currency === 'INR' ? 1000 : 100;
  const max = currency === 'INR' ? 50000000 : 500000;
  if (!Number.isFinite(amount) || amount < min || amount > max) return null;
  return amount.toFixed(2);
}

router.get('/api/card-program/requests', authenticateToken, applicationLimiter, async (req, res) => {
  try {
    await ensureSchema();
    const result = await db.query('SELECT * FROM card_program_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    return res.status(200).json({ success: true, requests: result.rows.map((row) => cardDto(row)), cardNetworkIssuingAvailable: false });
  } catch (error) {
    console.error('Card request list failed:', error && error.code ? error.code : 'query-error');
    return res.status(503).json({ success: false, code: 'CARD_PROGRAM_UNAVAILABLE', message: 'Card requests could not be loaded.' });
  }
});

router.post('/api/card-program/requests', authenticateToken, applicationLimiter, async (req, res) => {
  const key = readKey(req, res);
  if (!key) return;
  const type = String((req.body && req.body.cardType) || '').trim().toLowerCase();
  const currency = String((req.body && req.body.currency) || '').trim().toUpperCase();
  if (!CARD_TYPES.includes(type) || !CURRENCIES.includes(currency)) {
    return res.status(400).json({ success: false, code: 'CARD_REQUEST_INVALID', message: 'Choose debit or credit card interest and INR or USD.' });
  }
  try {
    await ensureSchema();
    const status = eligibilityStatus(req.user);
    const inserted = await db.query("INSERT INTO card_program_requests (user_id, card_type, currency, status, idempotency_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING *", [req.user.id, type, currency, status, key]);
    let row = inserted.rows[0];
    let replay = false;
    if (!row) {
      const existing = await db.query('SELECT * FROM card_program_requests WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1', [req.user.id, key]);
      row = existing.rows[0];
      if (!row || row.card_type !== type || row.currency !== currency) {
        return res.status(409).json({ success: false, code: 'IDEMPOTENCY_CONFLICT', message: 'This key belongs to a different card request. No second request was created.' });
      }
      replay = true;
    } else {
      await audit(req, 'card_program_request_created', 'card_program_request', row.id, { cardType: type, currency, status });
    }
    return res.status(replay ? 200 : 201).json({
      success: true, replay, request: cardDto(row), cardNetworkIssuingAvailable: false,
      message: replay ? 'This request was already recorded.' : status === 'needs_verification'
        ? 'Request saved. Verify your email and complete identity verification before review.'
        : 'Request saved for review. No card has been issued and no card number was created.',
    });
  } catch (error) {
    console.error('Card request create failed:', error && error.code ? error.code : 'insert-error');
    return res.status(503).json({ success: false, code: 'CARD_PROGRAM_UNAVAILABLE', message: 'Card request could not be saved. No card was issued.' });
  }
});

router.get('/api/loan-applications', authenticateToken, applicationLimiter, async (req, res) => {
  try {
    await ensureSchema();
    const result = await db.query('SELECT * FROM loan_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    return res.status(200).json({ success: true, applications: result.rows.map((row) => loanDto(row)), loanFundingAvailable: false });
  } catch (error) {
    console.error('Loan application list failed:', error && error.code ? error.code : 'query-error');
    return res.status(503).json({ success: false, code: 'LOAN_APPLICATIONS_UNAVAILABLE', message: 'Loan applications could not be loaded.' });
  }
});

router.post('/api/loan-applications', authenticateToken, applicationLimiter, async (req, res) => {
  const key = readKey(req, res);
  if (!key) return;
  const currency = String((req.body && req.body.currency) || '').trim().toUpperCase();
  const amount = parseAmount(req.body && req.body.amount, currency);
  const termMonths = Number.parseInt(String((req.body && req.body.termMonths) || ''), 10);
  const purpose = String((req.body && req.body.purpose) || '').trim();
  if (!CURRENCIES.includes(currency) || amount == null || ![3, 6, 12, 24, 36, 60].includes(termMonths) || purpose.length < 8 || purpose.length > 300) {
    return res.status(400).json({ success: false, code: 'LOAN_APPLICATION_INVALID', message: 'Enter a valid INR/USD amount, supported term, and purpose between 8 and 300 characters.' });
  }
  try {
    await ensureSchema();
    const status = eligibilityStatus(req.user);
    const inserted = await db.query('INSERT INTO loan_applications (user_id, amount, currency, term_months, purpose, status, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING *', [req.user.id, amount, currency, termMonths, purpose, status, key]);
    let row = inserted.rows[0];
    let replay = false;
    if (!row) {
      const existing = await db.query('SELECT * FROM loan_applications WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1', [req.user.id, key]);
      row = existing.rows[0];
      if (!row || Number(row.amount).toFixed(2) !== amount || row.currency !== currency || Number(row.term_months) !== termMonths || row.purpose !== purpose) {
        return res.status(409).json({ success: false, code: 'IDEMPOTENCY_CONFLICT', message: 'This key belongs to a different loan application. No second application was created.' });
      }
      replay = true;
    } else {
      await audit(req, 'loan_application_created', 'loan_application', row.id, { amount, currency, termMonths, status });
    }
    return res.status(replay ? 200 : 201).json({
      success: true, replay, application: loanDto(row), loanFundingAvailable: false,
      message: replay ? 'This application was already recorded.' : status === 'needs_verification'
        ? 'Application saved. Verify your email and complete identity verification before review.'
        : 'Application saved for review. This is not a loan approval, offer, credit limit, or promise of disbursement.',
    });
  } catch (error) {
    console.error('Loan application create failed:', error && error.code ? error.code : 'insert-error');
    return res.status(503).json({ success: false, code: 'LOAN_APPLICATIONS_UNAVAILABLE', message: 'Loan application could not be saved. No loan was approved or paid out.' });
  }
});

router.get('/api/admin/card-program/requests', authenticateToken, requireAdmin, applicationLimiter, async (req, res) => {
  try {
    await ensureSchema();
    const result = await db.query("SELECT r.*, u.full_name, u.email, u.email_verified, u.kyc_status FROM card_program_requests r JOIN users u ON u.id = r.user_id WHERE r.status <> 'closed' ORDER BY r.created_at ASC LIMIT 100");
    return res.status(200).json({ success: true, requests: result.rows.map((row) => cardDto(row, true)) });
  } catch (error) {
    console.error('Admin card queue failed:', error && error.code ? error.code : 'query-error');
    return res.status(503).json({ success: false, message: 'Card request queue unavailable.' });
  }
});

router.patch('/api/admin/card-program/requests/:id/status', authenticateToken, requireAdmin, applicationLimiter, async (req, res) => {
  const status = String((req.body && req.body.status) || '').trim().toLowerCase();
  const note = String((req.body && req.body.note) || '').trim();
  if (!CARD_STATUSES.includes(status) || status === 'received' || note.length < 10 || note.length > 500) {
    return res.status(400).json({ success: false, code: 'CARD_REVIEW_INVALID', message: 'Choose a review status and provide a 10–500 character note. Issuance cannot be marked complete.' });
  }
  try {
    await ensureSchema();
    if (status === 'under_review' || status === 'waiting_for_issuer') {
      const eligibility = await db.query(
        'SELECT u.email_verified, u.kyc_status FROM users u JOIN card_program_requests r ON r.user_id = u.id WHERE r.id = $1 LIMIT 1',
        [req.params.id]
      );
      const customer = eligibility.rows[0];
      if (!customer) return res.status(404).json({ success: false, message: 'Card request not found.' });
      if (customer.email_verified !== true || customer.kyc_status !== 'verified') {
        return res.status(403).json({
          success: false,
          code: 'CUSTOMER_VERIFICATION_REQUIRED',
          message: 'Verify email and complete identity verification before card requests can move into issuer review.',
        });
      }
    }
    const result = await db.query("UPDATE card_program_requests SET status = $2, review_note = $3, reviewed_by = $4, updated_at = NOW() WHERE id = $1 AND status <> 'closed' RETURNING *", [req.params.id, status, note, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Open card request not found.' });
    await audit(req, 'card_program_request_reviewed', 'card_program_request', result.rows[0].id, { status });
    await notifyApplicant(result.rows[0].user_id, {
      title: 'Card request updated',
      message: `Your card request is now ${CARD_STATUS_LABELS[status]}. ${note}`,
      metadata: { requestId: result.rows[0].id, status },
    });
    return res.status(200).json({ success: true, request: cardDto(result.rows[0]) });
  } catch (error) {
    console.error('Admin card review failed:', error && error.code ? error.code : 'update-error');
    return res.status(503).json({ success: false, message: 'Card request review could not be saved.' });
  }
});

router.get('/api/admin/loan-applications', authenticateToken, requireAdmin, applicationLimiter, async (req, res) => {
  try {
    await ensureSchema();
    const result = await db.query("SELECT a.*, u.full_name, u.email, u.email_verified, u.kyc_status FROM loan_applications a JOIN users u ON u.id = a.user_id WHERE a.status NOT IN ('closed','declined') ORDER BY a.created_at ASC LIMIT 100");
    return res.status(200).json({ success: true, applications: result.rows.map((row) => loanDto(row, true)) });
  } catch (error) {
    console.error('Admin loan queue failed:', error && error.code ? error.code : 'query-error');
    return res.status(503).json({ success: false, message: 'Loan application queue unavailable.' });
  }
});

router.patch('/api/admin/loan-applications/:id/status', authenticateToken, requireAdmin, applicationLimiter, async (req, res) => {
  const status = String((req.body && req.body.status) || '').trim().toLowerCase();
  const note = String((req.body && req.body.note) || '').trim();
  if (!LOAN_STATUSES.includes(status) || status === 'received' || note.length < 10 || note.length > 500) {
    return res.status(400).json({ success: false, code: 'LOAN_REVIEW_INVALID', message: 'Choose a review status and provide a 10–500 character note. This pilot cannot mark a loan approved or disbursed.' });
  }
  try {
    await ensureSchema();
    if (status === 'under_review' || status === 'funding_required') {
      const eligibility = await db.query(
        'SELECT u.email_verified, u.kyc_status FROM users u JOIN loan_applications a ON a.user_id = u.id WHERE a.id = $1 LIMIT 1',
        [req.params.id]
      );
      const customer = eligibility.rows[0];
      if (!customer) return res.status(404).json({ success: false, message: 'Loan application not found.' });
      if (customer.email_verified !== true || customer.kyc_status !== 'verified') {
        return res.status(403).json({
          success: false,
          code: 'CUSTOMER_VERIFICATION_REQUIRED',
          message: 'Verify email and complete identity verification before loan applications can move into review.',
        });
      }
    }
    const result = await db.query("UPDATE loan_applications SET status = $2, review_note = $3, reviewed_by = $4, updated_at = NOW() WHERE id = $1 AND status NOT IN ('closed','declined') RETURNING *", [req.params.id, status, note, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Open loan application not found.' });
    await audit(req, 'loan_application_reviewed', 'loan_application', result.rows[0].id, { status });
    await notifyApplicant(result.rows[0].user_id, {
      title: 'Loan application updated',
      message: `Your loan application is now ${LOAN_STATUS_LABELS[status]}. ${note}`,
      metadata: { applicationId: result.rows[0].id, status },
    });
    return res.status(200).json({ success: true, application: loanDto(result.rows[0]) });
  } catch (error) {
    console.error('Admin loan review failed:', error && error.code ? error.code : 'update-error');
    return res.status(503).json({ success: false, message: 'Loan application review could not be saved.' });
  }
});

module.exports = router;
