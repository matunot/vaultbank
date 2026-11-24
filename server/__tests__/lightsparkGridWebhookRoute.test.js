'use strict';

jest.mock('../config/database', () => ({
  db: {
    ensureConnection: jest.fn(),
    query: jest.fn(),
  },
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { db } = require('../config/database');
const webhookRouter = require('../routes/lightspark-grid-webhook');
const { verifyGridWebhookSignature } = require('../services/lightsparkGridWebhook');

const ENDPOINT = '/api/webhooks/lightspark/grid';
const app = express();
app.use(express.json({
  limit: '10mb',
  verify(req, _res, buffer) {
    const path = String(req.originalUrl || '').split('?')[0].toLowerCase();
    if (path === ENDPOINT) req.rawBody = Buffer.from(buffer);
  },
}));
app.use(webhookRouter);

const records = new Map();
let keys;

function makeSignature(rawBody) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest();
  const signature = crypto.sign('sha256', bodyHash, keys.privateKey).toString('base64');
  return JSON.stringify({ v: '1', s: signature });
}

function installDatabaseMock() {
  db.ensureConnection.mockResolvedValue(undefined);
  db.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('INSERT INTO lightspark_grid_webhook_events')) {
      const webhookId = params[0];
      if (records.has(webhookId)) return { rows: [], rowCount: 0 };
      const row = {
        webhook_id: webhookId,
        payload_sha256: params[15],
        disposition: params[16],
        response_status: params[17],
        response_body: JSON.parse(params[18]),
      };
      records.set(webhookId, row);
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('SELECT webhook_id, payload_sha256, response_status, response_body')) {
      const row = records.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    throw new Error('Unexpected webhook test query.');
  });
}

async function sendEvent(payload, signatureOverride) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signatureHeader = signatureOverride || makeSignature(rawBody);
  if (!signatureOverride) {
    expect(verifyGridWebhookSignature({
      rawBody,
      signatureHeader,
      publicKeyPem: process.env.LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY,
    })).toEqual({ version: '1' });
  }
  return request(app)
    .post(ENDPOINT)
    .set('Content-Type', 'application/json')
    .set('X-Grid-Signature', signatureHeader)
    .send(rawBody.toString('utf8'));
}

beforeAll(() => {
  keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  process.env.LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY = keys.publicKey
    .export({ type: 'spki', format: 'pem' }).toString();
});

beforeEach(() => {
  records.clear();
  db.ensureConnection.mockClear();
  db.query.mockClear();
  installDatabaseMock();
});

describe('Lightspark Grid webhook HTTP endpoint', () => {
  test('accepts and durably records a verified outgoing payment event', async () => {
    const response = await sendEvent({
      webhookId: 'Webhook:http-out-1',
      type: 'OUTGOING_PAYMENT',
      timestamp: '2026-11-24T09:00:00.000Z',
      transaction: {
        transactionId: 'Transaction:http-out-1',
        type: 'OUTGOING',
        status: 'COMPLETED',
        sentAmount: { amount: 2500, currency: { code: 'USD' } },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(records.get('Webhook:http-out-1')).toMatchObject({
      disposition: 'awaiting_ledger_reconciliation',
      response_status: 200,
    });
    expect(JSON.stringify(records.get('Webhook:http-out-1'))).not.toContain('counterpartyInformation');
  });

  test('replays the original response for duplicate webhook delivery', async () => {
    const payload = {
      webhookId: 'Webhook:http-out-2',
      type: 'OUTGOING_PAYMENT',
      transaction: { transactionId: 'Transaction:http-out-2', type: 'OUTGOING', status: 'FAILED' },
    };

    const first = await sendEvent(payload);
    const second = await sendEvent(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(records.size).toBe(1);
  });

  test('rejects incoming PENDING payments instead of accidentally approving them', async () => {
    const payload = {
      webhookId: 'Webhook:http-in-1',
      type: 'INCOMING_PAYMENT',
      transaction: {
        transactionId: 'Transaction:http-in-1',
        type: 'INCOMING',
        status: 'PENDING',
        receivedAmount: { amount: 9000, currency: { code: 'USD' } },
      },
    };

    const first = await sendEvent(payload);
    const second = await sendEvent(payload);

    expect(first.status).toBe(403);
    expect(first.body.code).toBe('REJECTED_BY_PLATFORM');
    expect(second.status).toBe(403);
    expect(records.get('Webhook:http-in-1')).toMatchObject({
      disposition: 'rejected_inbound_approval_disabled',
      response_status: 403,
    });
  });

  test('rejects invalid signatures before any database write', async () => {
    const response = await sendEvent({
      webhookId: 'Webhook:http-invalid-1',
      type: 'OUTGOING_PAYMENT',
      transaction: { transactionId: 'Transaction:http-invalid-1', type: 'OUTGOING', status: 'COMPLETED' },
    }, JSON.stringify({ v: '1', s: Buffer.alloc(72).toString('base64') }));

    expect(response.status).toBe(401);
    expect(records.size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects a reused webhook ID when the signed payload changes', async () => {
    const firstPayload = {
      webhookId: 'Webhook:http-collision-1',
      type: 'OUTGOING_PAYMENT',
      transaction: { transactionId: 'Transaction:http-collision-1', type: 'OUTGOING', status: 'COMPLETED' },
    };
    const changedPayload = {
      ...firstPayload,
      transaction: { ...firstPayload.transaction, status: 'FAILED' },
    };

    const first = await sendEvent(firstPayload);
    const collision = await sendEvent(changedPayload);

    expect(first.status).toBe(200);
    expect(collision.status).toBe(409);
    expect(collision.body.code).toBe('GRID_WEBHOOK_ID_COLLISION');
    expect(records.size).toBe(1);
  });
});
