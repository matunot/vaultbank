import { useState, memo, useCallback } from 'react';
import { Send, Plus, CheckCircle2, Loader2 } from 'lucide-react';
import RichIcon from './RichIcon';

interface Props {
  onSend: () => void;
  onDeposit: () => void;
}

const actions = [
  { id: 'send', icon: Send, label: 'Send', desc: 'VaultBank account', variant: 'gold' as const },
  { id: 'deposit', icon: Plus, label: 'Deposit', desc: 'Bank transfer', variant: 'emerald' as const },
];

const QuickActions = memo(function QuickActions({ onSend, onDeposit }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleClick = useCallback((id: string) => {
    setActiveId(id);
    window.setTimeout(() => setActiveId(null), 1000);
    const handlers: Record<string, () => void> = { send: onSend, deposit: onDeposit };
    handlers[id]?.();
  }, [onSend, onDeposit]);

  return (
    <div
      className="vb-enter glass-panel rounded-3xl p-6 relative overflow-hidden"
      style={{ '--vb-delay': '150ms' } as React.CSSProperties}
    >
      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl" />
      <div className="relative z-10 mb-5">
        <h3 className="font-display text-2xl text-white">Quick Actions</h3>
        <p className="text-xs text-white/40 mt-1 tracking-wider">BANKING ACTIONS</p>
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-3">
        {actions.map((a) => {
          const isActive = activeId === a.id;
          return (
            <button
              key={a.id}
              onClick={() => handleClick(a.id)}
              className="glass glass-hover flex flex-col items-center gap-2 p-3 rounded-2xl border border-white/5 group transition-transform duration-200 hover:-translate-y-1 active:scale-95"
            >
              <div key={isActive ? 'loading' : 'icon'} className="vb-scale-in">
                {isActive ? (
                  <RichIcon
                    icon={a.id === 'send' ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                    variant={a.variant} size="md" glow pulse
                  />
                ) : (
                  <RichIcon icon={<a.icon size={18} strokeWidth={2.5} />} variant={a.variant} size="md" glow />
                )}
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-white group-hover:text-amber-200 transition-colors">{a.label}</div>
                <div className="text-[10px] text-white/40 mt-0.5">{a.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default QuickActions;
