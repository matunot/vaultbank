'use strict';

const crypto = require('crypto');

class GridWebhookSignatureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GridWebhookSignatureError';
    this.code = code;
  }
}

/**
 * Verify the Grid webhook signature using the current Grid API contract.
 * X-Grid-Signature is JSON: { "v": "1", "s": "<base64 DER ECDSA signature>" }.
 * Grid's published Node example hashes the raw body with SHA-256, then passes
 * that digest to createVerify("SHA256"). Keep this exact sequence.
 */
function verifyGridWebhookSignature({ rawBody, signatureHeader, publicKeyPem }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_RAW_BODY_MISSING', 'Raw webhook body is unavailable.');
  }
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.trim()) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_PUBLIC_KEY_NOT_CONFIGURED', 'Grid webhook public key is not configured.');
  }
  if (typeof signatureHeader !== 'string' || signatureHeader.length > 4096) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_MISSING', 'Grid webhook signature is missing or invalid.');
  }

  let envelope;
  try {
    envelope = JSON.parse(signatureHeader);
  } catch (_) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_FORMAT_INVALID', 'Grid webhook signature envelope is invalid.');
  }
  if (!envelope || (envelope.v !== '1' && envelope.v !== 1) || typeof envelope.s !== 'string') {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_VERSION_UNSUPPORTED', 'Grid webhook signature version is unsupported.');
  }

  const encoded = envelope.s;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_ENCODING_INVALID', 'Grid webhook signature encoding is invalid.');
  }
  const signature = Buffer.from(encoded, 'base64');
  if (!signature.length || signature.length < 64 || signature.length > 128
      || signature.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_ENCODING_INVALID', 'Grid webhook signature encoding is invalid.');
  }

  let publicKey;
  try {
    const pem = publicKeyPem.replace(/\\n/g, '\n').trim();
    publicKey = crypto.createPublicKey({ key: pem, format: 'pem', type: 'spki' });
  } catch (_) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_PUBLIC_KEY_INVALID', 'Grid webhook public key is not a valid PEM public key.');
  }

  const curve = publicKey.asymmetricKeyDetails && publicKey.asymmetricKeyDetails.namedCurve;
  if (publicKey.asymmetricKeyType !== 'ec' || (curve && !['prime256v1', 'secp256r1'].includes(curve))) {
    throw new GridWebhookSignatureError('GRID_WEBHOOK_PUBLIC_KEY_INVALID', 'Grid webhook public key must use the P-256 curve.');
  }

  try {
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest();
    const verifier = crypto.createVerify('SHA256');
    verifier.update(bodyHash);
    verifier.end();
    if (!verifier.verify(publicKey, signature)) {
      throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_INVALID', 'Grid webhook signature verification failed.');
    }
  } catch (error) {
    if (error instanceof GridWebhookSignatureError) throw error;
    throw new GridWebhookSignatureError('GRID_WEBHOOK_SIGNATURE_INVALID', 'Grid webhook signature verification failed.');
  }

  return { version: String(envelope.v) };
}

function nullableText(value, maxLength = 255) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function amountMinorUnits(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,37})$/.test(value)) return value;
  return null;
}

function currencyCode(value) {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value)
    ? value.toUpperCase()
    : null;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Extract only operational metadata. Never persist the raw webhook body,
 * counterpartyInformation, bank details, names, dates of birth or signatures.
 */
function normalizeGridWebhook(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Webhook payload must be a JSON object.');
    error.code = 'GRID_WEBHOOK_PAYLOAD_INVALID';
    throw error;
  }

  const webhookId = nullableText(payload.webhookId || payload.id, 255);
  const eventType = nullableText(payload.type, 80);
  if (!webhookId || !eventType) {
    const error = new Error('Webhook payload must include webhookId and type.');
    error.code = 'GRID_WEBHOOK_PAYLOAD_INVALID';
    throw error;
  }

  const transaction = payload.transaction && typeof payload.transaction === 'object'
    && !Array.isArray(payload.transaction) ? payload.transaction : {};
  const sentAmount = transaction.sentAmount && typeof transaction.sentAmount === 'object'
    ? transaction.sentAmount : {};
  const receivedAmount = transaction.receivedAmount && typeof transaction.receivedAmount === 'object'
    ? transaction.receivedAmount : {};
  const sentCurrency = sentAmount.currency && typeof sentAmount.currency === 'object'
    ? sentAmount.currency : {};
  const receivedCurrency = receivedAmount.currency && typeof receivedAmount.currency === 'object'
    ? receivedAmount.currency : {};
  const reconciliation = transaction.reconciliationInstructions
    && typeof transaction.reconciliationInstructions === 'object'
    ? transaction.reconciliationInstructions : {};

  return {
    webhookId,
    eventType: eventType.toUpperCase(),
    transactionId: nullableText(transaction.transactionId, 255),
    transactionDirection: nullableText(transaction.type, 32),
    transactionStatus: nullableText(transaction.status, 40),
    quoteId: nullableText(transaction.quoteId, 255),
    providerUserId: nullableText(transaction.userId, 255),
    platformUserId: nullableText(transaction.platformUserId, 255),
    sentAmountMinor: amountMinorUnits(sentAmount.amount),
    sentCurrency: currencyCode(sentCurrency.code),
    receivedAmountMinor: amountMinorUnits(receivedAmount.amount),
    receivedCurrency: currencyCode(receivedCurrency.code),
    reconciliationReference: nullableText(reconciliation.reference, 255),
    providerTimestamp: validTimestamp(payload.timestamp),
  };
}


function chooseGridWebhookDisposition(event) {
  if (event.eventType === 'INCOMING_PAYMENT'
      && String(event.transactionStatus || '').toUpperCase() === 'PENDING') {
    // Grid treats HTTP 200 for an incoming PENDING event as approval.
    // Until the inbound compliance/approval flow exists, fail closed.
    return {
      disposition: 'rejected_inbound_approval_disabled',
      status: 403,
      body: {
        code: 'REJECTED_BY_PLATFORM',
        message: 'VaultBank has not enabled its Grid inbound-payment approval workflow.',
        reason: 'FAILED_COUNTERPARTY_CHECK',
      },
    };
  }

  if (event.eventType === 'OUTGOING_PAYMENT' || event.eventType === 'INCOMING_PAYMENT') {
    return {
      disposition: 'awaiting_ledger_reconciliation',
      status: 200,
      body: { received: true },
    };
  }

  return {
    disposition: 'ignored_unknown_event_type',
    status: 200,
    body: { received: true, ignored: true },
  };
}

module.exports = {
  GridWebhookSignatureError,
  verifyGridWebhookSignature,
  normalizeGridWebhook,
  chooseGridWebhookDisposition,
};
