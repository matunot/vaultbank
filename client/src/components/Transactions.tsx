import { memo } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Clock3, Coffee, CreditCard, Gem, Plane, Smartphone, TrendingUp, Zap,
} from 'lucide-react';

interface Transaction {
  id: string | number;
  name: string;
  cat: string;
  amount: number;
  date: string;
  icon?: string;
  gem?: string;
  status?: string;
}
interface Props {
  transactions: Transaction[];
  loading?: boolean;
  currency?: string;
  onViewAll?: () => void;
}

const catIcons: Record<string, React.ComponentType<any>> = {
  Dining: Coffee,
  Income: TrendingUp,
  Auto: Zap,
  Luxury: Gem,
  Tech: Smartphone,
  Investment: TrendingUp,
  Travel: Plane,
  Transfer: CreditCard,
  Deposit: ArrowDownLeft,
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return currency + ' ' + amount.toFixed(2);
  }
}

const TxItem = memo(function TxItem({ tx, currency }: { tx: Transaction; currency: string }) {
  const incoming = tx.amount > 0;
  const Icon = catIcons[tx.cat] || CreditCard;
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-white/[0.055] py-3.5 last:border-0">
      <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl border ' + (incoming ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-200' : 'border-slate-300/10 bg-slate-300/5 text-slate-300')}>
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-100">{tx.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <span>{tx.cat}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={11} />{tx.date}</span>
          {tx.status && <><span aria-hidden="true">·</span><span className="capitalize">{tx.status.replace(/_/g, ' ')}</span></>}
        </span>
      </span>
      <span className={'shrink-0 text-right text-[13px] font-bold tabular-nums ' + (incoming ? 'text-emerald-200' : 'text-slate-100')}>
        {incoming ? '+' : '−'}{formatMoney(Math.abs(tx.amount), currency)}
      </span>
      {incoming ? <ArrowDownLeft size={15} className="hidden shrink-0 text-emerald-300 sm:block" /> : <ArrowUpRight size={15} className="hidden shrink-0 text-slate-500 sm:block" />}
    </li>
  );
});

const Transactions = memo(function Transactions({ transactions, loading = false, currency = 'USD', onViewAll }: Props) {
  return (
    <section className="bank-surface p-5 sm:p-6" aria-labelledby="recent-activity-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 id="recent-activity-heading" className="bank-section-title">Recent activity</h2>
          <p className="bank-section-caption">The latest transactions on your account</p>
        </div>
        {onViewAll && (
          <button type="button" onClick={onViewAll} className="rounded-lg px-3 py-2 text-xs font-semibold text-teal-200 transition-colors hover:bg-teal-300/10">
            View all
          </button>
        )}
      </div>
      <ul className="min-w-0" role="region" aria-label="Recent transactions">
        {loading ? (
          <li className="space-y-3 py-4" aria-busy="true" aria-label="Loading transactions">
            <div className="h-11 animate-pulse rounded-xl bg-white/5" />
            <div className="h-11 animate-pulse rounded-xl bg-white/5" />
            <div className="h-11 animate-pulse rounded-xl bg-white/5" />
          </li>
        ) : transactions.length ? (
          transactions.map((tx) => <TxItem key={tx.id} tx={tx} currency={currency} />)
        ) : (
          <li className="py-10 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-400">
              <CreditCard size={19} />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-200">No activity yet</p>
            <p className="mt-1 text-xs text-slate-500">Your account transactions will appear here.</p>
          </li>
        )}
      </ul>
    </section>
  );
});

export default Transactions;
