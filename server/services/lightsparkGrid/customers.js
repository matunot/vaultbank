'use strict';

const { GridError } = require('./errors');
const store = require('./store');

const AGREEMENT_TYPES = new Set([
  'LIGHTSPARK_END_USER_TERMS', 'LIGHTSPARK_E_SIGN_CONSENT', 'LIGHTSPARK_PRIVACY_POLICY',
  'LEAD_E_SIGN_CONSENT', 'LEAD_ACCOUNTHOLDER_CONSUMER_AGREEMENT',
  'LEAD_ACCOUNTHOLDER_COMMERCIAL_AGREEMENT', 'LEAD_PRIVACY_POLICY',
  'LEAD_CARDHOLDER_CONSUMER_AGREEMENT', 'LEAD_CARDHOLDER_COMMERCIAL_AGREEMENT',
]);
const ACCEPTANCE_METHODS = new Set(['CHECKBOX', 'CLICK_TO_ACCEPT']);

function validateConsents(consents, catalog, requiredTypes) {
  if (!Array.isArray(consents) || !consents.length) {
    throw new GridError('GRID_CONSENT_REQUIRED', 'Every required agreement acceptance must be recorded.');
  }
  const catalogByType = new Map(catalog.map((entry) => [entry.type, entry]));
  const seen = new Set();
  const cleaned = [];
  for (const consent of consents) {
    if (!consent || typeof consent !== 'object') {
      throw new GridError('GRID_CONSENT_INVALID', 'Consent records must be objects.');
    }
    const type = String(consent.type || '');
    if (!AGREEMENT_TYPES.has(type)) {
      throw new GridError('GRID_CONSENT_INVALID', 'Unknown agreement type.');
    }
    if (seen.has(type)) {
      throw new GridError('GRID_CONSENT_DUPLICATE', 'Only one acceptance per agreement type is allowed.');
    }
    seen.add(type);
    const current = catalogByType.get(type);
    if (!current) {
      throw new GridError('GRID_CONSENT_UNAVAILABLE', 'That agreement is not offered by Grid for this platform.');
    }
    if (String(consent.termsVersion || '') !== current.version) {
      throw new GridError('GRID_CONSENT_VERSION_STALE', 'Agreement acceptance must use the current provider version.');
    }
    if (!ACCEPTANCE_METHODS.has(String(consent.acceptanceMethod || ''))) {
      throw new GridError('GRID_CONSENT_INVALID', 'Acceptance method must be CHECKBOX or CLICK_TO_ACCEPT.');
    }
    const acceptedAt = new Date(String(consent.acceptedAt || ''));
    if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt.getTime() > Date.now() + 60_000) {
      throw new GridError('GRID_CONSENT_INVALID', 'Acceptance timestamp must be valid and not in the future.');
    }
    const ip = String(consent.ipAddress || '').trim();
    if (!ip || ip.length > 45) {
      throw new GridError('GRID_CONSENT_INVALID', 'Acceptance IP address is required.');
    }
    cleaned.push({
      type,
      acceptedAt: acceptedAt.toISOString(),
      ipAddress: ip,
      termsVersion: current.version,
      acceptanceMethod: String(consent.acceptanceMethod),
    });
  }
  const missing = requiredTypes.filter((type) => !seen.has(type));
  if (missing.length) {
    throw new GridError('GRID_CONSENT_REQUIRED', `Missing required agreements: ${missing.join(', ')}.`);
  }
  return cleaned;
}

function createCustomerService({ client, platform, config, data = store }) {
  const requiredTypes = String(config.requiredAgreements || '')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  async function getMapping(userId) {
    return data.getCustomer(userId);
  }

  async function ensureCustomer({ user, consents }) {
    const existing = await data.getCustomer(user.id);
    if (existing) return existing;
    if (!requiredTypes.length) {
      throw new GridError('GRID_CONSENT_NOT_CONFIGURED', 'Required agreement types are not configured for this platform.');
    }
    const capabilities = await platform.getCapabilities();
    const cleaned = validateConsents(consents, capabilities.agreements, requiredTypes);
    const currencies = capabilities.supportedCurrencies.map((entry) => entry.code);
    const body = {
      customerType: 'INDIVIDUAL',
      platformCustomerId: String(user.id),
      agreementConsents: cleaned,
    };
    if (user.email) body.email = String(user.email).toLowerCase();
    const region = String(user.country || user.region || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(region)) body.region = region;
    if (currencies.length) body.currencies = currencies;

    const response = await client.request({
      method: 'POST',
      path: '/customers',
      body,
      idempotencyKey: `vb-grid-customer-${user.id}`,
      timeoutMs: 20000,
    });
    const providerCustomer = response?.data;
    if (!providerCustomer || !providerCustomer.id) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid customer response did not include an id.');
    }
    return data.saveCustomer({
      userId: user.id,
      providerCustomerId: String(providerCustomer.id),
      customerType: 'INDIVIDUAL',
      status: providerCustomer.status || null,
      kycStatus: providerCustomer.kycStatus || providerCustomer.kyc_status || null,
      region: body.region || null,
      currencies,
      consents: cleaned,
    });
  }

  async function refreshCustomer(userId) {
    const mapping = await data.getCustomer(userId);
    if (!mapping) throw new GridError('GRID_CUSTOMER_NOT_FOUND', 'No Grid customer mapping for this user.');
    const response = await client.request({
      path: `/customers/${encodeURIComponent(mapping.provider_customer_id)}`,
      timeoutMs: 12000,
    });
    const providerCustomer = response?.data;
    if (!providerCustomer || !providerCustomer.id) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid customer response did not include an id.');
    }
    return data.saveCustomer({
      userId,
      providerCustomerId: String(providerCustomer.id),
      customerType: mapping.customer_type,
      status: providerCustomer.status || null,
      kycStatus: providerCustomer.kycStatus || providerCustomer.kyc_status || null,
      region: mapping.region,
      currencies: mapping.currencies || [],
      consents: mapping.consents || [],
    });
  }

  async function createKycLink(userId) {
    const mapping = await data.getCustomer(userId);
    if (!mapping) throw new GridError('GRID_CUSTOMER_NOT_FOUND', 'Complete Grid onboarding first.');
    if (!config.kycRedirectUri) {
      throw new GridError('GRID_REDIRECT_NOT_CONFIGURED', 'KYC redirect URI is not configured.');
    }
    const response = await client.request({
      method: 'POST',
      path: `/customers/${encodeURIComponent(mapping.provider_customer_id)}/kyc-link`,
      body: { redirectUri: config.kycRedirectUri },
      timeoutMs: 15000,
    });
    const link = response?.data;
    if (!link || !link.kycUrl || !link.expiresAt) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid KYC link response was incomplete.');
    }
    return { kycUrl: String(link.kycUrl), expiresAt: String(link.expiresAt), provider: link.provider || null };
  }

  return { getMapping, ensureCustomer, refreshCustomer, createKycLink, validateConsents };
}

module.exports = { createCustomerService, validateConsents, AGREEMENT_TYPES, ACCEPTANCE_METHODS };
