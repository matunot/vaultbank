'use strict';

const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { transferLimiter, adminLimiter, gridWebhookLimiter } = require('../middleware/rateLimiter');
const { createAuditLog } = require('../config/database');
const { getGridServices } = require('../services/lightsparkGrid');
const { GridError } = require('../services/lightsparkGrid/errors');

const router = express.Router();

async function audit(userId, action, resourceType, resourceId, details, req) {
  try {
    await createAuditLog({
      userId, action, resourceType, resourceId, details,
      ipAddress: req ? req.ip : null,
      userAgent: req ? String(req.get('user-agent') || '').slice(0, 400) : null,
    });
  } catch {
    // Audit failure must never turn a completed financial operation into an
    // apparent failure; observability alerts on missing audit rows.
  }
}

function services(req) {
  return req.gridServices || getGridServices();
}

function requireGrid(req, res, next) {
  const grid = services(req);
  if (!grid.config.enabled) {
    return res.status(503).json({
      success: false,
      code: 'GRID_NOT_ENABLED',
      message: 'International payments are not enabled for this platform.',
    });
  }
  req.gridServices = grid;
  return next();
}

function requireCustomerAccess(req, res, next) {
  if (!services(req).config.customerAccessEnabled) {
    return res.status(503).json({
      success: false,
      code: 'GRID_CUSTOMER_ACCESS_DISABLED',
      message: 'International payments are not available to customers yet.',
    });
  }
  return next();
}

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    if (res.headersSent) return;
    const code = String(error?.code || '');
    const message = String(error?.message || 'Grid request failed.');
    let status = 502;
    if (error instanceof GridError) {
      if (code === 'GRID_WEBHOOK_SIGNATURE_INVALID' || code === 'GRID_WEBHOOK_SIGNATURE_MISSING') status = 401;
      else if (['GRID_WEBHOOK_MALFORMED', 'GRID_WEBHOOK_EMPTY_BODY'].includes(code)) status = 400;
      else if (code === 'GRID_WEBHOOK_TOO_LARGE') status = 413;
      else if (code.startsWith('GRID_CUSTOMER_NOT_FOUND') || code.startsWith('GRID_QUOTE_NOT_FOUND')
        || code.startsWith('GRID_BENEFICIARY_NOT_FOUND') || code.startsWith('GRID_PAYMENT_NOT_FOUND')) status = 404;
      else if (code === 'GRID_QUOTE_EXPIRED') status = 410;
      else if (code === 'GRID_SETTLEMENT_CONFLICT' || code === 'GRID_IDEMPOTENCY_CONFLICT') status = 409;
      else if (['GRID_INSUFFICIENT_FUNDS', 'GRID_UNVERIFIED_FUNDS'].includes(code)) status = 402;
      else if (code.startsWith('GRID_INVALID') || code.startsWith('GRID_CONSENT')
        || code.startsWith('GRID_ACCOUNT_TYPE') || code.startsWith('GRID_REDIRECT')) status = 400;
      else if (code === 'GRID_REQUEST_TIMEOUT' || code === 'GRID_NETWORK_ERROR') status = 202;
    }
    return res.status(status).json({
      success: false,
      code,
      message: status >= 500 ? 'The payment provider could not complete this request. No balance was changed.' : message,
      ...(error?.ambiguous ? { reconciliationRequired: true } : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// Webhook — first real webhook route in the app. Signature is verified against
// the exact raw bytes captured by middleware/rawBody.js.
// ---------------------------------------------------------------------------
router.post('/api/webhooks/lightspark/grid', gridWebhookLimiter, asyncRoute(async (req, res) => {
  const grid = services(req);
  if (!grid.config.enabled || !grid.config.webhookPublicKey) {
    return res.status(503).json({ success: false, code: 'GRID_NOT_ENABLED' });
  }
  const result = await grid.webhooks.handle({
    rawBody: req.rawBody,
    signatureHeader: req.get('x-grid-signature'),
  });
  return res.status(result.status).json(result.body);
}));

// ---------------------------------------------------------------------------
// Capability discovery — provider data only, no static currency advertising.
// ---------------------------------------------------------------------------
router.get('/api/lightspark-grid/availability', authenticateToken, asyncRoute(async (req, res) => {
  const grid = services(req);
  if (!grid.config.enabled) {
    return res.json({
      success: true,
      enabled: false,
      mode: grid.config.mode,
      supportedCurrencies: [],
      agreements: [],
      customerAccessEnabled: false,
    });
  }
  const capabilities = await grid.platform.getCapabilities();
  return res.json({
    success: true,
    enabled: true,
    mode: grid.config.mode,
    customerAccessEnabled: grid.config.customerAccessEnabled,
    supportedCurrencies: capabilities.supportedCurrencies,
    agreements: capabilities.agreements,
    fetchedAt: capabilities.fetchedAt,
  });
}));

router.get('/api/lightspark-grid/corridors', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const grid = services(req);
    const corridors = await grid.platform.getCorridors(req.query.sourceCurrency, req.query.destinationCurrency);
    return res.json({ success: true, corridors });
  }));

// ---------------------------------------------------------------------------
// Customer onboarding and consent
// ---------------------------------------------------------------------------
router.get('/api/lightspark-grid/customer', authenticateToken, requireGrid, asyncRoute(async (req, res) => {
  const mapping = await services(req).customers.getMapping(req.user.id);
  return res.json({ success: true, customer: mapping ? {
    providerCustomerId: mapping.provider_customer_id,
    status: mapping.status,
    kycStatus: mapping.kyc_status,
    currencies: mapping.currencies,
  } : null });
}));

router.post('/api/lightspark-grid/customer', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const consents = Array.isArray(req.body?.consents) ? req.body.consents.map((consent) => ({
      ...consent,
      // The acceptance IP is evidence from the server, never client-supplied.
      ipAddress: req.ip,
    })) : [];
    const customer = await services(req).customers.ensureCustomer({ user: req.user, consents });
    await audit(req.user.id, 'grid_customer_created', 'grid_provider_customer', customer.user_id,
      { mode: services(req).config.mode }, req);
    return res.status(201).json({ success: true, customer: {
      providerCustomerId: customer.provider_customer_id,
      status: customer.status,
      kycStatus: customer.kyc_status,
      currencies: customer.currencies,
    } });
  }));

