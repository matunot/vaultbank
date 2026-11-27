'use strict';

const API_ORIGIN = 'https://app.moderntreasury.com';
const API_PREFIX = '/api';
const REQUEST_TIMEOUT_MS = 12000;

class ModernTreasuryApiError extends Error {
  constructor(message, { status = 502, code = 'MODERN_TREASURY_UPSTREAM_ERROR' } = {}) {
    super(message);
    this.name = 'ModernTreasuryApiError';
    this.status = status;
    this.code = code;
  }
}

function getConfig() {
  const organizationId = String(process.env.MODERN_TREASURY_ORGANIZATION_ID || '').trim();
  const apiKey = String(process.env.MODERN_TREASURY_API_KEY || '').trim();
  return {
    configured: Boolean(organizationId && apiKey),
    organizationId,
    apiKey,
  };
}

function assertSafePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('..')) {
    throw new ModernTreasuryApiError('Invalid Modern Treasury API path.', {
      status: 400,
      code: 'MODERN_TREASURY_PATH_INVALID',
    });
  }
}

async function request(path, { query = {}, method = 'GET' } = {}) {
  assertSafePath(path);
  const config = getConfig();
  if (!config.configured) {
    throw new ModernTreasuryApiError('Modern Treasury credentials are not configured on the server.', {
      status: 503,
      code: 'MODERN_TREASURY_NOT_CONFIGURED',
    });
  }
  if (method !== 'GET') {
    throw new ModernTreasuryApiError('This integration currently permits read-only API requests only.', {
      status: 405,
      code: 'MODERN_TREASURY_READ_ONLY',
    });
  }

  const url = new URL(API_PREFIX + path, API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const authorization = Buffer.from(config.organizationId + ':' + config.apiKey, 'utf8').toString('base64');
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic ' + authorization,
        'User-Agent': 'VaultBank/ModernTreasuryIntegration',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ModernTreasuryApiError(
      timedOut ? 'Modern Treasury request timed out.' : 'Could not reach Modern Treasury.',
      { status: 502, code: timedOut ? 'MODERN_TREASURY_TIMEOUT' : 'MODERN_TREASURY_NETWORK_ERROR' },
    );
  }

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch (_) {
      throw new ModernTreasuryApiError('Modern Treasury returned an invalid response.', {
        status: 502,
        code: 'MODERN_TREASURY_INVALID_RESPONSE',
      });
    }
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? response.status : 502;
    const code = response.status === 401
      ? 'MODERN_TREASURY_AUTH_FAILED'
      : response.status === 403
        ? 'MODERN_TREASURY_PERMISSION_DENIED'
        : response.status === 404
          ? 'MODERN_TREASURY_RESOURCE_NOT_FOUND'
          : 'MODERN_TREASURY_UPSTREAM_ERROR';
    throw new ModernTreasuryApiError(
      response.status === 401
        ? 'Modern Treasury rejected the Organization ID or API key.'
        : response.status === 403
          ? 'The configured Modern Treasury API key does not have permission for this read operation.'
          : response.status === 404
            ? 'The requested Modern Treasury API resource was not found.'
            : 'Modern Treasury request failed with HTTP ' + response.status + '.',
      { status, code },
    );
  }

  return payload;
}

function normalizeCurrentKey(payload) {
  const key = payload && (payload.api_key || payload.data || payload);
  if (!key || typeof key !== 'object') return {};
  return {
    id: typeof key.id === 'string' ? key.id : null,
    name: typeof key.name === 'string' ? key.name : null,
    liveMode: typeof key.live_mode === 'boolean' ? key.live_mode : null,
  };
}

async function checkConnection() {
  await request('/ping');
  const keyPayload = await request('/api_keys/current');
  const key = normalizeCurrentKey(keyPayload);
  return {
    connected: true,
    mode: key.liveMode === true ? 'live' : key.liveMode === false ? 'sandbox' : 'unknown',
    apiKey: { id: key.id, name: key.name },
  };
}

async function listInternalAccounts({ currency } = {}) {
  const query = { per_page: 25, status: 'active' };
  if (currency) query.currency = String(currency).trim().toUpperCase();
  const payload = await request('/internal_accounts', { query });
  const accounts = Array.isArray(payload) ? payload : Array.isArray(payload && payload.data) ? payload.data : [];
  return accounts.map((account) => ({
    id: typeof account.id === 'string' ? account.id : null,
    name: typeof account.name === 'string' ? account.name : null,
    title: typeof account.title === 'string' ? account.title : null,
    currency: typeof account.currency === 'string' ? account.currency : null,
    status: typeof account.status === 'string' ? account.status : null,
    accountType: typeof account.account_type === 'string' ? account.account_type : null,
    liveMode: typeof account.live_mode === 'boolean' ? account.live_mode : null,
  }));
}

module.exports = {
  ModernTreasuryApiError,
  getConfig,
  request,
  checkConnection,
  listInternalAccounts,
};
