'use strict';

jest.mock('../config/database', () => ({
  db: { ensureConnection: jest.fn(), query: jest.fn() },
}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'admin-1', role: 'super_admin' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { db } = require('../config/database');
const router = require('../routes/modern-treasury');

const app = express();
app.use(express.json({
  verify(req, _res, buffer) {
    const path = String(req.originalUrl || '').split('?')[0].toLowerCase();
    if (path === '/api/webhooks/modern-treasury') req.rawBody = Buffer.from(buffer);
  },
}));
app.use(router);

const rows = new Map();

function sign(rawBody, key = 'test-webhook-key') {
  return crypto.createHmac('sha256', key).update(rawBody).digest('hex');
}

function installDbMock() {
  db.ensureConnection.mockResolvedValue(undefined);
  db.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS') || sql.includes('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO modern_treasury_webhook_events')) {
      const [webhookId, eventId, topic, eventName, objectType, objectId, liveMode, payloadHash] = params;
      if (rows.has(webhookId)) return { rows: [], rowCount: 0 };
      const record = { webhook_id: webhookId, payload_sha256: payloadHash, event_id: eventId,
        topic, event_name: eventName, object_type: objectType, object_id: objectId, live_mode: liveMode };
      rows.set(webhookId, record);
      return { rows: [record], rowCount: 1 };
    }
    if (sql.includes('SELECT webhook_id, payload_sha256')) {
      const row = rows.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error('Unexpected query in Modern Treasury webhook test.');
  });
}

beforeEach(() => {
  rows.clear();
  db.ensureConnection.mockClear();
  db.query.mockReset();
  installDbMock();
  process.env.MODERN_TREASURY_WEBHOOK_KEY = 'test-webhook-key';
  process.env.MODERN_TREASURY_ORGANIZATION_ID = 'org-test';
});

afterAll(() => {
  delete process.env.MODERN_TREASURY_WEBHOOK_KEY;
  delete process.env.MODERN_TREASURY_ORGANIZATION_ID;
});

async function postWebhook({ id = 'delivery-1', signatureOverride } = {}) {
  const body = { event: 'created', data: { id: 'po_123', object: 'payment_order', live_mode: true } };
  const rawBody = Buffer.from(JSON.stringify(body));
  return request(app)
    .post('/api/webhooks/modern-treasury')
    .set('Content-Type', 'application/json')
    .set('X-Signature', signatureOverride || sign(rawBody))
    .set('X-Webhook-ID', id)
    .set('X-Event-ID', 'event-1')
    .set('X-Organization-ID', 'org-test')
    .set('X-Topic', 'payment_order')
    .set('X-Live-Mode', 'true')
    .send(rawBody.toString('utf8'));
}

describe('Modern Treasury webhook endpoint', () => {
  test('verifies, stores minimal metadata and acknowledges a webhook', async () => {
    const response = await postWebhook();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(rows.get('delivery-1')).toMatchObject({
      event_name: 'created',
      object_type: 'payment_order',
      object_id: 'po_123',
      live_mode: true,
    });
  });

  test('returns the same acknowledgement for duplicate deliveries', async () => {
    const first = await postWebhook();
    const second = await postWebhook();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rows.size).toBe(1);
  });

  test('rejects invalid signatures without writing to the database', async () => {
    const response = await postWebhook({ signatureOverride: '0'.repeat(64) });
    expect(response.status).toBe(401);
    expect(rows.size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('fails closed when webhook signing key is missing', async () => {
    delete process.env.MODERN_TREASURY_WEBHOOK_KEY;
    const response = await postWebhook();
    expect(response.status).toBe(503);
    expect(rows.size).toBe(0);
  });
});
