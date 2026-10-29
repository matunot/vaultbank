'use strict';

const MAX_ENTRIES = 500;
const MAX_TRACE_SEQUENCE = 9999999;

function parseUsdCents(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('USD amount must be a positive decimal with at most two fractional digits.');
  }
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents <= 0n || cents > 9999999999n) throw new Error('USD amount is outside the ACH amount field range.');
  return cents;
}

function validAbaRoutingNumber(value) {
  const routing = String(value || '').trim();
  if (!/^\d{9}$/.test(routing)) return false;
  const digits = routing.split('').map(Number);
  const checksum = digits[0] * 3 + digits[1] * 7 + digits[2]
    + digits[3] * 3 + digits[4] * 7 + digits[5]
    + digits[6] * 3 + digits[7] * 7 + digits[8];
  return checksum % 10 === 0;
}

function requireAba(value, label) {
  const routing = String(value || '').trim();
  if (!validAbaRoutingNumber(routing)) throw new Error(label + ' must be a valid nine-digit ABA routing number.');
  return routing;
}

function safeText(value, length, label, { required = true } = {}) {
  const source = String(value == null ? '' : value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  if (required && !source) throw new Error(label + ' is required.');
  // Deliberately restrict to an ASCII subset commonly accepted by ACH systems.
  // No control characters, Unicode bytes, or line breaks can enter fixed-width records.
  if (!/^[A-Z0-9 &.,/+\-]*$/.test(source)) throw new Error(label + ' contains characters not allowed by the configured ACH file profile.');
  if (source.length > length) throw new Error(label + ' exceeds the ACH field length of ' + length + ' characters.');
  return source.padEnd(length, ' ');
}

function numeric(value, length, label) {
  const text = String(value);
  if (!/^\d+$/.test(text) || text.length > length) throw new Error(label + ' does not fit its numeric ACH field.');
  return text.padStart(length, '0');
}

function record(parts) {
  const line = parts.join('');
  if (line.length !== 94 || /[^\x20-\x7E]/.test(line)) throw new Error('Generated ACH record must be 94 ASCII characters.');
  return line;
}

function parseEffectiveDate(value, now = new Date()) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Effective date must use YYYY-MM-DD.');
  const date = new Date(text + 'T12:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('Effective date is not a valid calendar date.');
  }
  const day = date.getUTCDay();
  if (day === 0 || day === 6) throw new Error('ACH effective date cannot be a weekend.');
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  if (date.getTime() < today.getTime()) throw new Error('ACH effective date cannot be in the past.');
  return text;
}

function dateYYMMDD(value) {
  return String(value).slice(2, 4) + String(value).slice(5, 7) + String(value).slice(8, 10);
}

function fixedDateTime(now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('File creation time is invalid.');
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return { date: yy + mm + dd, time: hh + min, fullDate: date.toISOString().slice(0, 10) };
}

