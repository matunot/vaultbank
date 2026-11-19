import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { api } from '../api';
import { useAccountData, normalizeTransaction } from '../hooks/useAccountData';

vi.mock('../api', () => ({
  api: {
    fetchAccount: vi.fn(),
    getAccountTransactions: vi.fn(),
  },
}));

vi.mock('../refreshBus', () => ({
  refreshBus: {
    subscribe: vi.fn(() => () => {}),
    emit: vi.fn(),
  },
}));

const fetchAccount = vi.mocked(api.fetchAccount);
const getTransactions = vi.mocked(api.getAccountTransactions);

const accountPayload = {
  success: true,
  account: {
    id: 'acc-1',
    accountNumber: 'CH-0001',
    accountType: 'checking',
    balance: '120.50',
    availableBalance: '100.25',
    currency: 'USD',
    status: 'active',
  },
};

const txPayload = {
  success: true,
  transactions: [
    {
      id: 'tx-1',
      amount: '25.00',
      type: 'transfer_out',
      description: 'Rent',
      category: 'housing',
      createdAt: '2026-01-02T10:00:00.000Z',
      balanceBefore: '145.50',
      balanceAfter: '120.50',
      status: 'completed',
    },
  ],
};

describe('useAccountData', () => {
  beforeEach(() => {
    fetchAccount.mockResolvedValue(accountPayload as any);
    getTransactions.mockResolvedValue(txPayload as any);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('loads account + transactions only (2 requests) and derives balance', async () => {
    const { result } = renderHook(() => useAccountData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchAccount).toHaveBeenCalledTimes(1);
    expect(getTransactions).toHaveBeenCalledTimes(1);
    expect(result.current.balance).toEqual({ total: 120.5, available: 100.25, currency: 'USD' });
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.transactions[0]).toMatchObject({ type: 'debit', amount: 25 });
  });

  it('does not poll while the tab is hidden', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });

    const { result } = renderHook(() => useAccountData());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loading).toBe(false);
    expect(fetchAccount).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    expect(fetchAccount).toHaveBeenCalledTimes(1);

    // Becoming visible again triggers a refresh because the data is stale.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchAccount).toHaveBeenCalledTimes(2);
  });
});

describe('normalizeTransaction', () => {
  it('maps settled ledger types and timestamps without inventing values', () => {
    const debit = normalizeTransaction({
      id: 't1', amount: '12.34', type: 'card_charge',
      createdAt: '2026-02-03T04:05:06.000Z',
    }, 0);
    expect(debit).toMatchObject({
      id: 't1', amount: 12.34, type: 'debit', date: '2026-02-03T04:05:06.000Z',
    });

    const credit = normalizeTransaction({
      id: 't2', amount: 50, type: 'transfer_in', createdAt: 'not-a-date',
    }, 1);
    expect(credit.type).toBe('credit');
    expect(Number.isNaN(new Date(credit.date).getTime())).toBe(false);
  });

  it('uses the ledger balance delta for unknown adjustment types', () => {
    const debit = normalizeTransaction({ amount: 5, type: 'adjustment', balanceBefore: 100, balanceAfter: 95 }, 0);
    expect(debit.type).toBe('debit');
    const credit = normalizeTransaction({ amount: 5, type: 'adjustment', balanceBefore: 95, balanceAfter: 100 }, 1);
    expect(credit.type).toBe('credit');
  });
});
