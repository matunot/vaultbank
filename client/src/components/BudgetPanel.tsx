import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface BudgetCategory {
  name: string;
  budget: number;
  spent: number;
  icon: string;
}

interface BudgetPanelProps {
  budget: BudgetCategory[];
}

export default function BudgetPanel({ budget }: BudgetPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.25 }}
      className="glass-panel rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Budget</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">DECEMBER 2024</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-400">On Track</span>
        </div>
      </div>

      <div className="relative z-10 space-y-4">
        {budget.map((cat, i) => {
          const pct = Math.round((cat.spent / cat.budget) * 100);
          const warning = pct > 85;
          const danger = pct > 95;
          
          return (
            <motion.div
              key={cat.name}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
              className="group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{cat.icon}</span>
                  <span className="text-sm font-medium text-white">{cat.name}</span>
                  {warning && !danger && (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  {danger && (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  )}
                </div>
                <div className="text-right">
                  <span className={`text-sm font-bold ${danger ? 'text-rose-400' : 'text-white'}`}>
                    ${cat.spent.toLocaleString()}
                  </span>
                  <span className="text-xs text-white/30"> / ${cat.budget.toLocaleString()}</span>
                </div>
              </div>
              
              <div className="h-2.5 rounded-full bg-white/5 overflow-hidden glass">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(pct, 100)}%` }}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                  className={`h-full rounded-full relative ${
                    danger ? 'bg-gradient-to-r from-rose-500 to-rose-400' : warning ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  }`}
                  style={{ 
                    boxShadow: danger 
                      ? '0 0 15px rgba(239,68,68,0.5)' 
                      : warning 
                        ? '0 0 15px rgba(245,158,11,0.5)' 
                        : '0 0 15px rgba(16,185,129,0.5)' 
                  }}
                />
              </div>
              
              <div className="flex justify-between mt-1">
                <span className={`text-[10px] ${danger ? 'text-rose-400' : warning ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {pct}% used
                </span>
                <span className="text-[10px] text-white/30">
                  ${(cat.budget - cat.spent).toLocaleString()} left
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="relative z-10 mt-6 pt-5 border-t border-white/5">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center glass-btn rounded-xl py-3">
            <div className="text-[10px] text-white/40 tracking-wider mb-1">BUDGET</div>
            <div className="font-display text-lg text-white">
              ${budget.reduce((s, c) => s + c.budget, 0).toLocaleString()}
            </div>
          </div>
          <div className="text-center glass-btn rounded-xl py-3">
            <div className="text-[10px] text-white/40 tracking-wider mb-1">SPENT</div>
            <div className="font-display text-lg text-amber-400">
              ${budget.reduce((s, c) => s + c.spent, 0).toLocaleString()}
            </div>
          </div>
          <div className="text-center glass-btn rounded-xl py-3">
            <div className="text-[10px] text-white/40 tracking-wider mb-1">REMAINING</div>
            <div className="font-display text-lg text-emerald-400">
              ${budget.reduce((s, c) => s + (c.budget - c.spent), 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
