'use strict';

const crypto = require('crypto');
const { db } = require('../../config/db');

const DDL = `
CREATE TABLE IF NOT EXISTS grid_provider_customers (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    provider_customer_id TEXT NOT NULL UNIQUE,
    customer_type TEXT NOT NULL,
    status TEXT,
    kyc_status TEXT,
    region TEXT,
    currencies TEXT[] NOT NULL DEFAULT '{}',
    consents JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grid_internal_accounts (
    provider_account_id TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    currency TEXT NOT NULL,
    status TEXT,
    type TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grid_internal_accounts_user_currency_idx
    ON grid_internal_accounts (user_id, currency);

CREATE TABLE IF NOT EXISTS grid_beneficiaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider_external_account_id TEXT NOT NULL UNIQUE,
    currency TEXT NOT NULL,
    account_type TEXT NOT NULL,
    beneficiary_name TEXT NOT NULL,
    details_encrypted TEXT NOT NULL,
    destination_fingerprint TEXT NOT NULL,
    details_masked TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, destination_fingerprint)
);
CREATE INDEX IF NOT EXISTS grid_beneficiaries_user_idx ON grid_beneficiaries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grid_quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    beneficiary_id UUID REFERENCES grid_beneficiaries(id) ON DELETE SET NULL,
    provider_quote_id TEXT NOT NULL UNIQUE,
    provider_transaction_id TEXT,
    source_account_id TEXT NOT NULL,
    destination_account_id TEXT NOT NULL,
    sending_currency TEXT NOT NULL,
    receiving_currency TEXT NOT NULL,
    sending_amount_minor BIGINT NOT NULL,
    receiving_amount_minor BIGINT NOT NULL,
    exchange_rate TEXT NOT NULL,
    fees JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grid_quotes_user_idx ON grid_quotes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grid_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    quote_id UUID NOT NULL REFERENCES grid_quotes(id) ON DELETE RESTRICT,
    provider_transaction_id TEXT UNIQUE,
    provider_quote_id TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    reservation_source_id TEXT NOT NULL UNIQUE,
    amount NUMERIC(15,2) NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserving'
        CHECK (status IN ('reserving','reserved','executing','processing','completed','failed','refunded','reconciliation_required')),
    failure_reason TEXT,
    settlement_reference TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS grid_payments_user_idx ON grid_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS grid_payments_stuck_idx ON grid_payments (status, created_at);

CREATE TABLE IF NOT EXISTS grid_webhook_deliveries (
    provider_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    raw_body_sha256 TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'received',
    error TEXT
);

CREATE TABLE IF NOT EXISTS grid_reconciliation_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID REFERENCES grid_payments(id) ON DELETE SET NULL,
    provider_transaction_id TEXT,
    source TEXT NOT NULL,
    observed_status TEXT,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grid_reconciliation_payment_idx
    ON grid_reconciliation_records (payment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grid_capabilities (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider_config JSONB NOT NULL,
    supported_currencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL
);
`;

let schemaPromise = null;

