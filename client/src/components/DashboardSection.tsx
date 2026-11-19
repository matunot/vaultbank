import { memo, lazy, Suspense } from 'react';
import { Sparkles, Send } from 'lucide-react';
import HeroBalance from './HeroBalance';
import QuickActions from './QuickActions';
import Transactions from './Transactions';
import PreviewOnlyNotice from './PreviewOnlyNotice';
import DashboardPreviewPanels from './DashboardPreviewPanels';
import { useAppStore } from '../store';
import { useAccountData, TransactionData } from '../hooks/useAccountData';

// Dev-only sample panels are code-split so their animation runtime and sample
// data never enter the production entry graph. In a production build the
// conditional collapses to `null` and the dynamic import is dropped.
const DevSpendingPanel = import.meta.env.DEV ? lazy(() => import('./SpendingPanel')) : null;
const DevDashboardPanels = import.meta.env.DEV ? lazy(() => import('./DashboardDevPanels')) : null;

const Section = memo(({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <div
    className="vb-enter"
    style={{ '--vb-delay': `${Math.round(delay * 1000)}ms` } as React.CSSProperties}
  >
    {children}
  </div>
));

Section.displayName = 'Section';

interface Props {
  onOpenModal: (modal: string) => void;
  userName?: string;
  accountNumber?: string;
}

interface MappedTransaction {
  id: string | number;
  name: string;
  cat: string;
  amount: number;
  date: string;
  icon: string;
  gem: string;
}

function mapTransaction(tx: TransactionData, index: number): MappedTransaction {
  return {
    id: tx.id || index,
    name: tx.description || 'Transaction',
    cat: (tx.category || 'Other').charAt(0).toUpperCase() + (tx.category || 'other').slice(1),
    amount: tx.type === 'debit' ? -Math.abs(tx.amount) : Math.abs(tx.amount),
    date: tx.date ? new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
    icon: tx.type === 'credit' ? (tx.category === 'income' ? '💰' : '⬇️') : '💸',
    gem: tx.type === 'credit' ? 'emerald' : 'ruby',
  };
}

const DashboardSection = memo(function DashboardSection({ onOpenModal, userName = 'Guest', accountNumber }: Props) {
  const store = useAppStore();
  const { account, transactions, balance, loading } = useAccountData();

  const realTransactions: MappedTransaction[] = transactions.length
    ? transactions.map(mapTransaction)
    : (store.transactions as MappedTransaction[]);

  // Derive real income/expenses from genuine transactions only
  const income = realTransactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const expenses = realTransactions
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Real authenticated user's first name
  const firstName = userName ? userName.trim().split(/\s+/)[0] : '';
  // Derived real-time date info
  const now = new Date();
  const dayLabel = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <div className="space-y-5">
      {/* Hero greeting */}
      <Section delay={0.05}>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-3xl lg:text-5xl text-white tracking-tight">
                Good <span className="text-gold">evening</span>, {firstName}
              </h1>
              <div className="vb-scale-in hidden md:block" style={{ animation: 'spin-slow 12s linear infinite' }}>
                <Sparkles className="w-5 h-5 lg:w-6 lg:h-6 text-amber-400/60" />
              </div>
            </div>
            <p className="text-sm text-white/40">
              {dayLabel}, {dateLabel} · {realTransactions.length} transaction{realTransactions.length === 1 ? '' : 's'} this account
            </p>
          </div>
          <button
            onClick={() => onOpenModal('send')}
            className="hidden lg:flex items-center gap-2 px-5 py-2.5 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm shadow-lg glow-amber transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            <Send className="w-4 h-4" /> Quick Send
          </button>
        </div>
      </Section>

      <Section delay={0.1}>
        <HeroBalance
          balance={balance?.total ?? 0}
          accountNumber={accountNumber || account?.accountNumber}
          loading={loading}
          income={income}
          expenses={expenses}
        />
      </Section>

      <Section delay={0.15}>
        <QuickActions
          onSend={() => onOpenModal('send')}
          onDeposit={() => onOpenModal('deposit')}
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Section delay={0.2}><Transactions transactions={realTransactions} loading={loading} /></Section>
        </div>
        {import.meta.env.DEV && DevSpendingPanel ? (
          <Suspense fallback={<div className="glass-panel rounded-3xl min-h-80 animate-pulse" />}>
            <DevSpendingPanel />
          </Suspense>
        ) : (
          <PreviewOnlyNotice title="Spending insights are a preview" message="This panel currently uses example data in local development. Live account spending analytics are not connected yet." />
        )}
      </div>

      {import.meta.env.DEV && DevDashboardPanels ? (
        <Suspense fallback={<div className="glass-panel rounded-3xl min-h-64 animate-pulse" />}>
          <DevDashboardPanels />
        </Suspense>
      ) : (
        <DashboardPreviewPanels />
      )}
    </div>
  );
});

export default DashboardSection;