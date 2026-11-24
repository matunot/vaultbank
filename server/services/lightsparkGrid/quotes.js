'use strict';

const crypto = require('crypto');
const { GridError } = require('./errors');
const store = require('./store');

function assertMinorAmount(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 9000000000000000) {
    throw new GridError('GRID_INVALID_AMOUNT', 'Amount must be a positive integer in the smallest currency unit.');
  }
  return value;
}

function assertCurrency(value) {
  const code = String(value || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new GridError('GRID_INVALID_CURRENCY', 'Currency must be a three-letter ISO code.');
  }
  return code;
}

function stableIdempotencyKey(prefix, payload) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
  return `${prefix}-${digest}`;
}

function validateProviderQuote(quote) {
  if (!quote || !quote.id || !quote.transactionId || !quote.expiresAt) {
    throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid quote response is missing required identifiers.');
  }
  if (Number(quote.sendingCurrency?.decimals) !== 2 || Number(quote.receivingCurrency?.decimals) !== 2) {
    throw new GridError('GRID_PRECISION_UNSUPPORTED', 'This corridor uses a currency precision the ledger does not support.');
  }
  if (!Number.isSafeInteger(quote.totalSendingAmount) || !Number.isSafeInteger(quote.totalReceivingAmount)) {
    throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid quote amounts were not integer minor units.');
  }
  return quote;
}

function publicQuote(row) {
  return {
    id: row.id,
    providerQuoteId: row.provider_quote_id || row.providerQuoteId,
    status: row.status,
    sendingCurrency: row.sending_currency || row.sendingCurrency,
    receivingCurrency: row.receiving_currency || row.receivingCurrency,
    sendingAmountMinor: Number(row.sending_amount_minor ?? row.sendingAmountMinor),
    receivingAmountMinor: Number(row.receiving_amount_minor ?? row.receivingAmountMinor),
    exchangeRate: row.exchange_rate ?? row.exchangeRate,
    fees: row.fees,
    expiresAt: row.expires_at || row.expiresAt,
    providerTransactionId: row.provider_transaction_id || row.providerTransactionId || null,
  };
}

