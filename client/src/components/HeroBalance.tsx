import { memo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface HeroBalanceProps {
  balance?: number;
  availableBalance?: number;
  accountNumber?: string;
  accountType?: string;
  currency?: string;
  loading?: boolean;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return currency + ' ' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

const HeroBalance = memo(function HeroBalance({
  balance = 0,
  availableBalance,
  accountNumber,
  accountType,
  currency = 'USD',
  loading = false,
}: HeroBalanceProps) {
  const [visible, setVisible] = useState(true);
  const amount = Number.isFinite(balance) ? balance : 0;
  const available = Number.isFinite(availableBalance) ? (availableBalance as number) : amount;
  const lastFour = accountNumber?.replace(/\s/g, '').slice(-4);
  const typeLabel = accountType
    ? accountType.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Account';

  return (
    <section className="bank-balance-card" aria-label="Account balance">
      <div className="bank-balance-card__content">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="bank-label !text-teal-100/70">Total balance</p>
            <div className="bank-balance-card__value" aria-live="polite">
              {loading ? '••••••' : visible ? formatMoney(amount, currency) : '••••••••'}
            </div>
            <p className="bank-balance-card__sub">
              {loading ? 'Loading account balance' : 'Current balance · ' + currency}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? 'Hide balance' : 'Show balance'}
            className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/5 text-teal-50 transition-colors hover:bg-white/10"
          >
            {visible ? <Eye size={17} /> : <EyeOff size={17} />}
          </button>
        </div>

        <div className="bank-balance-card__divider" />
        <div className="bank-balance-meta">
          <div className="flex items-center gap-3">
            <div className="bank-balance-chip" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <div className="bank-balance-meta__item">
              <span className="bank-label !text-teal-100/55">Account</span>
              <span className="bank-balance-meta__value">{lastFour ? '•••• ' + lastFour : typeLabel}</span>
            </div>
          </div>
          <div className="bank-balance-meta__item text-right">
            <span className="bank-label !text-teal-100/55">Available balance</span>
            <span className="bank-balance-meta__value">{loading ? '—' : visible ? formatMoney(available, currency) : '••••••'}</span>
          </div>
        </div>
      </div>
    </section>
  );
});

export default HeroBalance;