router.post('/api/lightspark-grid/customer/kyc-link', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const link = await services(req).customers.createKycLink(req.user.id);
    await audit(req.user.id, 'grid_kyc_link_created', 'grid_provider_customer', req.user.id,
      { provider: link.provider }, req);
    return res.json({ success: true, kycLink: link });
  }));

router.post('/api/lightspark-grid/customer/refresh', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const customer = await services(req).customers.refreshCustomer(req.user.id);
    return res.json({ success: true, customer: {
      providerCustomerId: customer.provider_customer_id,
      status: customer.status, kycStatus: customer.kyc_status,
    } });
  }));

// ---------------------------------------------------------------------------
// Accounts and beneficiaries
// ---------------------------------------------------------------------------
router.get('/api/lightspark-grid/accounts', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const accounts = await services(req).accounts.listInternalAccounts(req.user.id);
    return res.json({ success: true, accounts: accounts.map((account) => ({
      providerAccountId: account.provider_account_id,
      currency: account.currency,
      status: account.status,
      type: account.type,
    })) });
  }));

router.get('/api/lightspark-grid/beneficiaries', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const beneficiaries = await services(req).accounts.listBeneficiaries(req.user.id);
    return res.json({ success: true, beneficiaries });
  }));

router.post('/api/lightspark-grid/beneficiaries', authenticateToken, requireGrid, requireCustomerAccess,
  transferLimiter, asyncRoute(async (req, res) => {
    const beneficiary = await services(req).accounts.registerBeneficiary({
      userId: req.user.id,
      currency: req.body?.currency,
      accountInfo: req.body?.accountInfo,
      platformAccountId: req.body?.platformAccountId,
    });
    await audit(req.user.id, 'grid_beneficiary_created', 'grid_beneficiary', beneficiary.id,
      { currency: beneficiary.currency, accountType: beneficiary.accountType }, req);
    return res.status(201).json({ success: true, beneficiary });
  }));

router.get('/api/lightspark-grid/beneficiaries/:id/receiver', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const lookup = await services(req).accounts.lookupBeneficiary(req.user.id, req.params.id, req.query.sendingCurrency);
    return res.json({ success: true, lookup });
  }));

