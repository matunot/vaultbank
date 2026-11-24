'use strict';

const crypto = require('crypto');
const {
  GridWebhookSignatureError,
  verifyGridWebhookSignature,
  normalizeGridWebhook,
  chooseGridWebhookDisposition,
} = require('../services/lightsparkGridWebhook');

function makeKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

function makeHeader(rawBody, privateKey) {
  const hash = crypto.createHash('sha256').update(rawBody).digest();
  // Mirrors Grid's published Node.js verification sequence.
  const signature = crypto.sign('sha256', hash, privateKey).toString('base64');
  return JSON.stringify({ v: '1', s: signature });
}

describe('Lightspark Grid webhook verification', () => {
  test('accepts a valid P-256 signature over the exact raw body', () => {
    const keys = makeKeyPair();
    const rawBody = Buffer.from('{"webhookId":"Webhook:test-1","type":"OUTGOING_PAYMENT"}');
    const signatureHeader = makeHeader(rawBody, keys.privateKey);
    expect(verifyGridWebhookSignature({
      rawBody,
      signatureHeader,
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).toEqual({ version: '1' });
  });

  test('rejects a signature when even one raw body byte changes', () => {
    const keys = makeKeyPair();
    const original = Buffer.from('{"webhookId":"Webhook:test-2","type":"OUTGOING_PAYMENT"}');
    const signatureHeader = makeHeader(original, keys.privateKey);
    expect(() => verifyGridWebhookSignature({
      rawBody: Buffer.from(original.toString().replace('OUTGOING_PAYMENT', 'INCOMING_PAYMENT')),
      signatureHeader,
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).toThrow(GridWebhookSignatureError);
  });

  test('rejects an unsupported signature version', () => {
    const keys = makeKeyPair();
    const rawBody = Buffer.from('{}');
    const signatureHeader = JSON.stringify({ v: '2', s: Buffer.alloc(72).toString('base64') });
    expect(() => verifyGridWebhookSignature({
      rawBody,
      signatureHeader,
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).toThrow('Grid webhook signature version is unsupported.');
  });

  test('rejects an RSA key instead of a P-256 public key', () => {
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rawBody = Buffer.from('{}');
    const signatureHeader = JSON.stringify({ v: '1', s: crypto.randomBytes(72).toString('base64') });
    expect(() => verifyGridWebhookSignature({
      rawBody,
      signatureHeader,
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })).toThrow('Grid webhook public key must use the P-256 curve.');
  });

  test('normalizes supported payment metadata without retaining counterparty PII', () => {
    const event = normalizeGridWebhook({
      webhookId: 'Webhook:test-3',
      type: 'OUTGOING_PAYMENT',
      timestamp: '2026-11-24T08:00:00.000Z',
      transaction: {
        transactionId: 'Transaction:test-3',
        status: 'COMPLETED',
        type: 'OUTGOING',
        quoteId: 'Quote:test-3',
        userId: 'User:test-3',
        platformUserId: 'vaultbank-user-1',
        sentAmount: { amount: 12345, currency: { code: 'USD' } },
        receivedAmount: { amount: 11200, currency: { code: 'EUR' } },
        counterpartyInformation: { FULL_NAME: 'Must not be persisted', BIRTH_DATE: '1990-01-01' },
      },
    });
    expect(event).toMatchObject({
      webhookId: 'Webhook:test-3',
      eventType: 'OUTGOING_PAYMENT',
      transactionId: 'Transaction:test-3',
      transactionStatus: 'COMPLETED',
      sentAmountMinor: '12345',
      sentCurrency: 'USD',
      receivedAmountMinor: '11200',
      receivedCurrency: 'EUR',
    });
    expect(event).not.toHaveProperty('counterpartyInformation');
    expect(JSON.stringify(event)).not.toContain('Must not be persisted');
  });
});

describe('Lightspark Grid webhook handling policy', () => {
  test('does not approve an incoming PENDING payment before inbound controls exist', () => {
    expect(chooseGridWebhookDisposition({
      eventType: 'INCOMING_PAYMENT',
      transactionStatus: 'PENDING',
    })).toMatchObject({
      disposition: 'rejected_inbound_approval_disabled',
      status: 403,
      body: { code: 'REJECTED_BY_PLATFORM' },
    });
  });

  test('durably acknowledges outgoing payment events for later ledger reconciliation', () => {
    expect(chooseGridWebhookDisposition({
      eventType: 'OUTGOING_PAYMENT',
      transactionStatus: 'COMPLETED',
    })).toMatchObject({
      disposition: 'awaiting_ledger_reconciliation',
      status: 200,
      body: { received: true },
    });
  });

  test('does not fail on an authenticated future event type', () => {
    expect(chooseGridWebhookDisposition({
      eventType: 'FUTURE_GRID_EVENT',
    })).toMatchObject({
      disposition: 'ignored_unknown_event_type',
      status: 200,
      body: { ignored: true },
    });
  });
});

describe('Grid webhook raw-body middleware', () => {
  test('captures exact bytes for the Grid endpoint, including query strings', () => {
    const { captureRawBody } = require('../middleware/rawBody');
    const req = { originalUrl: '/api/webhooks/lightspark/grid?source=dashboard' };
    const bytes = Buffer.from('{"exact":"bytes"}');
    captureRawBody(req, {}, bytes);
    expect(req.rawBody).toEqual(bytes);
    expect(req.rawBody).not.toBe(bytes);
  });
});
