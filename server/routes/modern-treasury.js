'use strict';

const express = require('express');
const crypto = require('crypto');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const modernTreasury = require('../services/modernTreasuryClient');
const {
  ModernTreasuryWebhookError,
  verifySignature,
  normalizeWebhook,
} = require('../services/modernTreasuryWebhook');

const router = express.Router();
const WEBHOOK_PATH = '/api/webhooks/modern-treasury';
const MAX_WEBHOOK_BYTES = 1024 * 1024;

let schemaPromise = null;

async function ensureWebhookSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.ensureConnection();
      await db.query(`
        CREATE TABLE IF NOT EXISTS modern_treasury_webhook_events (
          webhook_id TEXT PRIMARY KEY,
          event_id TEXT,
          topic TEXT,
          event_name TEXT NOT NULL,
          object_type TEXT,
          object_id TEXT,
          live_mode BOOLEAN,
          payload_sha256 CHAR(64) NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS modern_treasury_webhook_object_idx
        ON modern_treasury_webhook_events (object_type, object_id, received_at DESC)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function providerErrorResponse(res, error) {
  if (error instanceof modernTreasury.ModernTreasuryApiError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  console.error('[modern-treasury] request failed:', error && (error.code || error.message));
  return res.status(502).json({
    success: false,
    code: 'MODERN_TREASURY_UNAVAILABLE',
    message: 'Modern Treasury could not complete the request.',
  });
}

// All provider diagnostics and account discovery are admin-only and read-only.
router.get('/api/integrations/modern-treasury/status', authenticateToken, requireAdmin, (_req, res) => {
  const config = modernTreasury.getConfig();
  return res.status(200).json({
    success: true,
    provider: 'modern_treasury',
    configured: config.configured,
    capabilities: {
      connectivityCheck: true,
      readInternalAccounts: true,
      webhookEvents: true,
      createPaymentOrders: false,
      moveFunds: false,
    },
  });
});

router.get('/api/integrations/modern-treasury/ping', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const connection = await modernTreasury.checkConnection();
    return res.status(200).json({
      success: true,
      provider: 'modern_treasury',
      ...connection,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return providerErrorResponse(res, error);
  }
});

router.get('/api/integrations/modern-treasury/internal-accounts', authenticateToken, requireAdmin, async (req, res) => {
  const currency = req.query.currency ? String(req.query.currency).trim().toUpperCase() : undefined;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    return res.status(400).json({ success: false, code: 'CURRENCY_INVALID' });
  }
  try {
    const accounts = await modernTreasury.listInternalAccounts({ currency });
    return res.status(200).json({
      success: true,
      provider: 'modern_treasury',
      count: accounts.length,
      accounts,
    });
  } catch (error) {
    return providerErrorResponse(res, error);
  }
});

router.post(WEBHOOK_PATH, async (req, res) => {
  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return res.status(400).json({ success: false, code: 'MODERN_TREASURY_RAW_BODY_MISSING' });
  }
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return res.status(413).json({ success: false, code: 'MODERN_TREASURY_PAYLOAD_TOO_LARGE' });
  }

  try {
    verifySignature({
      rawBody,
      signature: req.get('X-Signature'),
      webhookKey: process.env.MODERN_TREASURY_WEBHOOK_KEY,
    });
  } catch (error) {
    if (error instanceof ModernTreasuryWebhookError
        && error.code === 'MODERN_TREASURY_WEBHOOK_KEY_MISSING') {
      console.error('[modern-treasury-webhook] signing key is not configured.');
      return res.status(503).json({ success: false, code: error.code });
    }
    return res.status(401).json({
      success: false,
      code: error.code || 'MODERN_TREASURY_SIGNATURE_INVALID',
    });
  }

  const configuredOrganizationId = String(process.env.MODERN_TREASURY_ORGANIZATION_ID || '').trim();
  const deliveredOrganizationId = String(req.get('X-Organization-ID') || '').trim();
  if (configuredOrganizationId && deliveredOrganizationId
      && configuredOrganizationId !== deliveredOrganizationId) {
    return res.status(403).json({ success: false, code: 'MODERN_TREASURY_ORGANIZATION_MISMATCH' });
  }

  let event;
  try {
    event = normalizeWebhook(req.body, {
      webhookId: req.get('X-Webhook-ID'),
      eventId: req.get('X-Event-ID'),
      topic: req.get('X-Topic'),
      liveMode: req.get('X-Live-Mode') === 'true'
        ? true
        : req.get('X-Live-Mode') === 'false'
          ? false
          : undefined,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: error.code || 'MODERN_TREASURY_PAYLOAD_INVALID',
    });
  }

  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  try {
    await ensureWebhookSchema();
    const inserted = await db.query(`
      INSERT INTO modern_treasury_webhook_events (
        webhook_id, event_id, topic, event_name, object_type, object_id,
        live_mode, payload_sha256
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (webhook_id) DO NOTHING
      RETURNING webhook_id, payload_sha256
    `, [
      event.webhookId,
      event.eventId,
      event.topic,
      event.eventName,
      event.objectType,
      event.objectId,
      event.liveMode,
      payloadHash,
    ]);

    if (!inserted.rows || inserted.rows.length === 0) {
      const existing = await db.query(`
        SELECT webhook_id, payload_sha256
        FROM modern_treasury_webhook_events
        WHERE webhook_id = $1
        LIMIT 1
      `, [event.webhookId]);
      const row = existing.rows && existing.rows[0];
      if (!row) throw new Error('Modern Treasury webhook idempotency record missing after conflict.');
      if (String(row.payload_sha256).trim() !== payloadHash) {
        return res.status(409).json({ success: false, code: 'MODERN_TREASURY_WEBHOOK_ID_COLLISION' });
      }
    }
    // Events are persisted for later reconciliation only. No event credits a balance
    // or creates a payment ledger entry automatically.
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[modern-treasury-webhook] durable persistence failed:', error && (error.code || error.message));
    return res.status(503).json({ success: false, code: 'MODERN_TREASURY_WEBHOOK_PERSISTENCE_UNAVAILABLE' });
  }
});

module.exports = router;
