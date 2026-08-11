import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { investments } from '../data';
import RichIcon from './RichIcon';

export default function InvestmentsPanel() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.35 }}
      className="glass-panel rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Portfolio</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">INVESTMENTS · LIVE</p>
        </div>
        <button className="text-xs font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1 glass-btn px-3 py-1.5 rounded-lg">
          Manage <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="relative z-10 space-y-2">
        {investments.map((inv, i) => {
          const positive = inv.change > 0;
          return (
            <motion.div
              key={inv.ticker}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.08 }}
              whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.03)' }}
              className="glass glass-hover flex items-center gap-4 p-3.5 rounded-2xl cursor-pointer"
            >
              <RichIcon
                icon={<span className="font-display text-xs font-bold">{inv.ticker}</span>}
                variant={positive ? 'emerald' : 'ruby'}
                size="md"
                glow
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate text-sm">{inv.name}</p>
                <p className="text-xs text-white/40 mt-0.5">${inv.price.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-sm text-white">${inv.value.toLocaleString()}</p>
                <div className={`flex items-center gap-0.5 justify-end mt-0.5 text-xs font-semibold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {positive ? '+' : ''}{inv.change}%
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="relative z-10 mt-5 pt-5 border-t border-white/5 flex items-center justify-between">
        <span className="text-xs text-white/40 tracking-wider font-semibold">TOTAL VALUE</span>
        <span className="font-display text-xl text-gold">$125,400</span>
      </div>
    </motion.div>
  );
}
