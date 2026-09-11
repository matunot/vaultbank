import { useState, useCallback, useEffect } from 'react';
import { cards as initialCards, transactions as initialTransactions, savingsGoals as initialGoals, budgetCategories as initialBudget, investments as initialInvestments } from './data';
import { api } from './api';
import { refreshBus } from './refreshBus';

export interface Transaction {
  id: number;
  name: string;
  cat: string;
  amount: number;
  date: string;
  icon: string;
  gem: string;
}

export interface Card {
  id: number;
  type: string;
  network: string;
  last4: string;
  balance: number;
  limit: number;
  color: string;
  gradient: string;
  accent: string;
  expiry: string;
  holder: string;
  locked?: boolean;
  realId?: string;
}

export interface Goal {
  id: number;
  name: string;
  target: number;
  current: number;
  emoji: string;
  color: string;
  deadline: string;
}

export interface BudgetCategory {
  name: string;
  budget: number;
  spent: number;
  icon: string;
}

export interface Investment {
  ticker: string;
  name: string;
  price: number;
  change: number;
  value: number;
  shares: number;
}

export function useAppStore() {
  const storedAccount = api.getAccount();
  const initialBalance = storedAccount?.balance ?? 0;
  const initialAvailable = storedAccount?.availableBalance ?? initialBalance;
  const [balance, setBalance] = useState<number>(initialBalance);
  const [available, setAvailable] = useState<number>(initialAvailable);
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [budget, setBudget] = useState<BudgetCategory[]>(initialBudget);
  const [investments, setInvestments] = useState<Investment[]>(initialInvestments);
  const [transferLoading, setTransferLoading] = useState(false);
  // REAL issued cards - hydrate the classic cards UI from the Stripe
  // Issuing backend so it shows your actual issued cards.
  const refreshCards = useCallback(async () => {
    try {
      const res = await api.getIssuingCards();
      if (!(res.success && Array.isArray(res.cards) && res.cards.length > 0)) return;
      let holderName = "VAULTBANK CLIENT";
      try {
        const u = JSON.parse(localStorage.getItem("vaultbank_user") || "{}");
        if (u && u.full_name) holderName = u.full_name;
        else if (u && u.fullName) holderName = u.fullName;
      } catch { /* ignore */ }
      const acct = api.getAccount();
      setCards(res.cards.map((rc: any, i: number) => ({
        id: i + 1,
        realId: rc.id,
        type: rc.network === "mastercard" ? "Virtual Mastercard" : "Virtual Visa",
        network: (rc.network || "VISA").toUpperCase(),
        last4: rc.last4,
        balance: acct && acct.balance ? acct.balance : 0,
        limit: rc.monthlyLimit || 2000,
        color: rc.network === "mastercard" ? "ruby" : "sapphire",
        gradient: rc.network === "mastercard" ? "from-rose-500/20 via-red-500/10 to-rose-700/20" : "from-blue-500/20 via-indigo-500/10 to-blue-700/20",
        accent: rc.network === "mastercard" ? "#e11d48" : "#3b82f6",
        expiry: (rc.expMonth ? String(rc.expMonth).padStart(2, "0") : "MM") + "/" + (rc.expYear ? String(rc.expYear).slice(-2) : "YY"),
        holder: holderName,
        locked: !!rc.frozen,
      })));
    } catch { /* fall back to demo cards */ }
  }, []);

  useEffect(() => {
    refreshCards();
    const unsub = refreshBus.subscribe(refreshCards);
    return unsub;
  }, [refreshCards]);

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // REAL money transfer — calls the backend /api/account/transfer
  // endpoint which atomically moves money between real registered
  // accounts and records transactions for both parties.
  const sendMoney = useCallback(async (recipient: string, amount: number, note?: string) => {
    const trimmed = (recipient || '').trim();
    if (!trimmed) throw new Error('Please choose a recipient.');
    if (!amount || amount <= 0) throw new Error('Please enter a valid amount.');

    setTransferLoading(true);
    try {
      const isEmail = trimmed.includes('@');
      const res = isEmail
        ? await api.sendMoney({ recipientEmail: trimmed, amount, description: note })
        : await api.sendMoney({ recipientAccountNumber: trimmed, amount, description: note });

      if (!res.success) throw new Error(res.message || 'Transfer failed.');

      // Sync real balance from the server response
      const newBalance = res.transfer?.newBalance;
      if (typeof newBalance === 'number') {
        setBalance(newBalance);
        setAvailable(newBalance);
        try {
          const acct = api.getAccount();
          if (acct) {
            localStorage.setItem('vaultbank_account', JSON.stringify({ ...acct, balance: newBalance, availableBalance: newBalance }));
          }
        } catch { /* non-critical */ }
      }

      const newTx: Transaction = {
        id: Date.now(),
        name: `Sent to ${res.transfer?.recipient?.name || trimmed}`,
        cat: note || 'Transfer',
        amount: -amount,
        date: 'Just now',
        icon: '💸',
        gem: 'sapphire',
      };
      setTransactions(prev => [newTx, ...prev]);
      refreshBus.emit();
      return true;
    } finally {
      setTransferLoading(false);
    }
  }, []);

  const lockCard = useCallback((cardId: number) => {
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c;
      const nextLocked = !c.locked;
      // Persist real Issuing cards to Stripe (freeze = real network declines)
      if (c.realId) {
        api.freezeIssuingCard(c.realId, nextLocked)
          .then((res: any) => { if (res && res.success) refreshCards(); })
          .catch(() => {});
      }
      return { ...c, locked: nextLocked };
    }));
  }, [refreshCards]);

  const addToGoal = useCallback((goalId: number, amount: number) => {
    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, current: Math.min(g.current + amount, g.target) } : g));
  }, []);

  // Apply a REAL server-returned balance to local state + localStorage
  const syncBalanceFromServer = useCallback((bal?: { available?: number; current?: number } | null) => {
    const newBalance = bal?.current ?? bal?.available;
    if (typeof newBalance === 'number') {
      setBalance(newBalance);
      setAvailable(newBalance);
      try {
        const acct = api.getAccount();
        if (acct) {
          localStorage.setItem('vaultbank_account', JSON.stringify({ ...acct, balance: newBalance, availableBalance: newBalance }));
        }
      } catch { /* non-critical */ }
    }
  }, []);

  // REAL deposit — instant internal deposit via the backend
  const depositMoney = useCallback(async (amount: number) => {
    const res = await api.accountDeposit({ amount, description: 'Account deposit' });
    if (!res.success) throw new Error(res.message || 'Deposit failed.');
    syncBalanceFromServer(res.balance);
    const newTx: Transaction = {
      id: Date.now(),
      name: 'Deposit',
      cat: 'Income',
      amount,
      date: 'Just now',
      icon: '💰',
      gem: 'emerald',
    };
    setTransactions(prev => [newTx, ...prev]);
    refreshBus.emit();
    return true;
  }, [syncBalanceFromServer]);

  // REAL bill payment — a real withdrawal recorded by the backend
  const payBill = useCallback(async (name: string, amount: number) => {
    const res = await api.accountWithdraw({ amount, description: `Bill payment: ${name}` });
    if (!res.success) throw new Error(res.message || 'Payment failed.');
    syncBalanceFromServer(res.balance);
    const newTx: Transaction = {
      id: Date.now(),
      name,
      cat: 'Bill Payment',
      amount: -amount,
      date: 'Just now',
      icon: '🧾',
      gem: 'ruby',
    };
    setTransactions(prev => [newTx, ...prev]);
    setBudget(prev => prev.map(b => b.name === 'Entertainment' ? { ...b, spent: b.spent + amount } : b));
    refreshBus.emit();
    return true;
  }, [syncBalanceFromServer]);

  const executeTrade = useCallback(async (ticker: string, type: 'buy' | 'sell', shares: number) => {
    await new Promise(r => setTimeout(r, 1200));
    
    const asset = investments.find(inv => inv.ticker === ticker);
    if (!asset) return false;
    
    const cost = asset.price * shares;
    
    if (type === 'buy') {
      if (available < cost) return false;
      
      setInvestments(prev => prev.map(inv => {
        if (inv.ticker === ticker) {
          const newShares = inv.shares + shares;
          return {
            ...inv,
            shares: newShares,
            value: newShares * inv.price
          };
        }
        return inv;
      }));
      setAvailable(prev => prev - cost);
      setBalance(prev => prev - cost);
      
      const newTx: Transaction = {
        id: Date.now(),
        name: `Bought ${shares} ${ticker}`,
        cat: 'Investment',
        amount: -cost,
        date: 'Just now',
        icon: '📈',
        gem: 'emerald',
      };
      setTransactions(prev => [newTx, ...prev]);
    } else {
      if (asset.shares < shares) return false;
      
      setInvestments(prev => prev.map(inv => {
        if (inv.ticker === ticker) {
          const newShares = inv.shares - shares;
          return {
            ...inv,
            shares: newShares,
            value: newShares * inv.price
          };
        }
        return inv;
      }));
      setAvailable(prev => prev + cost);
      setBalance(prev => prev + cost);
      
      const newTx: Transaction = {
        id: Date.now(),
        name: `Sold ${shares} ${ticker}`,
        cat: 'Investment',
        amount: cost,
        date: 'Just now',
        icon: '📉',
        gem: 'ruby',
      };
      setTransactions(prev => [newTx, ...prev]);
    }
    
    return true;
  }, [investments, available]);
  // Mint a REAL virtual card through the classic UI flow.
  const mintRealCard = useCallback(async (network = "visa") => {
    try {
      const st = await api.getIssuingStatus();
      if (!st || st.available === false) return false;
      if (!st.cardholder) {
        const ch = await api.createCardholder({});
        if (!ch.success) return false;
      }
      const res = await api.issueCard({ network, monthlyLimit: 2000, perTransactionLimit: 500 });
      if (!res.success) return false;
      await refreshCards();
      refreshBus.emit();
      return true;
    } catch {
      return false;
    }
  }, [refreshCards]);

  return {
    balance,
    available,
    cards,
    transactions,
    goals,
    budget,
    investments,
    transferLoading,
    formatMoney,
    sendMoney,
    lockCard,
    mintRealCard,
    addToGoal,
    depositMoney,
    payBill,
    executeTrade,
    setBalance,
  };
}
