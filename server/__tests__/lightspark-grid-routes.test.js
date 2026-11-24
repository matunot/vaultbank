'use strict';

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'user-1', role: 'admin' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../config/database', () => ({ createAuditLog: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const router = require('../routes/lightspark-grid');

function makeApp(gridServices) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use((req, _res, next) => { req.gridServices = gridServices; next(); });
  app.use('/', router);
  return app;
}

function disabledServices() {
  return {
    config: { enabled: false, mode: 'unset', customerAccessEnabled: false, webhookPublicKey: '' },
  };
}

describe('Lightspark Grid routes fail closed', () => {
  test('availability reports disabled with no currencies or agreements', async () => {
    const response = await request(makeApp(disabledServices())).get('/api/lightspark-grid/availability');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, enabled: false, supportedCurrencies: [], agreements: [] });
  });

  test('customer endpoints return 503 while disabled', async () => {
    const app = makeApp(disabledServices());
    expect((await request(app).get('/api/lightspark-grid/corridors?sourceCurrency=USD')).status).toBe(503);
    expect((await request(app).post('/api/lightspark-grid/quotes').send({})).status).toBe(503);
    expect((await request(app).post('/api/lightspark-grid/payouts').send({})).status).toBe(503);
  });

  test('unsigned webhooks are rejected before any processing', async () => {
    const grid = disabledServices();
    grid.webhooks = { handle: jest.fn() };
    const response = await request(makeApp(grid))
      .post('/api/webhooks/lightspark/grid')
      .set('Content-Type', 'application/json')
      .send('{"id":"Webhook:1","type":"OUTGOING_PAYMENT.COMPLETED"}');
    expect(response.status).toBe(503);
    expect(grid.webhooks.handle).not.toHaveBeenCalled();
  });

  test('signed webhook with invalid signature returns 401', async () => {
    const grid = {
      config: { enabled: true, webhookPublicKey: '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----' },
      webhooks: {
        async handle() {
          const { GridError } = require('../services/lightsparkGrid/errors');
          throw new GridError('GRID_WEBHOOK_SIGNATURE_INVALID', 'bad signature');
        },
      },
    };
    const response = await request(makeApp(grid))
      .post('/api/webhooks/lightspark/grid')
      .send({ id: 'Webhook:2', type: 'OUTGOING_PAYMENT.COMPLETED' });
    expect(response.status).toBe(401);
  });

  test('authenticated customer reads only return their own records', async () => {
    const grid = {
      config: { enabled: true, customerAccessEnabled: true, mode: 'sandbox' },
      data: {
        async listPayments(userId) {
          expect(userId).toBe('user-1');
          return [{ id: 'p1', status: 'processing', provider_transaction_id: 'Transaction:1',
            currency: 'USD', amount: '100.00', reference: 'grid-ref', created_at: new Date().toISOString() }];
        },
      },
    };
    const response = await request(makeApp(grid)).get('/api/lightspark-grid/payouts');
    expect(response.status).toBe(200);
    expect(response.body.payments).toHaveLength(1);
  });
});
