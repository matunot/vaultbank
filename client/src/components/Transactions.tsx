import { memo } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Clock, Coffee, Plane, CreditCard, Gem, TrendingUp, Smartphone, Zap } from 'lucide-react';
import RichIcon from './RichIcon';

interface Transaction {
  id: number; name: string; cat: string; amount: number; date: string; icon: string; gem: string;
}

interface Props { transactions: Transaction[]; }

const catIcons: Record<string, { icon: React.ComponentType<any>; variant: 'gold' | 'emerald' | 'ruby' | 'sapphire' | 'amethyst' | 'amber' | 'cyan' }> = {
  'Dining': { icon: Coffee, variant: 'ruby' },
  'Income': { icon: TrendingUp, variant: 'emerald' },
  'Auto': { icon: Zap, variant: 'cyan' },
  'Luxury': { icon: Gem, variant: 'gold' },
  'Tech': { icon: Smartphone, variant: 'amethyst' },
  'Investment': { icon: TrendingUp, variant: 'emerald' },
  'Travel': { icon: Plane, variant: 'sapphire' },
  'Transfer': { icon: CreditCard, variant: 'amber' },
};

const TxItem = memo(function TxItem({ tx, index }: { tx: Transaction; index: number }) {
  const positive = tx.amount > 0;
  const catConfig = catIcons[tx.cat] || { icon: CreditCard, variant: 'amber' as const };
  const IconComp = catConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.2 + index * 0.04, duration: 0.4 }}
      whileHover={{ x: 4 }}
      className="glass glass-hover flex items-center gap-3 p-3 rounded-2xl cursor-pointer"
    >
      <RichIcon icon={<IconComp size={16} strokeWidth={2} />} variant={positive ? 'emerald' : catConfig.variant} size="sm" glow />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white text-sm truncate">{tx.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] text-white/40">{tx.cat}</span>
          <span className="text-white/20">·</span>
          <span className="text-[11px] text-white/40 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {tx.date}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <RichIcon
          icon={positive ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
          variant={positive ? 'emerald' : 'ruby'}
          size="sm"
        />
        <span className={`font-bold text-sm ${positive ? 'text-emerald-400' : 'text-white'}`}>
          {positive ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
        </span>
      </div>
    </motion.div>
  );
});

const Transactions = memo(function Transactions({ transactions }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="glass-panel rounded-3xl p-6 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-5">
        <div>
          <h3 className="font-display text-2xl text-white">Recent Activity</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">LATEST TRANSACTIONS</p>
        </div>
        <button className="text-xs font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1 glass-btn px-3 py-1.5 rounded-lg">
          View all <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="relative z-10 space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {transactions.map((tx, i) => (
          <TxItem key={tx.id} tx={tx} index={i} />
        ))}
      </div>
    </motion.div>
  );
});

function ArrowDownLeft(props: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M17 3l4 4-4 4" /><path d="M21 7H7a4 4 0 00-4 4v10" />
    </svg>
  );
}

export default Transactions;
