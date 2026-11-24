'use strict';

const crypto = require('crypto');
const { GridError, classifyHttp, classifyNetwork } = require('./errors');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * HTTP transport for Lightspark Grid.
 *
 * - Base URL is fixed by (validated) configuration; callers pass only an
 *   internal path, never a user-supplied URL. No redirects are followed.
 * - Credentials are used for Basic auth and never appear in logs, errors or
 *   returned objects.
 * - Retries happen only for GET or for requests carrying a stable idempotency
 *   key. A timeout is classified as ambiguous, not as failure.
 */
function createGridClient(options) {
  const {
    config,
    fetchImpl = globalThis.fetch,
    logger = () => {},
    randomUUID = () => crypto.randomUUID(),
    sleep = defaultSleep,
  } = options || {};

  if (!config || !config.enabled) {
    return {
      async request() {
        throw new GridError('GRID_DISABLED', 'Lightspark Grid integration is not enabled.');
      },
    };
  }

  const authorization = 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const base = config.baseUrl.replace(/\/+$/, '');

  function buildUrl(path, query) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..') || path.includes('?')) {
      throw new GridError('GRID_INVALID_PATH', 'Invalid internal Grid request path.');
    }
    const url = new URL(base + path);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const entry of value) url.searchParams.append(key, String(entry));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async function once({ url, method, body, idempotencyKey, timeoutMs, requestId }) {
    const headers = {
      Accept: 'application/json',
      Authorization: authorization,
      'X-Request-ID': requestId,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const started = Date.now();
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const classified = classifyNetwork(error);
      classified.requestId = requestId;
      throw classified;
    }
    const durationMs = Date.now() - started;
    const providerRequestId = response.headers?.get?.('x-request-id')
      || response.headers?.get?.('grid-request-id')
      || null;

    logger({
      event: 'grid.http_request',
      method,
      path: new URL(url).pathname,
      status: response.status,
      durationMs,
      requestId,
      providerRequestId,
    });

    const text = await response.text().catch(() => '');
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new GridError('GRID_INVALID_RESPONSE', 'Grid returned a non-JSON success response.', {
            status: response.status, providerRequestId,
          });
        }
      }
    }

    if (!response.ok) throw classifyHttp(response.status, data, providerRequestId);
    return { data, status: response.status, providerRequestId, requestId };
  }

  async function request({
    method = 'GET',
    path,
    query,
    body,
    idempotencyKey,
    timeoutMs = 12000,
    maxAttempts = 3,
  }) {
    const idempotencySafe = method === 'GET' || Boolean(idempotencyKey);
    const attempts = idempotencySafe ? Math.max(1, maxAttempts) : 1;
    const url = buildUrl(path, query);
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const requestId = randomUUID();
      try {
        return await once({ url, method, body, idempotencyKey, timeoutMs, requestId });
      } catch (error) {
        lastError = error;
        const retryable = error instanceof GridError && error.retryable && idempotencySafe;
        if (!retryable || attempt === attempts) throw error;
        const backoffMs = 250 * (2 ** (attempt - 1));
        logger({
          event: 'grid.retry',
          method,
          path: new URL(url).pathname,
          attempt,
          requestId,
          retryable: true,
          ambiguous: error.ambiguous,
        });
        await sleep(backoffMs);
      }
    }
    throw lastError;
  }

  return { request, buildUrl };
}

module.exports = { createGridClient };
