import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Plus } from 'lucide-react';
import RichIcon from './RichIcon';

interface Investment {
  ticker: string;
  name: string;
  price: number;
  change: number;
  value: number;
  shares: number;
}

interface InvestmentsSectionProps {
  investments: Investment[];
  onOpenTrade: () => void;
}

export default function InvestmentsSection({ investments, onOpenTrade }: InvestmentsSectionProps) {
  const totalValue = investments.reduce((s, i) => s + i.value, 0);
  const totalGain = investments.reduce((s, i) => s + (i.value * i.change / 100), 0);
  const gainers = investments.filter(i => i.change > 0).length;

  return (
    <div className="space-y-5">
      {/* Hero Portfolio Value */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-emerald-500/15 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs tracking-widest text-white/40 font-semibold">TOTAL PORTFOLIO</p>
              <p className="font-display text-5xl lg:text-6xl text-white mt-2">
                ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-300">
                    {totalGain >= 0 ? '+' : '-'}${Math.abs(totalGain).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <span className="text-sm text-white/40">today's gain</span>
              </div>
            </div>
            <motion.button 
              onClick={onOpenTrade}
              whileHover={{ scale: 1.04 }} 
              whileTap={{ scale: 0.97 }} 
              className="px-5 py-2.5 rounded-xl bg-linear-to-r from-emerald-400 to-teal-400 text-emerald-950 font-bold text-sm flex items-center gap-2 glow-emerald"
            >
              <Plus className="w-4 h-4" /> New Trade
            </motion.button>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">HOLDINGS</p>
              <p className="text-xl font-bold text-white mt-0.5">{investments.filter(inv => inv.shares > 0).length}</p>
            </div>
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">GAINERS</p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">{gainers}</p>
            </div>
            <div className="glass-btn rounded-xl p-3">
              <p className="text-[10px] text-white/40 tracking-wider">ALLOCATION</p>
              <p className="text-xl font-bold text-amber-400 mt-0.5">5</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Holdings List */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display text-xl text-white">Holdings</h3>
          <span className="text-xs text-white/40">Live prices</span>
        </div>
        <div className="space-y-2">
          {investments.map((inv, i) => {
            const positive = inv.change > 0;
            return (
              <motion.div
                key={inv.ticker}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 + 0.2 }}
                whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.05)' }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all cursor-pointer"
              >
                <RichIcon
                  icon={<span className="font-display text-xs font-bold">{inv.ticker}</span>}
                  variant={positive ? 'emerald' : 'ruby'}
                  size="md"
                  glow
                />
                <div className="flex-1">
                  <p className="font-semibold text-white">{inv.name}</p>
                  <p className="text-xs text-white/40 mt-0.5">{inv.shares.toLocaleString()} shares · ${inv.price.toLocaleString()}/share</p>
                </div>
                {/* Mini sparkline */}
                <div className="hidden md:block w-24 h-10">
                  <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-full">
                    <motion.path
                      d={positive ? "M0,20 L20,18 L40,22 L60,15 L80,12 L100,5" : "M0,10 L20,15 L40,12 L60,20 L80,22 L100,28"}
                      fill="none"
                      stroke={positive ? '#10b981' : '#ef4444'}
                      strokeWidth="2"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ delay: 0.4 + i * 0.08, duration: 1 }}
                    />
                  </svg>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white">${inv.value.toLocaleString()}</p>
                  <div className={`flex items-center gap-0.5 justify-end mt-0.5 text-xs font-semibold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {positive ? '+' : ''}{inv.change}%
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Allocation Pie */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-4">Asset Allocation</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Stocks',  pct: 45, color: 'from-blue-500 to-cyan-400',    val: 56430 },
            { label: 'Crypto',  pct: 28, color: 'from-purple-500 to-pink-400',   val: 35120 },
            { label: 'Bonds',   pct: 18, color: 'from-emerald-500 to-teal-400', val: 22572 },
            { label: 'Cash',    pct:  9, color: 'from-amber-500 to-orange-400',  val: 11278 },
          ].map((asset, i) => (
            <motion.div
              key={asset.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.06 }}
              className="space-y-2"
            >
              <div className="flex justify-between text-sm">
                <span className="text-white/80 font-medium">{asset.label}</span>
                <span className="text-white font-bold">{asset.pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${asset.pct}%` }}
                  transition={{ delay: 0.6 + i * 0.1, duration: 1 }}
                  className={`h-full rounded-full bg-linear-to-r ${asset.color}`}
                />
              </div>
              <p className="text-xs text-white/40">${asset.val.toLocaleString()}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
