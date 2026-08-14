import { transactions as seedTransactions } from '../data';

export interface AccountRecord {
  accountNumber: string;
}

export interface AccountTransaction {
  id: number;
  name: string;
  cat: string;
  amount: number;
  date: string;
  icon: string;
  gem: string;
}

export interface AccountData {
  account: AccountRecord;
  transactions: AccountTransaction[];
  balance: number;
  loading: boolean;
  income: number;
  expenses: number;
}

export function useAccountData(): AccountData {
  const transactions = seedTransactions as AccountTransaction[];

  const income = transactions
    .filter((transaction) => transaction.amount > 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const expenses = transactions
    .filter((transaction) => transaction.amount < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  return {
    account: {
      accountNumber: '•••• •••• •••• 4827',
    },
    transactions,
    balance: 252897.4,
    loading: false,
    income,
    expenses,
  };
}
