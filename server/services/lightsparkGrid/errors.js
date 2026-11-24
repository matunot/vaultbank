'use strict';

/**
 * Typed Grid failures. `ambiguous` marks outcomes where a timeout or network
 * error means we must NOT assume the money did not move — the only safe next
 * step is reconciliation against Grid.
 */
class GridError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'GridError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = Boolean(options.retryable);
    this.ambiguous = Boolean(options.ambiguous);
    this.providerRequestId = options.providerRequestId || null;
    this.details = options.details || null;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const VALIDATION_STATUS = new Set([400, 404, 405, 409, 410, 412, 422]);
const AUTH_STATUS = new Set([401, 403]);

function classifyHttp(status, body, providerRequestId) {
  const code = (body && (body.code || body.error?.code)) || `HTTP_${status}`;
  const message = (body && (body.reason || body.message || body.error?.message)) || `Grid returned HTTP ${status}`;
  if (AUTH_STATUS.has(status)) {
    return new GridError('GRID_AUTHENTICATION_FAILED', 'Grid credentials were rejected.', {
      status, providerRequestId, retryable: false,
    });
  }
  if (status === 429) {
    return new GridError(code, message, { status, providerRequestId, retryable: true });
  }
  if (RETRYABLE_STATUS.has(status)) {
    return new GridError(code, message, {
      status, providerRequestId, retryable: true, ambiguous: status === 408 || status >= 500,
    });
  }
  if (VALIDATION_STATUS.has(status)) {
    return new GridError(code, message, { status, providerRequestId, retryable: false, details: body?.details || null });
  }
  return new GridError(code, message, { status, providerRequestId, retryable: false });
}

function classifyNetwork(error) {
  const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    || /timeout|aborted/i.test(String(error?.message || ''));
  return new GridError(
    timeout ? 'GRID_REQUEST_TIMEOUT' : 'GRID_NETWORK_ERROR',
    timeout
      ? 'Grid did not answer in time. The payment outcome is unknown and must be reconciled.'
      : 'Grid could not be reached. The payment outcome may be unknown.',
    { retryable: true, ambiguous: true },
  );
}

module.exports = {
  GridError,
  classifyHttp,
  classifyNetwork,
  RETRYABLE_STATUS,
  VALIDATION_STATUS,
  AUTH_STATUS,
};
