'use strict';

const crypto = require('crypto');
const { GridError } = require('./errors');
const store = require('./store');

/**
 * Verify Grid's X-Grid-Signature over the EXACT raw request bytes.
 * Signature is either JSON {"v":1,"s":"<base64>"} or plain base64, and is an
 * ECDSA P-256 (secp256r1) signature of SHA-256 over the body, verified with the
 * platform's SPKI PEM public key.
 */
function verifyGridSignature({ rawBody, signatureHeader, publicKey }) {
  if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new GridError('GRID_WEBHOOK_EMPTY_BODY', 'Webhook body must be preserved as raw bytes.');
  }
  if (rawBody.length > 2 * 1024 * 1024) {
    throw new GridError('GRID_WEBHOOK_TOO_LARGE', 'Webhook body exceeds the size limit.');
  }
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    throw new GridError('GRID_WEBHOOK_SIGNATURE_MISSING', 'X-Grid-Signature is required.');
  }
  if (!publicKey || !publicKey.includes('BEGIN PUBLIC KEY')) {
    throw new GridError('GRID_WEBHOOK_KEY_NOT_CONFIGURED', 'Grid webhook public key is not configured.');
  }

  let signature;
  try {
    const parsed = JSON.parse(signatureHeader);
    if (!Number.isInteger(parsed?.v) || typeof parsed.s !== 'string') {
      throw new Error('invalid header shape');
    }
    signature = Buffer.from(parsed.s, 'base64');
  } catch {
    signature = Buffer.from(signatureHeader, 'base64');
  }
  if (!signature.length || signature.length > 256) {
    throw new GridError('GRID_WEBHOOK_SIGNATURE_INVALID', 'Signature encoding is invalid.');
  }

  const verifier = crypto.createVerify('SHA256');
  verifier.update(rawBody);
  verifier.end();
  let valid = false;
  try {
    valid = verifier.verify({ key: publicKey, format: 'pem', type: 'spki' }, signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new GridError('GRID_WEBHOOK_SIGNATURE_INVALID', 'Webhook signature did not verify.');
  }
}

function parseWebhook(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new GridError('GRID_WEBHOOK_MALFORMED', 'Webhook payload is not valid JSON.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new GridError('GRID_WEBHOOK_MALFORMED', 'Webhook payload must be an object.');
  }
  if (typeof payload.id !== 'string' || !payload.id.trim()) {
    throw new GridError('GRID_WEBHOOK_MALFORMED', 'Webhook event id is required.');
  }
  if (typeof payload.type !== 'string' || !payload.type.trim()) {
    throw new GridError('GRID_WEBHOOK_MALFORMED', 'Webhook event type is required.');
  }
  if (payload.type.length > 120 || payload.id.length > 255) {
    throw new GridError('GRID_WEBHOOK_MALFORMED', 'Webhook event identifiers are too long.');
  }
  return payload;
}

const HANDLED_PREFIXES = ['OUTGOING_PAYMENT.', 'INCOMING_PAYMENT.'];

function createWebhookService({ config, data = store, payments, logger = () => {} }) {
  async function handle({ rawBody, signatureHeader }) {
    verifyGridSignature({
      rawBody,
      signatureHeader,
      publicKey: config.webhookPublicKey,
    });
    const payload = parseWebhook(rawBody);
    const sha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
    const stored = await data.recordWebhookDelivery({
      eventId: payload.id,
      eventType: payload.type,
      payload,
      rawSha256: sha256,
    });
    if (!stored) {
      // Grid does not retry 409s — a duplicate delivery is already durable.
      logger({ event: 'grid.webhook_duplicate', eventId: payload.id, eventType: payload.type });
      return { status: 409, body: { received: true, duplicate: true }, eventId: payload.id };
    }

    const handled = HANDLED_PREFIXES.some((prefix) => payload.type.startsWith(prefix));
    if (!handled) {
      await data.markWebhookProcessed(payload.id, 'ignored');
      logger({ event: 'grid.webhook_unknown', eventId: payload.id, eventType: payload.type });
      return { status: 200, body: { received: true, ignored: true }, eventId: payload.id };
    }

    try {
      const result = await payments.applyProviderEvent(payload);
      await data.markWebhookProcessed(payload.id, 'processed');
      logger({ event: 'grid.webhook_processed', eventId: payload.id, eventType: payload.type, outcome: result?.outcome || 'recorded' });
      return { status: 200, body: { received: true }, eventId: payload.id };
    } catch (error) {
      const message = String(error?.message || 'processing failed').slice(0, 500);
      await data.markWebhookProcessed(payload.id, 'failed', message);
      logger({ event: 'grid.webhook_processing_failed', eventId: payload.id, eventType: payload.type });
      // A 5xx tells Grid to redeliver; dedupe keeps the original durable record.
      return { status: 500, body: { received: false, retry: true }, eventId: payload.id };
    }
  }

  return { handle, verifyGridSignature, parseWebhook };
}

module.exports = { createWebhookService, verifyGridSignature, parseWebhook };
