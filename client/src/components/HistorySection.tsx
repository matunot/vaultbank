import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, Search, Download } from 'lucide-react';
import { fullTransactionHistory } from '../data';

const catIcons: Record<string, { icon: React.ComponentType<any>; variant: 'gold' | 'emerald' | 'ruby' | 'sapphire' | 'amethyst' | 'amber' | 'cyan' }> = {
  'Income': { icon: ArrowDownLeft, variant: 'emerald' },
  'Electronics': { icon: ArrowUpRight, variant: 'sapphire' },
  'Dining': { icon: ArrowUpRight, variant: 'ruby' },
  'Auto': { icon: ArrowUpRight, variant: 'cyan' },
  'Luxury': { icon: ArrowUpRight, variant: 'gold' },
  'Tech': { icon: ArrowUpRight, variant: 'amethyst' },
  'Investment': { icon: ArrowDownLeft, variant: 'emerald' },
  'Travel': { icon: ArrowUpRight, variant: 'sapphire' },
  'Entertainment': { icon: ArrowUpRight, variant: 'amethyst' },
  'Groceries': { icon: ArrowUpRight, variant: 'emerald' },
  'Transport': { icon: ArrowUpRight, variant: 'cyan' },
  'Utilities': { icon: ArrowUpRight, variant: 'amber' },
  'Food & Drink': { icon: ArrowUpRight, variant: 'ruby' },
};

export default function HistorySection() {
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => fullTransactionHistory.filter(tx => {
    const isIncome = tx.amount > 0;
    const matchType = filter === 'all' || (filter === 'income' ? isIncome : !isIncome);
    const matchSearch = !search || tx.name.toLowerCase().includes(search.toLowerCase()) || tx.cat.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  }), [filter, search]);

  const totalIn = fullTransactionHistory.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = fullTransactionHistory.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-purple-500/15 rounded-full blur-3xl" />
        <div className="relative z-10">
          <p className="text-xs tracking-widest text-white/40 font-semibold">FULL TRANSACTION HISTORY</p>
          <p className="font-display text-5xl lg:text-6xl text-white mt-2">
            {fullTransactionHistory.length}<span className="text-2xl text-white/40 ml-3">transactions</span>
          </p>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">INCOME</p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">${totalIn.toLocaleString()}</p>
            </div>
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">EXPENSES</p>
              <p className="text-xl font-bold text-rose-400 mt-0.5">${totalOut.toLocaleString()}</p>
            </div>
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">NET</p>
              <p className="text-xl font-bold text-amber-400 mt-0.5">${(totalIn - totalOut).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-3xl p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transactions…"
              className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/30"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'income', 'expense'] as const).map(f => (
              <motion.button
                key={f}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setFilter(f)}
                className={`relative px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  filter === f ? 'text-amber-950' : 'text-white/60 hover:text-white'
                }`}
              >
                {filter === f && (
                  <motion.div layoutId="history-tab" className="absolute inset-0 rounded-xl bg-amber-400 glow-amber" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                )}
                <span className="relative z-10 capitalize">{f}</span>
              </motion.button>
            ))}
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} className="px-4 py-2.5 rounded-xl glass-btn text-white/70 hover:text-white flex items-center gap-2 text-sm font-semibold">
              <Download className="w-4 h-4" /> Export
            </motion.button>
          </div>
        </div>

        <div className="space-y-2 max-h-150 overflow-y-auto pr-1">
          <AnimatePresence mode="popLayout">
            {filtered.map((tx, i) => {
              const positive = tx.amount > 0;
              const catConfig = catIcons[tx.cat] || { icon: ArrowUpRight, variant: 'amber' as const };
              const IconComp = catConfig.icon;
              return (
                <motion.div
                  key={tx.id}
                  layout
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ delay: i * 0.03, duration: 0.3 }}
                  whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.04)' }}
                  className="flex items-center gap-4 p-4 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 cursor-pointer transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-xl border border-white/10">
                    {tx.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{tx.name}</p>
                    <p className="text-xs text-white/40 mt-0.5">{tx.cat} · {tx.date}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      positive ? 'bg-emerald-500/15 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/15'
                    }`}>
                      <IconComp className={`w-4 h-4 ${positive ? 'text-emerald-400' : 'text-rose-400'}`} />
                    </div>
                    <span className={`font-bold ${positive ? 'text-emerald-400' : 'text-white'}`}>
                      {positive ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tx.amount)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}