async function ensureTables() {
  if (!schemaPromise) {
    schemaPromise = db.query(DDL).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function json(value) {
  return JSON.stringify(value || {});
}

async function getCapabilities() {
  const result = await db.query('SELECT * FROM grid_capabilities WHERE id = 1');
  return result.rows[0] || null;
}

async function saveCapabilities({ providerConfig, supportedCurrencies, agreements, fetchedAt }) {
  await db.query(
    `INSERT INTO grid_capabilities (id, provider_config, supported_currencies, agreements, fetched_at)
     VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE SET provider_config = EXCLUDED.provider_config,
       supported_currencies = EXCLUDED.supported_currencies,
       agreements = EXCLUDED.agreements, fetched_at = EXCLUDED.fetched_at`,
    [json(providerConfig), json(supportedCurrencies), json(agreements), fetchedAt || new Date().toISOString()],
  );
}

async function getCustomer(userId) {
  const result = await db.query('SELECT * FROM grid_provider_customers WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function saveCustomer(row) {
  const result = await db.query(
    `INSERT INTO grid_provider_customers
      (user_id, provider_customer_id, customer_type, status, kyc_status, region, currencies, consents)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET provider_customer_id = EXCLUDED.provider_customer_id,
       customer_type = EXCLUDED.customer_type, status = EXCLUDED.status,
       kyc_status = EXCLUDED.kyc_status, region = EXCLUDED.region,
       currencies = EXCLUDED.currencies, consents = EXCLUDED.consents, updated_at = NOW()
     RETURNING *`,
    [row.userId, row.providerCustomerId, row.customerType, row.status || null,
      row.kycStatus || null, row.region || null, row.currencies || [], json(row.consents || [])],
  );
  return result.rows[0];
}

async function saveInternalAccount(row) {
  await db.query(
    `INSERT INTO grid_internal_accounts (provider_account_id, user_id, currency, status, type)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider_account_id) DO UPDATE SET status = EXCLUDED.status,
       type = EXCLUDED.type, updated_at = NOW()`,
    [row.providerAccountId, row.userId || null, row.currency, row.status || null, row.type || null],
  );
}

async function listInternalAccounts(userId) {
  const result = await db.query(
    'SELECT * FROM grid_internal_accounts WHERE user_id = $1 ORDER BY currency',
    [userId],
  );
  return result.rows;
}

async function saveBeneficiary(row) {
  const result = await db.query(
    `INSERT INTO grid_beneficiaries
      (id, user_id, provider_external_account_id, currency, account_type, beneficiary_name,
       details_encrypted, destination_fingerprint, details_masked, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id, destination_fingerprint) DO UPDATE SET
       provider_external_account_id = EXCLUDED.provider_external_account_id,
       status = EXCLUDED.status, updated_at = NOW()
     RETURNING *`,
    [row.id || crypto.randomUUID(), row.userId, row.providerExternalAccountId, row.currency,
      row.accountType, row.beneficiaryName, row.detailsEncrypted, row.destinationFingerprint,
      row.detailsMasked, row.status || 'PENDING'],
  );
  return result.rows[0];
}

async function listBeneficiaries(userId) {
  const result = await db.query(
    `SELECT id, user_id, currency, account_type, beneficiary_name, details_masked,
            status, created_at, updated_at
     FROM grid_beneficiaries WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

async function getBeneficiary(userId, id) {
  const result = await db.query(
    'SELECT * FROM grid_beneficiaries WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return result.rows[0] || null;
}

async function saveQuote(row) {
  const result = await db.query(
    `INSERT INTO grid_quotes
      (id, user_id, beneficiary_id, provider_quote_id, provider_transaction_id, source_account_id,
       destination_account_id, sending_currency, receiving_currency, sending_amount_minor,
       receiving_amount_minor, exchange_rate, fees, status, expires_at, idempotency_key, provider_response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17::jsonb)
     ON CONFLICT (provider_quote_id) DO UPDATE SET status = EXCLUDED.status,
       provider_transaction_id = EXCLUDED.provider_transaction_id,
       provider_response = EXCLUDED.provider_response, updated_at = NOW()
     RETURNING *`,
    [row.id || crypto.randomUUID(), row.userId, row.beneficiaryId || null, row.providerQuoteId,
      row.providerTransactionId || null, row.sourceAccountId, row.destinationAccountId,
      row.sendingCurrency, row.receivingCurrency, row.sendingAmountMinor, row.receivingAmountMinor,
      String(row.exchangeRate), json(row.fees), row.status, row.expiresAt, row.idempotencyKey,
      json(row.providerResponse)],
  );
  return result.rows[0];
}

async function getQuote(userId, id) {
  const result = await db.query('SELECT * FROM grid_quotes WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0] || null;
}

async function getQuoteByProviderId(providerQuoteId) {
  const result = await db.query('SELECT * FROM grid_quotes WHERE provider_quote_id = $1', [providerQuoteId]);
  return result.rows[0] || null;
}

async function createPayment(row, client) {
  const executor = client || db;
  const result = await executor.query(
    `INSERT INTO grid_payments
      (id, user_id, account_id, quote_id, provider_transaction_id, provider_quote_id, reference,
       idempotency_key, reservation_source_id, amount, currency, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [row.id || crypto.randomUUID(), row.userId, row.accountId, row.quoteId,
      row.providerTransactionId || null, row.providerQuoteId, row.reference, row.idempotencyKey,
      row.reservationSourceId, row.amount, row.currency, row.status || 'reserving', json(row.metadata)],
  );
  return result.rows[0] || null;
}

async function getPayment(userId, id) {
  const result = await db.query('SELECT * FROM grid_payments WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0] || null;
}

async function getPaymentByReference(reference) {
  const result = await db.query('SELECT * FROM grid_payments WHERE reference = $1', [reference]);
  return result.rows[0] || null;
}

async function getPaymentByIdempotencyKey(idempotencyKey) {
  const result = await db.query('SELECT * FROM grid_payments WHERE idempotency_key = $1', [idempotencyKey]);
  return result.rows[0] || null;
}

async function getPaymentById(id) {
  const result = await db.query('SELECT * FROM grid_payments WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function getPaymentByProviderTransactionId(providerTransactionId) {
  const result = await db.query(
    'SELECT * FROM grid_payments WHERE provider_transaction_id = $1',
    [providerTransactionId],
  );
  return result.rows[0] || null;
}

async function listPayments(userId) {
  const result = await db.query(
    'SELECT * FROM grid_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [userId],
  );
  return result.rows;
}

async function listAllPayments(status) {
  const result = await db.query(
    `SELECT * FROM grid_payments
     WHERE ($1::text IS NULL OR status = $1) AND created_at > NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC LIMIT 200`,
    [status || null],
  );
  return result.rows;
}

async function updatePayment(id, patch, client) {
  const executor = client || db;
  const allowed = ['status', 'provider_transaction_id', 'failure_reason', 'settlement_reference', 'metadata'];
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
  if (!entries.length) return null;
  const sets = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ');
  const values = [id, ...entries.map(([, value]) => value)];
  const result = await executor.query(
    `UPDATE grid_payments SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

async function recordWebhookDelivery({ eventId, eventType, payload, rawSha256 }) {
  const result = await db.query(
    `INSERT INTO grid_webhook_deliveries
      (provider_event_id, event_type, payload, raw_body_sha256)
     VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (provider_event_id) DO NOTHING RETURNING provider_event_id`,
    [eventId, eventType, json(payload), rawSha256],
  );
  return result.rowCount > 0;
}

async function markWebhookProcessed(eventId, status, error) {
  await db.query(
    `UPDATE grid_webhook_deliveries SET status = $2, processed_at = NOW(), error = $3
     WHERE provider_event_id = $1`,
    [eventId, status || 'processed', error || null],
  );
}

async function listWebhookDeliveries(limit = 100) {
  const result = await db.query(
    'SELECT provider_event_id, event_type, status, error, received_at, processed_at FROM grid_webhook_deliveries ORDER BY received_at DESC LIMIT $1',
    [Math.min(Number(limit) || 100, 500)],
  );
  return result.rows;
}

async function recordReconciliation(row) {
  const result = await db.query(
    `INSERT INTO grid_reconciliation_records
      (payment_id, provider_transaction_id, source, observed_status, evidence, resolution, resolved_by, resolved_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
    [row.paymentId || null, row.providerTransactionId || null, row.source, row.observedStatus || null,
      json(row.evidence), row.resolution || null, row.resolvedBy || null, row.resolvedAt || null],
  );
  return result.rows[0];
}

async function listReconciliation(paymentId) {
  const result = await db.query(
    `SELECT * FROM grid_reconciliation_records WHERE payment_id = $1 ORDER BY created_at DESC`,
    [paymentId],
  );
  return result.rows;
}

module.exports = {
  DDL,
  ensureTables,
  getCapabilities,
  saveCapabilities,
  getCustomer,
  saveCustomer,
  saveInternalAccount,
  listInternalAccounts,
  saveBeneficiary,
  listBeneficiaries,
  getBeneficiary,
  saveQuote,
  getQuote,
  getQuoteByProviderId,
  createPayment,
  getPayment,
  getPaymentByReference,
  getPaymentByIdempotencyKey,
  getPaymentById,
  getPaymentByProviderTransactionId,
  listPayments,
  listAllPayments,
  updatePayment,
  recordWebhookDelivery,
  markWebhookProcessed,
  listWebhookDeliveries,
  recordReconciliation,
  listReconciliation,
};
