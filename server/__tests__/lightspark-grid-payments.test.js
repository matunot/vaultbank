'use strict';

jest.mock('../config/db', () => ({
  db: {
    getClient: jest.fn(),
    query: jest.fn(),
  },
}));

jest.mock('../services/ledgerJournalService', () => ({
  ensureVaultLedgerSchema: jest.fn().mockResolvedValue(undefined),
  ensureCustomerLedgerAccount: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
  changeVerifiedAvailableBalance: jest.fn().mockResolvedValue({ verified_available_balance: '0.00' }),
  postBalancedJournal: jest.fn().mockResolvedValue({ journalId: 'journal-1', replay: false }),
}));

const { db } = require('../config/db');
const ledger = require('../services/ledgerJournalService');
const { createPaymentService } = require('../services/lightsparkGrid/payments');

const PAYMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const QUOTE = {
  id: 'quote-1',
  user_id: 'user-1',
  provider_quote_id: 'Quote:1',
  sending_currency: 'USD',
  sending_amount_minor: 10000,
  beneficiary_id: 'bene-1',
};

function fakeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (typeof sql !== 'string') return { rows: [], rowCount: 0 };
      if (sql.startsWith('SELECT id, currency FROM accounts')) {
        return { rows: [{ id: 'account-1', currency: 'USD' }] };
      }
      if (sql.startsWith('SELECT id FROM accounts')) {
        return { rows: [{ id: 'account-1' }] };
      }
      if (sql.startsWith('SELECT * FROM grid_payments WHERE id = $1')) {
        return { rows: [{ id: PAYMENT_ID, account_id: 'account-1', user_id: 'user-1',
          amount: '100.00', currency: 'USD', status: 'reserved',
          reservation_source_id: 'grid-reservation-ref-1', reference: 'grid-ref-1' }] };
      }
      if (sql.includes('UPDATE accounts SET balance = balance -')) {
        return { rows: [{ balance_before: '100.00', balance_after: '90.00' }] };
      }
      if (sql.includes('UPDATE accounts SET balance = balance +')) {
        return { rows: [{ balance_before: '90.00', balance_after: '100.00' }] };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
}

function fakeData(overrides = {}) {
  const payment = {
    id: PAYMENT_ID,
    user_id: 'user-1',
    account_id: 'account-1',
    quote_id: 'quote-1',
    provider_quote_id: 'Quote:1',
    reservation_source_id: 'grid-reservation-ref-1',
    reference: 'grid-ref-1',
    idempotency_key: 'idem-key-123456789',
    amount: '100.00',
    currency: 'USD',
    status: 'reserved',
    provider_transaction_id: null,
    created_at: new Date().toISOString(),
  };
  return {
    payment: { ...payment },
    reconciliations: [],
    async ensureTables() {},
    async getPaymentByIdempotencyKey() { return null; },
    async getQuote() { return QUOTE; },
    async createPayment(row) { this.payment = { ...payment, ...row }; return this.payment; },
    async getPaymentById() { return this.payment; },
    async getPayment(userId, id) { return this.payment; },
    async getPaymentByProviderTransactionId(id) {
      return this.payment.provider_transaction_id === id ? this.payment : null;
    },
    async updatePayment(id, patch) { Object.assign(this.payment, patch); return this.payment; },
    async recordReconciliation(row) { this.reconciliations.push(row); return row; },
    async listAllPayments() { return [this.payment]; },
    ...overrides,
  };
}

function makeService(data, executeImpl) {
  const client = { request: jest.fn(async () => ({ data: { ok: true } })) };
  const quotes = {
    executeQuote: executeImpl || jest.fn().mockResolvedValue({
      status: 'PROCESSING', providerTransactionId: 'Transaction:1',
    }),
  };
  const service = createPaymentService({ client, quotes, config: { mode: 'sandbox' }, data, logger: () => {} });
  return { service, client, quotes };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getClient.mockImplementation(fakeClient);
  ledger.changeVerifiedAvailableBalance.mockResolvedValue({ verified_available_balance: '0.00' });
  ledger.postBalancedJournal.mockResolvedValue({ journalId: 'journal-1', replay: false });
});