function buildNachaCreditFile({ config, payouts, effectiveDate, fileIdModifier, traceSequenceStart = 1, now = new Date() }) {
  if (!config || typeof config !== 'object') throw new Error('ODFI file configuration is required.');
  if (!Array.isArray(payouts) || payouts.length < 1 || payouts.length > MAX_ENTRIES) {
    throw new Error('An ACH export must contain between 1 and ' + MAX_ENTRIES + ' payouts.');
  }
  const odfiRouting = requireAba(config.odfiRoutingNumber, 'ODFI routing number');
  const immediateOrigin = safeText(config.immediateOrigin, 10, 'Immediate origin');
  const odfiName = safeText(config.odfiName, 23, 'ODFI name');
  const immediateOriginName = safeText(config.immediateOriginName, 23, 'Immediate origin name');
  const companyName = safeText(config.companyName, 16, 'Originator company name');
  const companyId = safeText(config.companyId, 10, 'ODFI-assigned company ID');
  const companyDescription = safeText(config.companyEntryDescription || 'PAYMENT', 10, 'Company entry description');
  const modifier = String(fileIdModifier || '').toUpperCase();
  if (!/^[A-Z0-9]$/.test(modifier)) throw new Error('ACH file ID modifier must be one alphanumeric character.');
  if (!Number.isSafeInteger(traceSequenceStart) || traceSequenceStart < 1 || traceSequenceStart + payouts.length - 1 > MAX_TRACE_SEQUENCE) {
    throw new Error('ACH trace sequence is outside the seven-digit range; request a new ODFI-approved sequence.');
  }
  const effective = parseEffectiveDate(effectiveDate, now);
  const created = fixedDateTime(now);
  const odfiPrefix = odfiRouting.slice(0, 8);

  const detailRows = [];
  let creditTotal = 0n;
  let entryHash = 0n;
  for (let i = 0; i < payouts.length; i++) {
    const payout = payouts[i] || {};
    const routing = requireAba(payout.routingNumber, 'Receiver routing number');
    const accountNumber = String(payout.accountNumber || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,17}$/.test(accountNumber)) throw new Error('Receiver account number must be 1-17 ASCII letters, digits, or hyphens.');
    const accountType = String(payout.accountType || '').trim().toLowerCase();
    const transactionCode = accountType === 'checking' ? '22' : accountType === 'savings' ? '32' : null;
    if (!transactionCode) throw new Error('Receiver account type must be checking or savings.');
    const beneficiaryName = safeText(payout.beneficiaryName, 22, 'Receiver name');
    const requestReference = String(payout.requestReference || '').replace(/[^A-Za-z0-9-]/g, '');
    if (!requestReference) throw new Error('Payout reference is required.');
    const individualId = safeText(requestReference, 15, 'Receiver identification');
    const amountCents = parseUsdCents(payout.amount);
    const trace = odfiPrefix + numeric(traceSequenceStart + i, 7, 'Trace sequence');

    const line = record([
      '6', transactionCode, routing.slice(0, 8), routing.slice(8),
      safeText(accountNumber, 17, 'Receiver account number'),
      numeric(amountCents.toString(), 10, 'ACH entry amount'),
      individualId, beneficiaryName, '  ', '0', trace,
    ]);
    detailRows.push(line);
    creditTotal += amountCents;
    entryHash += BigInt(routing.slice(0, 8));
  }

  if (creditTotal > 999999999999n) throw new Error('Batch credit total exceeds the ACH control-record capacity.');
  const hash10 = numeric((entryHash % 10000000000n).toString(), 10, 'Entry hash');
  const entryCount6 = numeric(detailRows.length, 6, 'Entry count');
  const batchNumber = '0000001';
  const batchHeader = record([
    '5', '220', companyName, ' '.repeat(20), companyId, 'PPD',
    companyDescription, ' '.repeat(6), dateYYMMDD(effective), '   ', '1',
    odfiPrefix, batchNumber,
  ]);
  const batchControl = record([
    '8', '220', entryCount6, hash10, numeric('0', 12, 'Debit total'),
    numeric(creditTotal.toString(), 12, 'Credit total'), companyId,
    ' '.repeat(19), ' '.repeat(6), odfiPrefix, batchNumber,
  ]);
  const fileHeader = record([
    '1', '01', ' ' + odfiRouting, immediateOrigin,
    created.date, created.time, modifier, '094', '10', '1',
    odfiName, immediateOriginName, ' '.repeat(8),
  ]);
  const unpaddedRows = [fileHeader, batchHeader, ...detailRows, batchControl];
  const fileControl = record([
    '9', numeric('1', 6, 'Batch count'),
    numeric(Math.ceil((unpaddedRows.length + 1) / 10), 6, 'Block count'),
    numeric(detailRows.length, 8, 'File entry count'), hash10,
    numeric('0', 12, 'File debit total'), numeric(creditTotal.toString(), 12, 'File credit total'),
    ' '.repeat(39),
  ]);
  const rows = [...unpaddedRows, fileControl];
  const paddingCount = (10 - (rows.length % 10)) % 10;
  for (let i = 0; i < paddingCount; i++) rows.push('9'.repeat(94));
  // Recalculate block count with the padding rows, as required by the file control record.
  const finalBlockCount = rows.length / 10;
  const correctedFileControl = record([
    '9', numeric('1', 6, 'Batch count'), numeric(finalBlockCount, 6, 'Block count'),
    numeric(detailRows.length, 8, 'File entry count'), hash10,
    numeric('0', 12, 'File debit total'), numeric(creditTotal.toString(), 12, 'File credit total'),
    ' '.repeat(39),
  ]);
  rows[rows.length - paddingCount - 1] = correctedFileControl;
  if (rows.some((line) => line.length !== 94) || rows.length % 10 !== 0) {
    throw new Error('Generated ACH file failed fixed-width/block-size validation.');
  }
  return {
    content: rows.join('\r\n') + '\r\n',
    recordCount: rows.length,
    entryCount: detailRows.length,
    blockCount: finalBlockCount,
    totalCredit: (creditTotal / 100n).toString() + '.' + (creditTotal % 100n).toString().padStart(2, '0'),
    effectiveDate: effective,
    fileIdModifier: modifier,
    traceNumbers: detailRows.map((line) => line.slice(79, 94)),
  };
}

module.exports = {
  buildNachaCreditFile,
  validAbaRoutingNumber,
  parseUsdCents,
  parseEffectiveDate,
  MAX_ENTRIES,
};
