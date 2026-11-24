'use strict';

const crypto = require('crypto');
const { createWebhookService, verifyGridSignature, parseWebhook } = require('../services/lightsparkGrid/webhooks');

function keypair() {
  return crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function sign(body, privateKey) {
  return crypto.sign('sha256', Buffer.from(body), privateKey).toString('base64');
}

function makeStore() {
  const deliveries = new Map();
  return {
    deliveries,
    async recordWebhookDelivery({ eventId, eventType, payload, rawSha256 }) {
      if (deliveries.has(eventId)) return false;
      deliveries.set(eventId, { eventId, eventType, payload, rawSha256, status: 'received' });
      return true;
    },
    async markWebhookProcessed(eventId, status, error) {
      const row = deliveries.get(eventId);
      if (row) Object.assign(row, { status, error });
    },
  };
}

describe('Grid webhook signature verification', () => {
  test('accepts both JSON and plain-base64 signatures over exact bytes', () => {
    const { publicKey, privateKey } = keypair();
    const body = '{"id":"Webhook:1","type":"TEST","timestamp":"2025-10-13T00:00:00Z"}';
    const signature = sign(body, privateKey);
    expect(() => verifyGridSignature({
      rawBody: Buffer.from(body),
      signatureHeader: JSON.stringify({ v: 1, s: signature }),
      publicKey,
    })).not.toThrow();
    expect(() => verifyGridSignature({
      rawBody: Buffer.from(body),
      signatureHeader: signature,
      publicKey,
    })).not.toThrow();
  });

  test('rejects tampered bodies, missing signatures and missing keys', () => {
    const { publicKey, privateKey } = keypair();
    const body = '{"id":"Webhook:1","type":"TEST"}';
    const signature = sign(body, privateKey);
    const tampered = Buffer.from(body + ' ');
    expect(() => verifyGridSignature({ rawBody: tampered, signatureHeader: signature, publicKey }))
      .toThrow(/did not verify/);
    expect(() => verifyGridSignature({ rawBody: Buffer.from(body), signatureHeader: '', publicKey }))
      .toThrow(/required/);
    expect(() => verifyGridSignature({ rawBody: Buffer.from(body), signatureHeader: signature, publicKey: '' }))
      .toThrow(/not configured/);
    expect(() => verifyGridSignature({ rawBody: Buffer.from(''), signatureHeader: signature, publicKey }))
      .toThrow(/raw bytes/);
  });

  test('rejects malformed payloads', () => {
    expect(() => parseWebhook(Buffer.from('not json'))).toThrow(/valid JSON/);
    expect(() => parseWebhook(Buffer.from('[]'))).toThrow(/must be an object/);
    expect(() => parseWebhook(Buffer.from('{"type":"TEST"}'))).toThrow(/id is required/);
  });
});

describe('Grid webhook delivery handling', () => {
  function setup(applyImpl = jest.fn().mockResolvedValue({ outcome: 'settled' })) {
    const { publicKey, privateKey } = keypair();
    const data = makeStore();
    const payments = { applyProviderEvent: applyImpl };
    const webhooks = createWebhookService({ config: { webhookPublicKey: publicKey }, data, payments });
    return { webhooks, privateKey, data, applyImpl };
  }

  function delivery(id, type, privateKey) {
    const body = JSON.stringify({ id, type, timestamp: '2025-10-13T00:00:00Z', data: {} });
    return { rawBody: Buffer.from(body), signatureHeader: sign(body, privateKey) };
  }

  test('persists verified deliveries and acknowledges after processing', async () => {
    const { webhooks, privateKey, data } = setup();
    const result = await webhooks.handle(delivery('Webhook:1', 'OUTGOING_PAYMENT.COMPLETED', privateKey));
    expect(result.status).toBe(200);
    expect(data.deliveries.get('Webhook:1').status).toBe('processed');
  });

  test('deduplicates by provider event id with 409 and never reprocesses', async () => {
    const { webhooks, privateKey, applyImpl } = setup();
    const input = delivery('Webhook:2', 'OUTGOING_PAYMENT.COMPLETED', privateKey);
    await webhooks.handle(input);
    const second = await webhooks.handle(input);
    expect(second.status).toBe(409);
    expect(applyImpl).toHaveBeenCalledTimes(1);
  });

  test('stores unknown event types safely without processing', async () => {
    const { webhooks, privateKey, applyImpl, data } = setup();
    const result = await webhooks.handle(delivery('Webhook:3', 'SOMETHING.NEW', privateKey));
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
    expect(applyImpl).not.toHaveBeenCalled();
    expect(data.deliveries.get('Webhook:3').status).toBe('ignored');
  });

  test('returns 500 for processing failures so Grid redelivers', async () => {
    const { webhooks, privateKey, data } = setup(jest.fn().mockRejectedValue(new Error('db down')));
    const result = await webhooks.handle(delivery('Webhook:4', 'INCOMING_PAYMENT.COMPLETED', privateKey));
    expect(result.status).toBe(500);
    expect(data.deliveries.get('Webhook:4').status).toBe('failed');
  });

  test('never accepts an unsigned settlement event', async () => {
    const { webhooks, privateKey } = setup();
    const input = delivery('Webhook:5', 'OUTGOING_PAYMENT.COMPLETED', privateKey);
    await expect(webhooks.handle({ ...input, signatureHeader: 'AAAA' })).rejects.toMatchObject({
      code: 'GRID_WEBHOOK_SIGNATURE_INVALID',
    });
  });
});