// ---------------------------------------------------------------------------
// Quotes and payouts
// ---------------------------------------------------------------------------
router.post('/api/lightspark-grid/quotes', authenticateToken, requireGrid, requireCustomerAccess,
  transferLimiter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const quote = await services(req).quotes.createQuote({
      userId: req.user.id,
      beneficiaryId: body.beneficiaryId,
      sendingCurrency: body.sendingCurrency,
      sendingAmountMinor: body.sendingAmountMinor,
      lockedCurrencySide: body.lockedCurrencySide,
      paymentRail: body.paymentRail,
      lookupId: body.lookupId,
      description: body.description,
      remittanceInformation: body.remittanceInformation,
    });
    await audit(req.user.id, 'grid_quote_created', 'grid_quote', quote.id,
      { providerQuoteId: quote.providerQuoteId, expiresAt: quote.expiresAt }, req);
    return res.status(201).json({ success: true, quote });
  }));

router.get('/api/lightspark-grid/quotes/:id', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const quote = await services(req).quotes.getQuote(req.user.id, req.params.id);
    return res.json({ success: true, quote });
  }));

router.post('/api/lightspark-grid/payouts', authenticateToken, requireGrid, requireCustomerAccess,
  transferLimiter, asyncRoute(async (req, res) => {
    const idempotencyKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    const payment = await services(req).payments.createPayout({
      userId: req.user.id,
      quoteId: req.body?.quoteId,
      idempotencyKey,
    });
    await audit(req.user.id, 'grid_payout_requested', 'grid_payment', payment.id,
      { reference: payment.reference, status: payment.status }, req);
    return res.status(payment.status === 'reconciliation_required' ? 202 : 201)
      .json({ success: true, payment });
  }));

router.get('/api/lightspark-grid/payouts', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const payments = await services(req).data.listPayments(req.user.id);
    return res.json({ success: true, payments: payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      providerTransactionId: payment.provider_transaction_id || null,
      currency: payment.currency,
      amount: Number(payment.amount),
      reference: payment.reference,
      createdAt: payment.created_at,
      completedAt: payment.completed_at || null,
    })) });
  }));

router.get('/api/lightspark-grid/payouts/:id', authenticateToken, requireGrid, requireCustomerAccess,
  asyncRoute(async (req, res) => {
    const payment = await services(req).data.getPayment(req.user.id, req.params.id);
    if (!payment) return res.status(404).json({ success: false, code: 'GRID_PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    return res.json({ success: true, payment: {
      id: payment.id,
      status: payment.status,
      providerTransactionId: payment.provider_transaction_id || null,
      providerQuoteId: payment.provider_quote_id,
      currency: payment.currency,
      amount: Number(payment.amount),
      failureReason: payment.failure_reason || null,
      settlementReference: payment.settlement_reference || null,
      reference: payment.reference,
      createdAt: payment.created_at,
      updatedAt: payment.updated_at,
      completedAt: payment.completed_at || null,
    } });
  }));

// ---------------------------------------------------------------------------
// Admin: reconciliation and exception management
// ---------------------------------------------------------------------------
router.get('/api/lightspark-grid/admin/payouts', authenticateToken, requireAdmin, requireGrid, adminLimiter,
  asyncRoute(async (req, res) => {
    const payments = await services(req).data.listAllPayments(req.query.status || null);
    return res.json({ success: true, payments });
  }));

router.post('/api/lightspark-grid/admin/payouts/:id/reconcile', authenticateToken, requireAdmin, requireGrid, adminLimiter,
  asyncRoute(async (req, res) => {
    const grid = services(req);
    const result = await grid.payments.reconcilePayment({ paymentId: req.params.id, actorUserId: req.user.id });
    await audit(req.user.id, 'grid_payment_reconciled', 'grid_payment', req.params.id,
      { outcome: result.outcome }, req);
    return res.json({ success: true, ...result });
  }));

router.get('/api/lightspark-grid/admin/exceptions', authenticateToken, requireAdmin, requireGrid, adminLimiter,
  asyncRoute(async (req, res) => {
    const grid = services(req);
    const payments = await grid.data.listAllPayments('reconciliation_required');
    const stuck = await grid.payments.scanStuckPayments();
    return res.json({ success: true, exceptions: payments, scan: stuck });
  }));

router.get('/api/lightspark-grid/admin/webhooks', authenticateToken, requireAdmin, requireGrid, adminLimiter,
  asyncRoute(async (req, res) => {
    const deliveries = await services(req).data.listWebhookDeliveries(req.query.limit);
    return res.json({ success: true, deliveries });
  }));

module.exports = router;
