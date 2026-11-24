'use strict';

const express = require('express');
const crypto = require('crypto');
const { db } = require('../config/database');
const {
  GridWebhookSignatureError,
  verifyGridWebhookSignature,
  normalizeGridWebhook,
  chooseGridWebhookDisposition,
} = require('../services/lightsparkGridWebhook');

const router = express.Router();
const ENDPOINT = '/api/webhooks/lightspark/grid';
const MAX_WEBHOOK_BYTES = 1024 * 1024;

let schemaPromise = null;

async function ensureWebhookSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.ensureConnection();
      await db.query(`
        CREATE TABLE IF NOT EXISTS lightspark_grid_webhook_events (
          webhook_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          provider_transaction_id TEXT,
          transaction_direction TEXT,
          transaction_status TEXT,
          quote_id TEXT,
          provider_user_id TEXT,
          platform_user_id TEXT,
          sent_amount_minor NUMERIC(38, 0),
          sent_currency CHAR(3),
          received_amount_minor NUMERIC(38, 0),
          received_currency CHAR(3),
          reconciliation_reference TEXT,
          provider_timestamp TIMESTAMPTZ,
          signature_version TEXT NOT NULL,
          payload_sha256 CHAR(64) NOT NULL,
          disposition TEXT NOT NULL,
          response_status SMALLINT NOT NULL,
          response_body JSONB NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS lightspark_grid_webhook_transaction_idx
        ON lightspark_grid_webhook_events (provider_transaction_id, received_at DESC)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}


router.post(ENDPOINT, async (req, res) => {
  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return res.status(400).json({ success: false, code: 'GRID_WEBHOOK_RAW_BODY_MISSING' });
  }
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return res.status(413).json({ success: false, code: 'GRID_WEBHOOK_PAYLOAD_TOO_LARGE' });
  }

  const publicKeyPem = String(process.env.LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY || '');
  const signatureHeader = req.get('X-Grid-Signature');
  let signature;
  try {
    signature = verifyGridWebhookSignature({ rawBody, signatureHeader, publicKeyPem });
  } catch (error) {
    if (error instanceof GridWebhookSignatureError) {
      const configError = error.code === 'GRID_WEBHOOK_PUBLIC_KEY_NOT_CONFIGURED'
        || error.code === 'GRID_WEBHOOK_PUBLIC_KEY_INVALID';
      if (configError) {
        console.error('[lightspark-grid-webhook] verification configuration is not ready:', error.code);
        return res.status(503).json({ success: false, code: error.code });
      }
      return res.status(401).json({ success: false, code: error.code });
    }
    console.error('[lightspark-grid-webhook] signature verification failed.');
    return res.status(401).json({ success: false, code: 'GRID_WEBHOOK_SIGNATURE_INVALID' });
  }

  let event;
  try {
    event = normalizeGridWebhook(req.body);
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code || 'GRID_WEBHOOK_PAYLOAD_INVALID' });
  }

  const decision = chooseGridWebhookDisposition(event);
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

  try {
    await ensureWebhookSchema();
    const inserted = await db.query(`
      INSERT INTO lightspark_grid_webhook_events (
        webhook_id, event_type, provider_transaction_id, transaction_direction,
        transaction_status, quote_id, provider_user_id, platform_user_id,
        sent_amount_minor, sent_currency, received_amount_minor, received_currency,
        reconciliation_reference, provider_timestamp, signature_version,
        payload_sha256, disposition, response_status, response_body
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19::jsonb
      )
      ON CONFLICT (webhook_id) DO NOTHING
      RETURNING webhook_id, payload_sha256, response_status, response_body
    `, [
      event.webhookId,
      event.eventType,
      event.transactionId,
      event.transactionDirection,
      event.transactionStatus,
      event.quoteId,
      event.providerUserId,
      event.platformUserId,
      event.sentAmountMinor,
      event.sentCurrency,
      event.receivedAmountMinor,
      event.receivedCurrency,
      event.reconciliationReference,
      event.providerTimestamp,
      signature.version,
      payloadHash,
      decision.disposition,
      decision.status,
      JSON.stringify(decision.body),
    ]);

    let stored = inserted.rows && inserted.rows[0];
    if (!stored) {
      const existing = await db.query(`
        SELECT webhook_id, payload_sha256, response_status, response_body
        FROM lightspark_grid_webhook_events
        WHERE webhook_id = $1
        LIMIT 1
      `, [event.webhookId]);
      stored = existing.rows && existing.rows[0];
      if (!stored) {
        throw new Error('Grid webhook idempotency record could not be read after conflict.');
      }
      if (String(stored.payload_sha256).trim() !== payloadHash) {
        console.error('[lightspark-grid-webhook] webhook ID collision with different payload:', event.webhookId);
        return res.status(409).json({ success: false, code: 'GRID_WEBHOOK_ID_COLLISION' });
      }
    } else {
      console.info('[lightspark-grid-webhook] verified event persisted:', {
        webhookId: event.webhookId,
        eventType: event.eventType,
        transactionId: event.transactionId,
        disposition: decision.disposition,
      });
    }

    return res.status(Number(stored.response_status)).json(stored.response_body);
  } catch (error) {
    // Do not acknowledge until the signed event is durably persisted.
    console.error('[lightspark-grid-webhook] durable event persistence failed:', error.code || error.message);
    return res.status(503).json({ success: false, code: 'GRID_WEBHOOK_PERSISTENCE_UNAVAILABLE' });
  }
});

module.exports = router;
