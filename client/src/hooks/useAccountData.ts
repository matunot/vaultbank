import { useState, useEffect, useCallback } from 'react';
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
  type: 'credit' | 'debit';
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

export function useAccountData(): AccountDataResult {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountRes, txRes, balRes] = await Promise.allSettled([
        api.fetchAccount(),
        api.getAccountTransactions(),
        api.getAccountBalance(),
      ]);

      if (accountRes.status === 'fulfilled' && accountRes.value) {
        const data = accountRes.value;
        if (data.account) {
          setAccount(data.account);
        } else if (data.data) {
          setAccount(data.data);
        }
      }
      if (txRes.status === 'fulfilled' && txRes.value) {
        const data = txRes.value;
        if (data.transactions) {
          setTransactions(data.transactions);
        } else if (data.data) {
          setTransactions(data.data.transactions || data.data);
        }
      }
      if (balRes.status === 'fulfilled' && balRes.value) {
        const data = balRes.value;
        if (data.balance) {
          setBalance({
            total: data.balance.current ?? data.balance.available ?? 0,
            available: data.balance.available ?? 0,
            currency: data.balance.currency ?? 'USD',
          });
        } else if (data.data) {
          setBalance(data.data);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load account data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Refetch instantly whenever money moves (send, deposit, bill pay…)
    const unsub = refreshBus.subscribe(fetchData);
    // Plus a gentle 20s poll so money received from others shows up live too.
    const poll = setInterval(fetchData, 20000);
    return () => { unsub(); clearInterval(poll); };
  }, [fetchData]);

  return { account, transactions, balance, loading, error, refetch: fetchData };
}