import { useState, useCallback } from 'react';
import { cards as initialCards, transactions as initialTransactions, savingsGoals as initialGoals, budgetCategories as initialBudget, contacts as initialContacts, investments as initialInvestments } from './data';
import { api } from './api';

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

export interface Contact {
  name: string;
  handle: string;
  img: string;
  recent: boolean;
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
  const [contacts] = useState<Contact[]>(initialContacts);
  const [investments, setInvestments] = useState<Investment[]>(initialInvestments);
  const [transferLoading, setTransferLoading] = useState(false);

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const sendMoney = useCallback(async (recipient: string, amount: number, note?: string) => {
    setTransferLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    
    const newTx: Transaction = {
      id: Date.now(),
      name: `Sent to ${recipient}`,
      cat: note || 'Transfer',
      amount: -amount,
      date: 'Just now',
      icon: '💸',
      gem: 'sapphire',
    };
    
    setTransactions(prev => [newTx, ...prev]);
    setBalance(prev => prev - amount);
    setAvailable(prev => prev - amount);
    setTransferLoading(false);
    return true;
  }, []);

  const lockCard = useCallback((cardId: number) => {
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, locked: !c.locked } : c));
  }, []);

  const addToGoal = useCallback((goalId: number, amount: number) => {
    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, current: Math.min(g.current + amount, g.target) } : g));
  }, []);

  const depositMoney = useCallback(async (amount: number) => {
    await new Promise(r => setTimeout(r, 1000));
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
    setBalance(prev => prev + amount);
    setAvailable(prev => prev + amount);
  }, []);

  const payBill = useCallback(async (name: string, amount: number) => {
    await new Promise(r => setTimeout(r, 1000));
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
    setBalance(prev => prev - amount);
    setAvailable(prev => prev - amount);
    setBudget(prev => prev.map(b => b.name === 'Entertainment' ? { ...b, spent: b.spent + amount } : b));
  }, []);

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

  return {
    balance,
    available,
    cards,
    transactions,
    goals,
    budget,
    contacts,
    investments,
    transferLoading,
    formatMoney,
    sendMoney,
    lockCard,
    addToGoal,
    depositMoney,
    payBill,
    executeTrade,
    setBalance,
  };
}
