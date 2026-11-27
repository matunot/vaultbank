'use strict';

const crypto = require('crypto');
const { verifySignature, normalizeWebhook } = require('../services/modernTreasuryWebhook');

describe('Modern Treasury webhook verification', () => {
  test('validates HMAC-SHA256 against exact raw bytes', () => {
    const rawBody = Buffer.from('{"event":"created","data":{"id":"po_123"}}');
    const signature = crypto.createHmac('sha256', 'webhook-secret').update(rawBody).digest('hex');
    expect(verifySignature({ rawBody, signature, webhookKey: 'webhook-secret' })).toBe(true);
    expect(() => verifySignature({
      rawBody: Buffer.from(rawBody.toString() + ' '),
      signature,
      webhookKey: 'webhook-secret',
    })).toThrow('Webhook signature verification failed.');
  });

  test('normalizes only operational metadata, not full customer payloads', () => {
    const normalized = normalizeWebhook({
      event: 'created',
      data: {
        id: 'payment-order-123',
        object: 'payment_order',
        live_mode: true,
        customer_name: 'Do not persist',
      },
    }, {
      webhookId: 'delivery-123',
      eventId: 'event-123',
      topic: 'payment_order',
      liveMode: true,
    });
    expect(normalized).toMatchObject({
      webhookId: 'delivery-123',
      eventId: 'event-123',
      topic: 'payment_order',
      eventName: 'created',
      objectType: 'payment_order',
      objectId: 'payment-order-123',
      liveMode: true,
    });
    expect(JSON.stringify(normalized)).not.toContain('Do not persist');
  });

  test('requires a webhook ID and event name', () => {
    expect(() => normalizeWebhook({ data: {} }, {}))
      .toThrow('Webhook must include X-Webhook-ID and a valid event name.');
  });
});
