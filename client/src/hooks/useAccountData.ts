import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { refreshBus } from '../refreshBus';

export interface AccountData {
  id: string;
  accountNumber: string;
  accountType: string;
  balance: number;
  availableBalance: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface TransactionData {
  id: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  /** Normalized money direction, not the raw ledger type. */
  type: 'credit' | 'debit';
  ledgerType?: string;
  status: string;
}

export interface BalanceData {
  total: number;
  available: number;
  currency: string;
}

export interface AccountDataResult {
  account: AccountData | null;
  transactions: TransactionData[];
  balance: BalanceData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const POLL_INTERVAL_MS = 60000;
const STALE_AFTER_MS = 60000;

const CREDIT_TYPES = new Set(['deposit', 'transfer_in', 'refund', 'interest', 'stripe_deposit', 'card_refund']);
const DEBIT_TYPES = new Set(['withdrawal', 'transfer_out', 'payment', 'fee', 'stripe_withdrawal', 'card_charge']);

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The ledger API returns settled types (`deposit`, `transfer_out`, `payment`,
 * …) plus `createdAt`. The dashboard used to compare against `debit`/`credit`
 * and read a non-existent `date`, which made every real row look like a
 * same-day credit. Normalize once here so every consumer sees the same shape.
 */
export function normalizeTransaction(raw: any, index: number): TransactionData {
  const amount = Math.abs(toNumber(raw?.amount));
  const ledgerType = String(raw?.type || '');
  const before = raw?.balanceBefore != null ? toNumber(raw.balanceBefore) : null;
  const after = raw?.balanceAfter != null ? toNumber(raw.balanceAfter) : null;

  let direction: 'credit' | 'debit';
  if (CREDIT_TYPES.has(ledgerType)) {
    direction = 'credit';
  } else if (DEBIT_TYPES.has(ledgerType)) {
    direction = 'debit';
  } else if (before != null && after != null && after !== before) {
    direction = after > before ? 'credit' : 'debit';
  } else {
    direction = 'credit';
  }

  const createdAt = raw?.createdAt || raw?.date || raw?.created_at || new Date().toISOString();
  const parsed = new Date(createdAt);

  return {
    id: raw?.id != null ? String(raw.id) : `tx-${index}`,
    amount,
    description: raw?.description || 'Transaction',
    category: raw?.category || 'Other',
    date: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
    type: direction,
    ledgerType,
    status: raw?.status || 'completed',
  };
}

export function useAccountData(): AccountDataResult {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const lastFetchedAtRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Only the first load may show the skeleton; background refreshes keep the
    // current figures on screen instead of flashing a loading state.
    if (!lastFetchedAtRef.current) setLoading(true);

    try {
      const [accountRes, txRes] = await Promise.allSettled([
        api.fetchAccount(),
        api.getAccountTransactions(20),
      ]);
      if (!mountedRef.current) return;

      if (accountRes.status === 'fulfilled' && accountRes.value) {
        const raw = accountRes.value.account || accountRes.value.data;
        if (raw) {
          const current = toNumber(raw.balance ?? raw.current);
          const available = toNumber(raw.availableBalance ?? raw.available, current);
          setAccount({
            id: String(raw.id ?? ''),
            accountNumber: raw.accountNumber || raw.account_number || '',
            accountType: raw.accountType || raw.account_type || '',
            balance: current,
            availableBalance: available,
            currency: raw.currency || 'USD',
            status: raw.status || 'active',
            createdAt: raw.createdAt || raw.openedAt || '',
          });
          // Balance is already part of the authenticated account read — no
          // separate /balance round trip, and no stale shared cache.
          setBalance({ total: current, available, currency: raw.currency || 'USD' });
          setError(null);
        }
      } else if (accountRes.status === 'rejected') {
        setError(accountRes.reason?.message || 'Failed to load account data');
      }

      if (txRes.status === 'fulfilled' && txRes.value) {
        const data = txRes.value;
        const rows = data.transactions || data.data?.transactions || data.data;
        if (Array.isArray(rows)) {
          setTransactions(rows.map(normalizeTransaction));
        }
      }

      lastFetchedAtRef.current = Date.now();
    } catch (err: any) {
      if (mountedRef.current) setError(err?.message || 'Failed to load account data');
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();

    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedAtRef.current >= STALE_AFTER_MS) void fetchData();
    };

    // Refetch instantly when money moves (send, deposit, bill pay…).
    const unsub = refreshBus.subscribe(() => { void fetchData(); });
    // Background poll is visibility-aware and slower than the old 20s loop;
    // hidden tabs do no network work at all.
    const poll = window.setInterval(refreshIfStale, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshIfStale);

    return () => {
      mountedRef.current = false;
      unsub();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [fetchData]);

  return { account, transactions, balance, loading, error, refetch: fetchData };
}
