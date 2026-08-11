import { motion } from 'framer-motion';
import { Plus, AlertCircle, TrendingDown } from 'lucide-react';
import { budgetCategories } from '../data';

export default function BudgetSection() {
  const totalBudget = budgetCategories.reduce((s, c) => s + c.budget, 0);
  const totalSpent = budgetCategories.reduce((s, c) => s + c.spent, 0);
  const totalLeft = totalBudget - totalSpent;
  const overCount = budgetCategories.filter(c => (c.spent / c.budget) > 0.85).length;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-500/15 rounded-full blur-3xl" />
        <div className="relative z-10">
          <p className="text-xs tracking-widest text-white/40 font-semibold">DECEMBER 2024</p>
          <p className="font-display text-5xl lg:text-6xl text-white mt-2">
            ${totalLeft.toLocaleString()}<span className="text-2xl text-white/40 ml-3">left to spend</span>
          </p>

          <div className="mt-5 h-3 rounded-full bg-white/5 overflow-hidden glass">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(totalSpent / totalBudget) * 100}%` }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400"
              style={{ boxShadow: '0 0 10px rgba(245,158,11,0.4)' }}
            />
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">BUDGET</p>
              <p className="text-xl font-bold text-white mt-0.5">${totalBudget.toLocaleString()}</p>
            </div>
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">SPENT</p>
              <p className="text-xl font-bold text-amber-400 mt-0.5">${totalSpent.toLocaleString()}</p>
            </div>
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">REMAINING</p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">${totalLeft.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex justify-between items-center mt-6">
            <div className="flex items-center gap-2">
              {overCount > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-rose-500/20">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-xs font-semibold text-rose-300">{overCount} nearing limit</span>
                </div>
              )}
            </div>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm flex items-center gap-2 glow-amber">
              <Plus className="w-4 h-4" /> New Budget
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {budgetCategories.map((cat, i) => {
          const pct = Math.round((cat.spent / cat.budget) * 100);
          const warning = pct > 85;
          const danger = pct > 95;
          return (
            <motion.div
              key={cat.name}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              className="glass-panel rounded-3xl p-6 hover:scale-[1.01] transition-transform"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{cat.icon}</span>
                  <div>
                    <p className="font-bold text-white">{cat.name}</p>
                    <p className="text-xs text-white/40">Monthly budget</p>
                  </div>
                </div>
                {danger && <TrendingDown className="w-5 h-5 text-rose-400" />}
                {warning && !danger && <AlertCircle className="w-5 h-5 text-amber-400" />}
              </div>

              <div className="flex items-baseline justify-between mb-3">
                <span className={`text-3xl font-display ${danger ? 'text-rose-400' : warning ? 'text-amber-400' : 'text-white'}`}>
                  ${cat.spent.toLocaleString()}
                </span>
                <span className="text-sm text-white/40">/ ${cat.budget.toLocaleString()}</span>
              </div>

              <div className="h-3 rounded-full bg-white/5 overflow-hidden glass">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(pct, 100)}%` }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 1, ease: 'easeOut' }}
                  className={`h-full rounded-full ${
                    danger ? 'bg-gradient-to-r from-rose-600 to-rose-400' : warning ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  }`}
                  style={{ boxShadow: danger ? '0 0 12px rgba(239,68,68,0.5)' : warning ? '0 0 12px rgba(245,158,11,0.5)' : '0 0 12px rgba(16,185,129,0.5)' }}
                />
              </div>

              <div className="flex items-center justify-between mt-3">
                <span className={`text-[11px] font-semibold ${danger ? 'text-rose-400' : warning ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {pct}% used
                </span>
                <span className="text-[11px] text-white/40">
                  ${(cat.budget - cat.spent).toLocaleString()} remaining
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}