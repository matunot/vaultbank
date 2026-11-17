import { memo } from 'react';
import { ArrowUpRight, CalendarDays, CircleCheck, CreditCard, Wallet } from 'lucide-react';
import HeroBalance from './HeroBalance';
import QuickActions from './QuickActions';
import Transactions from './Transactions';
import { useAccountData, TransactionData } from '../hooks/useAccountData';

interface Props {
  onOpenModal: (modal: string) => void;
  onViewAll?: () => void;
  userName?: string;
  accountNumber?: string;
}

interface MappedTransaction {
  id: string | number;
  name: string;
  cat: string;
  amount: number;
  date: string;
  icon?: string;
  gem?: string;
  status?: string;
}

function mapTransaction(tx: TransactionData, index: number): MappedTransaction {
  const date = tx.date ? new Date(tx.date) : null;
  return {
    id: tx.id || index,
    name: tx.description || 'Transaction',
    cat: (tx.category || 'Other').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    amount: tx.type === 'debit' ? -Math.abs(tx.amount) : Math.abs(tx.amount),
    date: date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : '—',
    status: tx.status,
  };
}

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const DashboardSection = memo(function DashboardSection({
  onOpenModal,
  onViewAll,
  userName = 'Account holder',
  accountNumber,
}: Props) {
  const { account, transactions, balance, loading, error } = useAccountData();
  const displayTransactions: MappedTransaction[] = transactions.length
    ? transactions.map(mapTransaction)
    : (import.meta.env.DEV ? [] : []);
  const currency = account?.currency || balance?.currency || 'USD';
  const fullName = userName.trim() || 'Account holder';
  const firstName = fullName.split(/\s+/)[0];
  const dateNow = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateNow);
  const accountStatus = account?.status || '';
  const accountStatusLabel = accountStatus
    ? accountStatus.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Not available';
  const maskedAccount = accountNumber || account?.accountNumber;
  const accountLastFour = maskedAccount?.replace(/\s/g, '').slice(-4);
  const accountType = account?.accountType
    ? account.accountType.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : '—';

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="bank-page-intro">
        <div>
          <p className="bank-eyebrow">Account overview</p>
          <h1 className="bank-page-title">{greetingForHour(dateNow.getHours())}, {firstName}</h1>
          <p className="bank-page-subtitle">{dateLabel} · Your banking, at a glance.</p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-400 md:flex">
          <CalendarDays size={14} className="text-teal-200" />
          Personal account
        </div>
      </header>

      <HeroBalance
        balance={balance?.total ?? account?.balance ?? 0}
        availableBalance={balance?.available ?? account?.availableBalance}
        accountNumber={maskedAccount}
        accountType={account?.accountType}
        currency={currency}
        loading={loading}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <QuickActions
          onSend={() => onOpenModal('send')}
          onDeposit={() => onOpenModal('deposit')}
        />
        <section className="bank-surface p-5 sm:p-6" aria-labelledby="account-details-heading">
          <div className="mb-4">
            <h2 id="account-details-heading" className="bank-section-title">Account details</h2>
            <p className="bank-section-caption">Your primary account information</p>
          </div>
          <div className="bank-summary-grid">
            <div className="bank-summary-item">
              <span className="bank-label">Account type</span>
              <p className="bank-summary-item__value">{accountType}</p>
            </div>
            <div className="bank-summary-item">
              <span className="bank-label">Currency</span>
              <p className="bank-summary-item__value">{currency}</p>
            </div>
            <div className="bank-summary-item">
              <span className="bank-label">Account number</span>
              <p className="bank-summary-item__value">{accountLastFour ? '•••• ' + accountLastFour : '—'}</p>
            </div>
            <div className="bank-summary-item">
              <span className="bank-label">Account status</span>
              <p className="bank-summary-item__value flex items-center gap-2">
                {accountStatus.toLowerCase() === 'active' && <CircleCheck size={15} className="text-emerald-300" />}
                <span>{accountStatusLabel}</span>
              </p>
            </div>
          </div>
          {error && (
            <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-xs leading-relaxed text-amber-100/80">
              <Wallet size={15} className="mt-0.5 shrink-0" />
              <span>{error}. Account information may be out of date.</span>
            </div>
          )}
        </section>
      </div>

      <Transactions transactions={displayTransactions} loading={loading} currency={currency} onViewAll={onViewAll} />
      <div className="flex items-center gap-2 px-1 text-[11px] text-slate-600">
        <CreditCard size={13} />
        <span>Account services and availability are shown within each section.</span>
        <ArrowUpRight size={12} className="ml-auto opacity-50" />
      </div>
    </div>
  );
});

export default DashboardSection;