function createQuoteService({ client, accounts, data = store, now = () => Date.now() }) {
  async function createQuote({
    userId, beneficiaryId, sendingCurrency, sendingAmountMinor,
    lockedCurrencySide = 'SENDING', paymentRail, lookupId, description, remittanceInformation,
  }) {
    const sourceCurrency = assertCurrency(sendingCurrency);
    const amount = assertMinorAmount(Number(sendingAmountMinor));
    const side = String(lockedCurrencySide || 'SENDING').toUpperCase();
    if (!['SENDING', 'RECEIVING'].includes(side)) {
      throw new GridError('GRID_INVALID_LOCK_SIDE', 'lockedCurrencySide must be SENDING or RECEIVING.');
    }
    const beneficiary = await data.getBeneficiary(userId, beneficiaryId);
    if (!beneficiary) throw new GridError('GRID_BENEFICIARY_NOT_FOUND', 'Beneficiary not found.');
    const internal = await accounts.getInternalAccount(userId, sourceCurrency);

    const destination = {
      destinationType: 'ACCOUNT',
      accountId: beneficiary.provider_external_account_id,
    };
    if (paymentRail) destination.paymentRail = String(paymentRail).slice(0, 40);
    const body = {
      source: { sourceType: 'ACCOUNT', accountId: internal.provider_account_id },
      destination,
      lockedCurrencySide: side,
      lockedCurrencyAmount: amount,
      description: String(description || 'VaultBank international payout').slice(0, 1024),
      // VaultBank's own idempotent payment reference double-checks Grid's.
      platformTransactionId: `vb-grid-${crypto.randomUUID()}`,
    };
    if (lookupId) body.lookupId = String(lookupId).slice(0, 255);
    if (remittanceInformation) body.remittanceInformation = String(remittanceInformation).slice(0, 80);

    const idempotencyKey = stableIdempotencyKey('vb-grid-quote', {
      userId, source: body.source.accountId, destination: destination.accountId,
      side, amount, lookupId: lookupId || null, paymentRail: paymentRail || null,
    });

    const response = await client.request({
      method: 'POST',
      path: '/quotes',
      body,
      idempotencyKey,
      timeoutMs: 20000,
    });
    const quote = validateProviderQuote(response?.data);
    const row = await data.saveQuote({
      userId,
      beneficiaryId,
      providerQuoteId: String(quote.id),
      providerTransactionId: String(quote.transactionId),
      sourceAccountId: String(quote.source?.accountId || internal.provider_account_id),
      destinationAccountId: String(quote.destination?.accountId || beneficiary.provider_external_account_id),
      sendingCurrency: String(quote.sendingCurrency.code).toUpperCase(),
      receivingCurrency: String(quote.receivingCurrency.code).toUpperCase(),
      sendingAmountMinor: quote.totalSendingAmount,
      receivingAmountMinor: quote.totalReceivingAmount,
      exchangeRate: String(quote.exchangeRate),
      fees: {
        feesIncluded: quote.feesIncluded ?? null,
        platformFeesIncluded: quote.platformFeesIncluded ?? null,
        providerFees: quote.fees ?? null,
      },
      status: String(quote.status),
      expiresAt: new Date(String(quote.expiresAt)).toISOString(),
      idempotencyKey,
      providerResponse: quote,
    });
    return publicQuote(row);
  }

  async function getQuote(userId, id) {
    const row = await data.getQuote(userId, id);
    if (!row) throw new GridError('GRID_QUOTE_NOT_FOUND', 'Quote not found.');
    return publicQuote(row);
  }

  async function executeQuote({ userId, quoteId, idempotencyKey }) {
    const row = await data.getQuote(userId, quoteId);
    if (!row) throw new GridError('GRID_QUOTE_NOT_FOUND', 'Quote not found.');
    if (Date.parse(row.expires_at) <= now()) {
      throw new GridError('GRID_QUOTE_EXPIRED', 'The quote expired. Request a fresh quote before sending.');
    }
    if (row.status === 'EXECUTED' || row.status === 'PROCESSING') {
      return publicQuote(row);
    }
    const key = String(idempotencyKey || '').trim();
    if (!key || key.length > 255) {
      throw new GridError('GRID_IDEMPOTENCY_REQUIRED', 'A stable idempotency key is required to execute a quote.');
    }
    const response = await client.request({
      method: 'POST',
      path: `/quotes/${encodeURIComponent(row.provider_quote_id)}/execute`,
      idempotencyKey: key,
      timeoutMs: 20000,
    });
    const quote = response?.data;
    if (!quote || !quote.id || !quote.transactionId) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid execution response was incomplete.');
    }
    const updated = await data.saveQuote({
      id: row.id,
      userId,
      beneficiaryId: row.beneficiary_id,
      providerQuoteId: String(quote.id),
      providerTransactionId: String(quote.transactionId),
      sourceAccountId: row.source_account_id,
      destinationAccountId: row.destination_account_id,
      sendingCurrency: row.sending_currency,
      receivingCurrency: row.receiving_currency,
      sendingAmountMinor: quote.totalSendingAmount ?? row.sending_amount_minor,
      receivingAmountMinor: quote.totalReceivingAmount ?? row.receiving_amount_minor,
      exchangeRate: String(quote.exchangeRate ?? row.exchange_rate),
      fees: row.fees,
      status: String(quote.status || 'PROCESSING'),
      expiresAt: row.expires_at,
      idempotencyKey: row.idempotency_key,
      providerResponse: quote,
    });
    return publicQuote(updated);
  }

  return { createQuote, getQuote, executeQuote, validateProviderQuote };
}

module.exports = { createQuoteService, validateProviderQuote, assertMinorAmount, stableIdempotencyKey };