describe('Grid outgoing payouts', () => {
  test('reserves funds atomically, posts a balanced journal, then executes', async () => {
    const data = fakeData();
    const { service, quotes } = makeService(data);
    const result = await service.createPayout({
      userId: 'user-1', quoteId: 'quote-1', idempotencyKey: 'idem-key-123456789',
    });
    expect(result.status).toBe('processing');
    expect(ledger.changeVerifiedAvailableBalance).toHaveBeenCalledWith(
      expect.anything(), 'account-1', '100.00', 'debit',
    );
    expect(ledger.postBalancedJournal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'payout_reserved' }),
    );
    expect(quotes.executeQuote).toHaveBeenCalledTimes(1);
    const client = db.getClient.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('a repeated or concurrent request replays the payment without a second reservation', async () => {
    const data = fakeData();
    const { service, quotes } = makeService(data);
    const args = { userId: 'user-1', quoteId: 'quote-1', idempotencyKey: 'idem-key-123456789' };
    const first = await service.createPayout(args);
    data.getPaymentByIdempotencyKey = async (key) => (
      key === args.idempotencyKey ? data.payment : null
    );
    const second = await service.createPayout(args);
    expect(second.id).toBe(first.id);
    expect(quotes.executeQuote).toHaveBeenCalledTimes(1);
    expect(ledger.postBalancedJournal).toHaveBeenCalledTimes(1);
  });

  test('does not execute or reserve when verified funds are insufficient', async () => {
    ledger.changeVerifiedAvailableBalance.mockRejectedValue({ code: 'VB_LEDGER_VERIFIED_FUNDS_INSUFFICIENT' });
    const data = fakeData();
    const { service, quotes } = makeService(data);
    await expect(service.createPayout({
      userId: 'user-1', quoteId: 'quote-1', idempotencyKey: 'idem-key-123456789',
    })).rejects.toMatchObject({ code: 'GRID_UNVERIFIED_FUNDS' });
    expect(quotes.executeQuote).not.toHaveBeenCalled();
    expect(ledger.postBalancedJournal).not.toHaveBeenCalled();
    const client = db.getClient.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('a timeout keeps the reservation and demands reconciliation', async () => {
    const data = fakeData();
    const { service } = makeService(data, jest.fn().mockRejectedValue({
      code: 'GRID_REQUEST_TIMEOUT', ambiguous: true,
    }));
    const result = await service.createPayout({
      userId: 'user-1', quoteId: 'quote-1', idempotencyKey: 'idem-key-123456789',
    });
    expect(result.status).toBe('reconciliation_required');
    expect(data.reconciliations).toHaveLength(1);
    expect(ledger.postBalancedJournal).toHaveBeenCalledTimes(1);
  });

  test('a definite provider rejection releases the reservation', async () => {
    const data = fakeData();
    const { service } = makeService(data, jest.fn().mockRejectedValue({
      code: 'GRID_INVALID_INPUT', ambiguous: false, message: 'rejected',
    }));
    const result = await service.createPayout({
      userId: 'user-1', quoteId: 'quote-1', idempotencyKey: 'idem-key-123456789',
    });
    expect(result.status).toBe('failed');
    expect(ledger.postBalancedJournal).toHaveBeenCalledTimes(2);
    expect(ledger.postBalancedJournal).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'payout_refund' }),
    );
  });

  test('out-of-order settlement events do not add balance changes', async () => {
    const data = fakeData();
    data.payment.status = 'completed';
    data.getPaymentByProviderTransactionId = async (id) => (
      id === 'Transaction:1' ? data.payment : null
    );
    const { service } = makeService(data);
    const outcome = await service.applyProviderEvent({
      id: 'Webhook:1', type: 'OUTGOING_PAYMENT.COMPLETED',
      data: { id: 'Transaction:1', status: 'COMPLETED' },
    });
    expect(outcome.outcome).toBe('out_of_order_recorded');
    expect(ledger.postBalancedJournal).not.toHaveBeenCalled();
  });
});

describe('Grid incoming payments', () => {
  test('never credits a pending or unconfirmed provider transaction', async () => {
    const data = fakeData();
    const { service, client } = makeService(data);
    client.request.mockResolvedValue({ data: { id: 'Transaction:2', status: 'PENDING', direction: 'CREDIT' } });
    const outcome = await service.applyProviderEvent({
      id: 'Webhook:2', type: 'INCOMING_PAYMENT.PENDING',
      data: { id: 'Transaction:2', status: 'PENDING' },
    });
    expect(outcome.outcome).toBe('not_credited_pending_confirmation');
    expect(ledger.postBalancedJournal).not.toHaveBeenCalled();
  });

  test('credits only confirmed settled CREDIT transactions with a balanced journal', async () => {
    const data = fakeData();
    const { service, client } = makeService(data);
    client.request.mockResolvedValue({
      data: {
        id: 'Transaction:3', status: 'COMPLETED', direction: 'CREDIT',
        customerId: 'Customer:user-1',
        receivedAmount: { amount: 5000, currency: { code: 'USD', decimals: 2 } },
      },
    });
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT id FROM transactions')) return { rows: [] };
      if (sql.includes('SELECT user_id FROM grid_provider_customers')) return { rows: [{ user_id: 'user-1' }] };
      return { rows: [] };
    });
    const outcome = await service.applyProviderEvent({
      id: 'Webhook:3', type: 'INCOMING_PAYMENT.COMPLETED',
      data: { id: 'Transaction:3', status: 'COMPLETED' },
    });
    expect(outcome.outcome).toBe('credited');
    expect(ledger.postBalancedJournal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'deposit_settled' }),
    );
  });
});
