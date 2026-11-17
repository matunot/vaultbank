const express = require('express');
const request = require('supertest');
const router = require('../routes/payments');

describe('native banking payment routes', () => {
  const app = express();
  app.use(router);

  test('readiness describes only VaultBank-owned bank rails', async () => {
    const response = await request(app).get('/api/payments/readiness');
    expect(response.status).toBe(200);
    expect(response.body.nativeOnly).toBe(true);
    expect(response.body.rails.usd).toHaveProperty('bankTransferInstructions');
    expect(response.body.rails.usd).toHaveProperty('internalTransfers', true);
    expect(response.body.rails.usd).not.toHaveProperty('cardStripe');
    expect(response.body.rails.usd).not.toHaveProperty('paypal');
    expect(response.body.rails.inr).toHaveProperty('directBankPayouts');
    expect(response.body.rails.inr).not.toHaveProperty('collections');
    expect(response.body.rails.inr).not.toHaveProperty('payouts');
  });

  test('provider checkout, payout, and webhook routes are not registered', () => {
    const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(paths).toContain('/api/payments/readiness');
    expect(paths).toContain('/api/payments/methods');
    expect(paths).not.toContain('/api/payments/stripe/initiate');
    expect(paths).not.toContain('/api/payments/paypal/initiate');
    expect(paths).not.toContain('/api/payments/webhook/:provider');
    expect(paths).not.toContain('/api/payments/transfer');
  });
});
