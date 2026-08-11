import { useState, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Plus, Receipt, ArrowRightLeft, Globe, Smartphone, CheckCircle2, Loader2 } from 'lucide-react';
import RichIcon from './RichIcon';

interface Props {
  onSend: () => void;
  onDeposit: () => void;
  onPayBill: () => void;
  onConvert: () => void;
  onWire: () => void;
  onMobile: () => void;
}

const actions = [
  { id: 'send',    icon: Send,           label: 'Send',     desc: 'To anyone',     variant: 'gold' as const },
  { id: 'deposit', icon: Plus,           label: 'Deposit',  desc: 'Add funds',     variant: 'emerald' as const },
  { id: 'bill',    icon: Receipt,        label: 'Pay Bill', desc: 'Utilities',     variant: 'ruby' as const },
  { id: 'convert', icon: ArrowRightLeft, label: 'Convert',  desc: 'Forex',         variant: 'sapphire' as const },
  { id: 'wire',    icon: Globe,          label: 'Wire',     desc: 'International', variant: 'amethyst' as const },
  { id: 'mobile',  icon: Smartphone,     label: 'Mobile',   desc: 'Top-up',        variant: 'cyan' as const },
];

const QuickActions = memo(function QuickActions({ onSend, onDeposit, onPayBill, onConvert, onWire, onMobile }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handlers: Record<string, () => void> = {
    send: onSend, deposit: onDeposit, bill: onPayBill,
    convert: onConvert, wire: onWire, mobile: onMobile,
  };

  const handleClick = useCallback((id: string) => {
    setActiveId(id);
    setTimeout(() => setActiveId(null), 1000);
    handlers[id]?.();
  }, [handlers]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="glass-panel rounded-3xl p-6 relative overflow-hidden"
    >
      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 mb-5">
        <h3 className="font-display text-2xl text-white">Quick Actions</h3>
        <p className="text-xs text-white/40 mt-1 tracking-wider">TAP ANY ACTION</p>
      </div>

      <div className="relative z-10 grid grid-cols-3 sm:grid-cols-6 gap-3">
        {actions.map((a, i) => (
          <motion.button
            key={a.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            whileHover={{ y: -6, scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => handleClick(a.id)}
            className="glass glass-hover flex flex-col items-center gap-2 p-3 rounded-2xl border border-white/5 group"
          >
            <AnimatePresence mode="wait">
              {activeId === a.id ? (
                <motion.div key="loading" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <RichIcon
                    icon={a.id === 'send' ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                    variant={a.variant} size="md" glow pulse
                  />
                </motion.div>
              ) : (
                <motion.div key="icon" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <RichIcon icon={<a.icon size={18} strokeWidth={2.5} />} variant={a.variant} size="md" glow />
                </motion.div>
              )}
            </AnimatePresence>
            <div className="text-center">
              <div className="text-sm font-semibold text-white group-hover:text-amber-200 transition-colors">{a.label}</div>
              <div className="text-[10px] text-white/40 mt-0.5">{a.desc}</div>
            </div>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
});

export default QuickActions;
