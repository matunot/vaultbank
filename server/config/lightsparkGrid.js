'use strict';

/**
 * Lightspark Grid configuration.
 *
 * Fail-closed by design: the integration is inert unless an operator explicitly
 * enables it AND supplies every required credential. Nothing in this module
 * logs or returns secret values.
 */

const DEFAULT_BASE_URL = 'https://api.lightspark.com/grid/2025-10-13';
const ALLOWED_HOSTS = new Set(['api.lightspark.com']);
const MODES = new Set(['sandbox', 'production']);

function bool(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function readConfig(env = process.env) {
  const enabled = bool(env.LIGHTSPARK_GRID_ENABLED);
  const mode = String(env.LIGHTSPARK_GRID_MODE || '').trim().toLowerCase();
  const rawBase = String(env.LIGHTSPARK_GRID_API_BASE_URL || '').trim();
  const baseUrl = rawBase || DEFAULT_BASE_URL;
  const issues = [];

  let parsedBase = null;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    issues.push('LIGHTSPARK_GRID_API_BASE_URL is not a valid URL');
  }
  if (parsedBase) {
    if (parsedBase.protocol !== 'https:') issues.push('Grid API base URL must use https');
    if (!ALLOWED_HOSTS.has(parsedBase.hostname.toLowerCase())) {
      issues.push('Grid API base URL host is not allowlisted');
    }
    if (parsedBase.username || parsedBase.password) {
      issues.push('Grid API base URL must not embed credentials');
    }
  }

  if (!MODES.has(mode)) issues.push('LIGHTSPARK_GRID_MODE must be sandbox or production');
  const clientId = String(env.LIGHTSPARK_GRID_CLIENT_ID || '').trim();
  const clientSecret = String(env.LIGHTSPARK_GRID_CLIENT_SECRET || '').trim();
  const webhookPublicKey = String(env.LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY || '').trim();
  const encryptionKeyRaw = String(env.VB_LIGHTSPARK_GRID_ENCRYPTION_KEY || '').trim();

  if (!clientId) issues.push('LIGHTSPARK_GRID_CLIENT_ID is required');
  if (!clientSecret) issues.push('LIGHTSPARK_GRID_CLIENT_SECRET is required');
  if (!webhookPublicKey.startsWith('-----BEGIN PUBLIC KEY-----')) {
    issues.push('LIGHTSPARK_GRID_WEBHOOK_PUBLIC_KEY must be a PEM SPKI public key');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyRaw)) {
    issues.push('VB_LIGHTSPARK_GRID_ENCRYPTION_KEY must be exactly 64 hex characters');
  }

  // Never allow "production" mode to be selected by accident. An explicit
  // acknowledgement flag is required in addition to the mode value.
  if (mode === 'production' && !bool(env.LIGHTSPARK_GRID_PRODUCTION_ACKNOWLEDGED)) {
    issues.push('LIGHTSPARK_GRID_PRODUCTION_ACKNOWLEDGED must be true for production mode');
  }

  return {
    enabled: enabled && issues.length === 0,
    requested: enabled,
    mode: mode || 'unset',
    baseUrl,
    clientId,
    clientSecret,
    webhookPublicKey,
    encryptionKey: Buffer.from(encryptionKeyRaw, 'hex'),
    customerAccessEnabled: bool(env.LIGHTSPARK_GRID_CUSTOMER_ACCESS_ENABLED),
    kycRedirectUri: String(env.LIGHTSPARK_GRID_KYC_REDIRECT_URI || '').trim(),
    requiredAgreements: String(env.LIGHTSPARK_GRID_REQUIRED_AGREEMENTS || '').trim(),
    issues,
  };
}

function describe(config) {
  return {
    enabled: config.enabled,
    requested: config.requested,
    mode: config.mode,
    baseUrl: config.baseUrl,
    credentialsPresent: Boolean(config.clientId && config.clientSecret),
    webhookKeyPresent: Boolean(config.webhookPublicKey),
    encryptionKeyPresent: config.encryptionKey && config.encryptionKey.length === 32,
    customerAccessEnabled: config.customerAccessEnabled,
    issues: config.issues.slice(),
  };
}

module.exports = { readConfig, describe, DEFAULT_BASE_URL, ALLOWED_HOSTS, MODES };
