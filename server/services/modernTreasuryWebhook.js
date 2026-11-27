'use strict';

const crypto = require('crypto');

class ModernTreasuryWebhookError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModernTreasuryWebhookError';
    this.code = code;
  }
}

function verifySignature({ rawBody, signature, webhookKey }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new ModernTreasuryWebhookError('MODERN_TREASURY_RAW_BODY_MISSING', 'Raw webhook body is unavailable.');
  }
  if (typeof webhookKey !== 'string' || !webhookKey.trim()) {
    throw new ModernTreasuryWebhookError('MODERN_TREASURY_WEBHOOK_KEY_MISSING', 'Webhook signing key is not configured.');
  }
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new ModernTreasuryWebhookError('MODERN_TREASURY_SIGNATURE_INVALID', 'Webhook signature is missing or malformed.');
  }

  const expected = crypto.createHmac('sha256', webhookKey).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new ModernTreasuryWebhookError('MODERN_TREASURY_SIGNATURE_INVALID', 'Webhook signature verification failed.');
  }
  return true;
}

function normalizeWebhook(payload, headers = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ModernTreasuryWebhookError('MODERN_TREASURY_PAYLOAD_INVALID', 'Webhook payload must be a JSON object.');
  }

  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const webhookId = String(headers.webhookId || '').trim();
  const eventId = String(headers.eventId || '').trim();
  const eventName = typeof payload.event === 'string' ? payload.event.trim() : '';
  const topic = String(headers.topic || data.object || '').trim();
  const objectId = typeof data.id === 'string' ? data.id : null;
  const objectType = typeof data.object === 'string' ? data.object : topic || null;
  const rawLiveMode = headers.liveMode;
  const liveMode = typeof rawLiveMode === 'boolean'
    ? rawLiveMode
    : typeof data.live_mode === 'boolean'
      ? data.live_mode
      : null;

  if (!webhookId || webhookId.length > 255 || !eventName || eventName.length > 120) {
    throw new ModernTreasuryWebhookError(
      'MODERN_TREASURY_PAYLOAD_INVALID',
      'Webhook must include X-Webhook-ID and a valid event name.',
    );
  }

  return {
    webhookId,
    eventId: eventId && eventId.length <= 255 ? eventId : null,
    topic: topic && topic.length <= 120 ? topic : null,
    eventName,
    objectType: objectType && objectType.length <= 120 ? objectType : null,
    objectId: objectId && objectId.length <= 255 ? objectId : null,
    liveMode,
  };
}

module.exports = {
  ModernTreasuryWebhookError,
  verifySignature,
  normalizeWebhook,
};
