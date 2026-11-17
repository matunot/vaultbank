import { memo } from 'react';
import { ArrowUpRight, Building2, Send } from 'lucide-react';

interface Props {
  onSend: () => void;
  onDeposit: () => void;
}

const QuickActions = memo(function QuickActions({ onSend, onDeposit }: Props) {
  return (
    <section className="bank-surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="bank-section-title">Quick actions</h2>
        <p className="bank-section-caption">Common account services</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onClick={onSend} className="bank-action-card">
          <span className="bank-action-icon"><Send size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="bank-action-title block">Transfer</span>
            <span className="bank-action-description block">To another VaultBank account</span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
        <button type="button" onClick={onDeposit} className="bank-action-card">
          <span className="bank-action-icon"><Building2 size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="bank-action-title block">Deposit</span>
            <span className="bank-action-description block">View bank deposit options</span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      </div>
    </section>
  );
});

export default QuickActions;
