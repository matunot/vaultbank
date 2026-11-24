'use strict';

const crypto = require('crypto');
const { db } = require('../../config/db');
const {
  ensureVaultLedgerSchema,
  ensureCustomerLedgerAccount,
  changeVerifiedAvailableBalance,
  postBalancedJournal,
} = require('../ledgerJournalService');
const { GridError } = require('./errors');
const store = require('./store');

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'REJECTED', 'REFUNDED', 'EXPIRED']);
const RELEASE_STATUSES = new Set(['FAILED', 'REJECTED', 'REFUNDED']);

function minorToDecimal(minor) {
  const value = Number(minor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GridError('GRID_INVALID_AMOUNT', 'Minor amount is out of range.');
  }
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

function publicPayment(row) {
  return {
    id: row.id,
    status: row.status,
    providerTransactionId: row.provider_transaction_id || null,
    providerQuoteId: row.provider_quote_id,
    reference: row.reference,
    currency: row.currency,
    amount: Number(row.amount),
    failureReason: row.failure_reason || null,
    settlementReference: row.settlement_reference || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

function eventTransactionIds(payload) {
  const data = payload?.data || {};
  const candidates = [data.id, data.transactionId, data.transaction?.id, data.transaction?.transactionId];
  return candidates.filter((value) => typeof value === 'string' && value.startsWith('Transaction:'));
}

function createPaymentService({ client, quotes, config, data = store, logger = () => {} }) {
  /**
   * Reserve funds in the existing double-entry ledger, then execute a
   * provider-locked quote. A timeout never releases the reservation; it
   * becomes reconciliation_required so a human/provider check decides.
   */
  async function createPayout({ userId, quoteId, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (key.length < 12 || key.length > 255) {
      throw new GridError('GRID_IDEMPOTENCY_REQUIRED', 'A stable idempotency key of 12-255 characters is required.');
    }
    const existing = await data.getPaymentByIdempotencyKey(key);
    if (existing) {
      if (existing.user_id !== userId) {
        throw new GridError('GRID_IDEMPOTENCY_CONFLICT', 'This idempotency key belongs to another customer.');
      }
      return publicPayment(existing);
    }

    const quote = await data.getQuote(userId, quoteId);
    if (!quote) throw new GridError('GRID_QUOTE_NOT_FOUND', 'Quote not found.');
    const amount = minorToDecimal(quote.sending_amount_minor);
    const currency = String(quote.sending_currency).toUpperCase();
    const reference = `grid-${crypto.randomUUID()}`;
    const reservationSourceId = `grid-reservation-${reference}`;

    let reserved;
    let clientTransaction;
    try {
      await ensureVaultLedgerSchema();
      await data.ensureTables();
      clientTransaction = await db.getClient();
      await clientTransaction.query('BEGIN');

      const accountResult = await clientTransaction.query(
        `SELECT id, currency FROM accounts
         WHERE user_id = $1 AND UPPER(currency) = $2 AND status = 'active'
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        [userId, currency],
      );
      const account = accountResult.rows[0];
      if (!account) {
        throw new GridError('GRID_ACCOUNT_NOT_FOUND', `No active VaultBank ${currency} account was found.`);
      }

      await ensureCustomerLedgerAccount(clientTransaction, account.id);
      try {
        await changeVerifiedAvailableBalance(clientTransaction, account.id, amount, 'debit');
      } catch (error) {
        if (error?.code === 'VB_LEDGER_VERIFIED_FUNDS_INSUFFICIENT') {
          throw new GridError('GRID_UNVERIFIED_FUNDS', 'Insufficient verified spendable funds for this payout.');
        }
        throw error;
      }

      const debit = await clientTransaction.query(
        `UPDATE accounts SET balance = balance - $2, available_balance = available_balance - $2
         WHERE id = $1 AND user_id = $3 AND UPPER(currency) = $4 AND status = 'active' AND available_balance >= $2
         RETURNING (balance + $2) AS balance_before, balance AS balance_after`,
        [account.id, amount, userId, currency],
      );
      if (!debit.rows.length) {
        throw new GridError('GRID_INSUFFICIENT_FUNDS', 'Insufficient available balance for this payout.');
      }

      const payment = await data.createPayment({
        userId,
        accountId: account.id,
        quoteId: quote.id,
        providerQuoteId: quote.provider_quote_id,
        reference,
        idempotencyKey: key,
        reservationSourceId,
        amount,
        currency,
        status: 'reserved',
        metadata: { sendingAmountMinor: quote.sending_amount_minor, mode: config.mode },
      }, clientTransaction);
      if (!payment) {
        throw new GridError('GRID_IDEMPOTENCY_CONFLICT', 'This payout key was already used.');
      }

      await clientTransaction.query(
        `INSERT INTO transactions
          (account_id, user_id, type, status, amount, currency, balance_before, balance_after,
           description, category, external_reference, metadata)
         VALUES ($1,$2,'withdrawal','processing',$3,$4,$5,$6,$7,'expense',$8,$9::jsonb)`,
        [account.id, userId, -Number(amount), currency, debit.rows[0].balance_before,
          debit.rows[0].balance_after, `VaultBank Grid payout ${reference}`, reference,
          JSON.stringify({ rail: 'lightspark-grid', automaticTransfer: true, providerQuoteId: quote.provider_quote_id })],
      );

      await postBalancedJournal(clientTransaction, {
        eventType: 'payout_reserved',
        sourceType: 'lightspark_grid_payout',
        sourceId: reservationSourceId,
        currency,
        description: 'Lightspark Grid payout reserved pending provider settlement',
        actorUserId: userId,
        metadata: { reference, providerQuoteId: quote.provider_quote_id },
        entries: [
          { accountId: account.id, side: 'debit', amount },
          { systemCode: 'OUTBOUND_PAYOUTS_PAYABLE', side: 'credit', amount },
        ],
      });

      await clientTransaction.query('COMMIT');
      reserved = payment;
    } catch (error) {
      if (clientTransaction) {
        try { await clientTransaction.query('ROLLBACK'); } catch { /* ignore */ }
      }
      throw error;
    } finally {
      if (clientTransaction) clientTransaction.release();
    }

    // Execution happens after the reservation commits. Retrying this call with
    // the same key replays the stored payment rather than reserving again.
    try {
      const executed = await quotes.executeQuote({ userId, quoteId, idempotencyKey: key });
      const updated = await data.updatePayment(reserved.id, {
        status: 'processing',
        providerTransactionId: executed.providerTransactionId,
      });
      logger({ event: 'grid.payout_executed', paymentId: reserved.id, status: executed.status });
      return publicPayment(updated || reserved);
    } catch (error) {
      const ambiguous = error?.ambiguous || /TIMEOUT|NETWORK|AMBIGUOUS/i.test(String(error?.code || ''));
      if (ambiguous) {
        // Never assume a timed-out execution failed; and never release a
        // reservation on an ambiguous outcome.
        const updated = await data.updatePayment(reserved.id, { status: 'reconciliation_required' });
        await data.recordReconciliation({
          paymentId: reserved.id,
          providerQuoteId: quote.provider_quote_id,
          source: 'execution_timeout',
          observedStatus: 'UNKNOWN',
          evidence: { code: error.code },
        });
        logger({ event: 'grid.payout_ambiguous', paymentId: reserved.id, code: error.code });
        return publicPayment(updated);
      }
      await releaseReservation({ paymentId: reserved.id, actorUserId: userId, reason: error?.message || 'Grid rejected the quote' });
      const updated = await data.updatePayment(reserved.id, {
        status: 'failed',
        failureReason: String(error?.message || 'Grid execution failed').slice(0, 500),
      });
      return publicPayment(updated);
    }
  }

  async function releaseReservation({ paymentId, actorUserId, reason }) {
    let clientTransaction;
    try {
      await ensureVaultLedgerSchema();
      clientTransaction = await db.getClient();
      await clientTransaction.query('BEGIN');
      const selected = await clientTransaction.query(
        'SELECT * FROM grid_payments WHERE id = $1 FOR UPDATE',
        [paymentId],
      );
      const payment = selected.rows[0];
      if (!payment || ['completed', 'refunded', 'failed'].includes(payment.status)) {
        await clientTransaction.query('ROLLBACK');
        return false;
      }
      await changeVerifiedAvailableBalance(clientTransaction, payment.account_id, String(payment.amount), 'credit');
      const refund = await clientTransaction.query(
        `UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2
         WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
        [payment.account_id, Number(payment.amount)],
      );
      if (!refund.rows.length) throw new GridError('GRID_REFUND_ACCOUNT_MISSING', 'Refund account is missing.');
      await clientTransaction.query(
        `INSERT INTO transactions
          (account_id, user_id, type, status, amount, currency, balance_before, balance_after,
           description, category, external_reference, metadata)
         VALUES ($1,$2,'refund','completed',$3,$4,$5,$6,$7,'income',$8,$9::jsonb)`,
        [payment.account_id, payment.user_id, Number(payment.amount), payment.currency,
          refund.rows[0].balance_before, refund.rows[0].balance_after,
          `VaultBank Grid payout ${payment.reference} refunded`, `grid-refund-${payment.reference}`,
          JSON.stringify({ rail: 'lightspark-grid', reason: String(reason).slice(0, 500) })],
      );
      await postBalancedJournal(clientTransaction, {
        eventType: 'payout_refund',
        sourceType: 'lightspark_grid_payout',
        sourceId: payment.reservation_source_id,
        currency: payment.currency,
        description: 'Lightspark Grid payout reservation released',
        actorUserId: actorUserId || payment.user_id,
        metadata: { reference: payment.reference, reason: String(reason).slice(0, 500) },
        entries: [
          { systemCode: 'OUTBOUND_PAYOUTS_PAYABLE', side: 'debit', amount: String(payment.amount) },
          { accountId: payment.account_id, side: 'credit', amount: String(payment.amount) },
        ],
      });
      await clientTransaction.query('COMMIT');
      return true;
    } catch (error) {
      if (clientTransaction) {
        try { await clientTransaction.query('ROLLBACK'); } catch { /* ignore */ }
      }
      throw error;
    } finally {
      if (clientTransaction) clientTransaction.release();
    }
  }

  async function settleReservation({ payment, settledAt }) {
    let clientTransaction;
    try {
      await ensureVaultLedgerSchema();
      clientTransaction = await db.getClient();
      await clientTransaction.query('BEGIN');
      const selected = await clientTransaction.query(
        'SELECT * FROM grid_payments WHERE id = $1 FOR UPDATE',
        [payment.id],
      );
      const current = selected.rows[0];
      if (!current || current.status === 'completed') {
        await clientTransaction.query('ROLLBACK');
        return false;
      }
      if (['failed', 'refunded', 'reconciliation_required'].includes(current.status)) {
        await clientTransaction.query('ROLLBACK');
        await data.recordReconciliation({
          paymentId: current.id,
          providerTransactionId: current.provider_transaction_id,
          source: 'webhook_conflict',
          observedStatus: 'COMPLETED',
          evidence: { settledAt: settledAt || null, previousStatus: current.status },
        });
        throw new GridError('GRID_SETTLEMENT_CONFLICT', 'Settlement conflicts with the current payment state; operator review required.');
      }
      await postBalancedJournal(clientTransaction, {
        eventType: 'payout_settled',
        sourceType: 'lightspark_grid_payout',
        sourceId: current.reservation_source_id,
        currency: current.currency,
        description: 'Lightspark Grid payout confirmed settled by provider',
        actorUserId: null,
        metadata: { reference: current.reference, settledAt: settledAt || null },
        entries: [
          { systemCode: 'OUTBOUND_PAYOUTS_PAYABLE', side: 'debit', amount: String(current.amount) },
          { systemCode: 'BANK_SETTLEMENT_ASSET', side: 'credit', amount: String(current.amount) },
        ],
      });
      await clientTransaction.query(
        `UPDATE transactions SET status = 'completed', settled_at = COALESCE(settled_at, $2)
         WHERE external_reference = $1 AND type = 'withdrawal'`,
        [current.reference, settledAt || null],
      );
      await data.updatePayment(current.id, {
        status: 'completed',
        settlementReference: current.provider_transaction_id,
      }, clientTransaction);
      await clientTransaction.query('COMMIT');
      return true;
    } catch (error) {
      if (clientTransaction) {
        try { await clientTransaction.query('ROLLBACK'); } catch { /* ignore */ }
      }
      throw error;
    } finally {
      if (clientTransaction) clientTransaction.release();
    }
  }

  async function applyOutgoingEvent(payload) {
    const ids = eventTransactionIds(payload);
    let payment = null;
    for (const id of ids) {
      payment = await data.getPaymentByProviderTransactionId(id);
      if (payment) break;
    }
    if (!payment) {
      await data.recordReconciliation({
        providerTransactionId: ids[0] || null,
        source: 'webhook_orphan',
        observedStatus: payload.type,
        evidence: { eventId: payload.id },
      });
      return { outcome: 'orphan_recorded' };
    }
    const status = String(payload.data?.status || '').toUpperCase();
    if (!status) return { outcome: 'ignored_missing_status' };
    if (payment.status === 'completed' || payment.status === 'failed' || payment.status === 'refunded') {
      await data.recordReconciliation({
        paymentId: payment.id,
        providerTransactionId: ids[0],
        source: 'webhook_out_of_order',
        observedStatus: status,
        evidence: { eventId: payload.id, currentStatus: payment.status },
      });
      return { outcome: 'out_of_order_recorded' };
    }
    if (status === 'COMPLETED') {
      await settleReservation({ payment, settledAt: payload.data?.settledAt });
      return { outcome: 'settled' };
    }
    if (RELEASE_STATUSES.has(status)) {
      await releaseReservation({
        paymentId: payment.id,
        actorUserId: null,
        reason: String(payload.data?.failureReason || payload.type).slice(0, 500),
      });
      await data.updatePayment(payment.id, {
        status: status === 'REFUNDED' ? 'refunded' : 'failed',
        failureReason: String(payload.data?.failureReason || payload.type).slice(0, 500),
      });
      await data.recordReconciliation({
        paymentId: payment.id,
        providerTransactionId: ids[0],
        source: 'webhook',
        observedStatus: status,
        evidence: { eventId: payload.id },
        resolution: 'reservation_released',
      });
      return { outcome: 'released' };
    }
    if (TERMINAL.has(status)) {
      await data.updatePayment(payment.id, { status: 'reconciliation_required' });
      await data.recordReconciliation({
        paymentId: payment.id,
        providerTransactionId: ids[0],
        source: 'webhook',
        observedStatus: status,
        evidence: { eventId: payload.id },
        resolution: 'operator_review',
      });
      return { outcome: 'reconciliation_required' };
    }
    await data.recordReconciliation({
      paymentId: payment.id,
      providerTransactionId: ids[0],
      source: 'webhook',
      observedStatus: status,
      evidence: { eventId: payload.id },
    });
    return { outcome: 'progress_recorded' };
  }

  async function applyIncomingEvent(payload) {
    const ids = eventTransactionIds(payload);
    const providerTransactionId = ids[0];
    if (!providerTransactionId) {
      await data.recordReconciliation({
        source: 'incoming_webhook_missing_id',
        observedStatus: payload.type,
        evidence: { eventId: payload.id },
      });
      return { outcome: 'missing_id' };
    }
    const status = String(payload.data?.status || '').toUpperCase();
    // A webhook is never proof of credit. Query Grid for the authoritative
    // transaction and credit only a confirmed, settled CREDIT.
    const response = await client.request({
      path: `/transactions/${encodeURIComponent(providerTransactionId)}`,
      timeoutMs: 12000,
    });
    const transaction = response?.data;
    if (!transaction || transaction.status !== 'COMPLETED' || transaction.direction !== 'CREDIT') {
      await data.recordReconciliation({
        providerTransactionId,
        source: 'incoming_webhook_unconfirmed',
        observedStatus: transaction?.status || status,
        evidence: { eventId: payload.id },
      });
      return { outcome: 'not_credited_pending_confirmation' };
    }

    const existing = await db.query(
      'SELECT id FROM transactions WHERE external_reference = $1 AND type = $2 LIMIT 1',
      [providerTransactionId, 'deposit'],
    );
    if (existing.rows.length) return { outcome: 'already_credited' };

    const customerId = String(transaction.customerId || '');
    const mappingResult = await db.query(
      'SELECT user_id FROM grid_provider_customers WHERE provider_customer_id = $1',
      [customerId],
    );
    if (!mappingResult.rows.length) {
      await data.recordReconciliation({
        providerTransactionId,
        source: 'incoming_unmapped_customer',
        observedStatus: transaction.status,
        evidence: { eventId: payload.id },
      });
      return { outcome: 'unmapped_customer' };
    }

    const amountData = transaction.sentAmount || transaction.receivedAmount || {};
    const minor = Number(amountData.amount);
    const currency = String(amountData.currency?.code || '').toUpperCase();
    if (!Number.isSafeInteger(minor) || minor <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Incoming transaction amount or currency was invalid.');
    }
    const amount = minorToDecimal(minor);
    const userId = mappingResult.rows[0].user_id;

    let clientTransaction;
    try {
      await ensureVaultLedgerSchema();
      clientTransaction = await db.getClient();
      await clientTransaction.query('BEGIN');
      const accountResult = await clientTransaction.query(
        `SELECT id FROM accounts WHERE user_id = $1 AND UPPER(currency) = $2 AND status = 'active'
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        [userId, currency],
      );
      const account = accountResult.rows[0];
      if (!account) throw new GridError('GRID_ACCOUNT_NOT_FOUND', `No active ${currency} account for the receiving customer.`);
      await ensureCustomerLedgerAccount(clientTransaction, account.id);
      const credit = await clientTransaction.query(
        `UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2
         WHERE id = $1 RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
        [account.id, Number(amount)],
      );
      await clientTransaction.query(
        `INSERT INTO transactions
          (account_id, user_id, type, status, amount, currency, balance_before, balance_after,
           description, category, external_reference, metadata)
         VALUES ($1,$2,'deposit','completed',$3,$4,$5,$6,$7,'income',$8,$9::jsonb)`,
        [account.id, userId, Number(amount), currency, credit.rows[0].balance_before,
          credit.rows[0].balance_after, 'VaultBank Grid incoming payment', providerTransactionId,
          JSON.stringify({ rail: 'lightspark-grid', providerTransactionId, eventId: payload.id })],
      );
      await postBalancedJournal(clientTransaction, {
        eventType: 'deposit_settled',
        sourceType: 'lightspark_grid_incoming',
        sourceId: providerTransactionId,
        currency,
        description: 'Lightspark Grid incoming payment confirmed settled',
        actorUserId: null,
        metadata: { providerTransactionId, eventId: payload.id },
        entries: [
          { systemCode: 'INBOUND_SETTLEMENT_ASSET', side: 'debit', amount },
          { accountId: account.id, side: 'credit', amount },
        ],
      });
      await clientTransaction.query('COMMIT');
      return { outcome: 'credited' };
    } catch (error) {
      if (clientTransaction) {
        try { await clientTransaction.query('ROLLBACK'); } catch { /* ignore */ }
      }
      throw error;
    } finally {
      if (clientTransaction) clientTransaction.release();
    }
  }

  async function applyProviderEvent(payload) {
    if (String(payload.type).startsWith('OUTGOING_PAYMENT.')) return applyOutgoingEvent(payload);
    if (String(payload.type).startsWith('INCOMING_PAYMENT.')) return applyIncomingEvent(payload);
    return { outcome: 'ignored' };
  }

  async function reconcilePayment({ paymentId, actorUserId }) {
    const resolved = await data.getPaymentById(String(paymentId));
    if (!resolved) throw new GridError('GRID_PAYMENT_NOT_FOUND', 'Payment not found.');
    if (!resolved.provider_transaction_id) {
      throw new GridError('GRID_NO_PROVIDER_TRANSACTION', 'This payment has no provider transaction id to reconcile.');
    }
    const response = await client.request({
      path: `/transactions/${encodeURIComponent(resolved.provider_transaction_id)}`,
      timeoutMs: 12000,
    });
    const transaction = response?.data;
    if (!transaction?.id || !transaction?.status) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid transaction response was incomplete.');
    }
    await data.recordReconciliation({
      paymentId: resolved.id,
      providerTransactionId: resolved.provider_transaction_id,
      source: 'admin_reconciliation',
      observedStatus: transaction.status,
      evidence: {
        description: transaction.description || null,
        settledAt: transaction.settledAt || null,
        refund: transaction.refund || null,
      },
      resolvedBy: actorUserId || null,
      resolvedAt: new Date().toISOString(),
    });
    const synthetic = {
      id: `reconciliation-${resolved.id}`,
      type: 'OUTGOING_PAYMENT.RECONCILED',
      data: { id: resolved.provider_transaction_id, status: transaction.status, settledAt: transaction.settledAt },
    };
    const outcome = await applyOutgoingEvent(synthetic);
    return { payment: publicPayment(await data.getPayment(resolved.user_id, resolved.id) || resolved), outcome };
  }

  async function scanStuckPayments() {
    const stuck = await data.listAllPayments(null);
    const candidates = stuck.filter((payment) =>
      ['reserved', 'executing', 'processing', 'reconciliation_required'].includes(payment.status)
      && (Date.now() - Date.parse(payment.created_at)) > 15 * 60 * 1000);
    const results = [];
    for (const payment of candidates) {
      try {
        if (!payment.provider_transaction_id) continue;
        const outcome = await reconcilePayment({ paymentId: payment.id, actorUserId: null });
        results.push({ id: payment.id, outcome: outcome.outcome });
      } catch (error) {
        results.push({ id: payment.id, error: String(error?.code || error?.message || 'unknown') });
      }
    }
    return results;
  }

  return {
    createPayout,
    applyProviderEvent,
    reconcilePayment,
    scanStuckPayments,
    releaseReservation,
    settleReservation,
    minorToDecimal,
  };
}

module.exports = { createPaymentService, minorToDecimal, publicPayment };
