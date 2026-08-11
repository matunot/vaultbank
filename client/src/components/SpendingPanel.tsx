import { useState } from 'react';
import { motion } from 'framer-motion';
import { spending, weekly } from '../data';
import RichIcon from './RichIcon';

export default function SpendingPanel() {
  const [hover, setHover] = useState<number | null>(null);
  const total = spending.reduce((s, x) => s + x.amount, 0);
  const R = 70, C = 2 * Math.PI * R, cx = 90, cy = 90;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.25 }}
      className="glass-panel rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Spending</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">DEC 2024 · BREAKDOWN</p>
        </div>
        <div className="text-right glass-btn px-3 py-2 rounded-xl">
          <div className="text-[10px] text-white/40 tracking-wider">TOTAL</div>
          <div className="text-lg font-bold text-gold">${total.toLocaleString()}</div>
        </div>
      </div>

      {/* Donut */}
      <div className="relative z-10 flex justify-center mb-6">
        <div className="relative w-48 h-48">
          <div className="absolute inset-4 rounded-full bg-amber-500/5 blur-2xl" />
          <svg viewBox="0 0 180 180" className="w-48 h-48 -rotate-90">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="14" />
            {spending.map((seg, i) => {
              const dash = (seg.pct / 100) * C;
              const off  = spending.slice(0, i).reduce((s, x) => s + (x.pct / 100) * C, 0);
              return (
                <motion.circle
                  key={i}
                  cx={cx} cy={cy} r={R}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={hover === i ? 18 : 14}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-off}
                  initial={{ opacity: 0, strokeDasharray: `0 ${C}` }}
                  animate={{ opacity: 1, strokeDasharray: `${dash} ${C - dash}` }}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.8 }}
                  style={{
                    filter: hover === i ? `drop-shadow(0 0 10px ${seg.glow})` : 'none',
                    cursor: 'pointer',
                    transition: 'stroke-width .25s, filter .25s',
                  }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {hover !== null ? (
              <>
                <span className="text-[10px] tracking-widest text-white/40">{spending[hover].label.toUpperCase()}</span>
                <span className="text-2xl font-display text-white">${spending[hover].amount.toLocaleString()}</span>
                <span className="text-xs font-semibold" style={{ color: spending[hover].color }}>{spending[hover].pct}%</span>
              </>
            ) : (
              <>
                <span className="text-[10px] tracking-widest text-white/40">THIS MONTH</span>
                <span className="text-2xl font-display text-gold">${total.toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="relative z-10 grid grid-cols-2 gap-x-4 gap-y-2.5 mb-6">
        {spending.map((seg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 + i * 0.05 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 group-hover:scale-125 transition-transform"
              style={{ background: seg.color, boxShadow: `0 0 8px ${seg.glow}` }}
            />
            <span className="text-xs text-white/50 group-hover:text-white/80 truncate flex-1 transition-colors">{seg.label}</span>
            <span className="text-xs font-bold text-white/70">{seg.pct}%</span>
          </motion.div>
        ))}
      </div>

      {/* Weekly bars */}
      <div className="relative z-10 pt-5 border-t border-white/5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-white/40 tracking-wider font-semibold">WEEKLY ACTIVITY</span>
          <div className="flex items-center gap-1.5">
            <RichIcon icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>} variant="emerald" size="sm" />
            <span className="text-xs text-emerald-400 font-semibold">+8.4%</span>
          </div>
        </div>
        <div className="flex items-end gap-2 h-20">
          {weekly.map((b, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${b.v}%` }}
                transition={{ delay: 0.8 + i * 0.06, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="w-full rounded-t-md bg-gradient-to-t from-amber-500/40 to-amber-300/80 hover:from-amber-400 hover:to-amber-200 cursor-pointer transition-colors"
                style={{ boxShadow: '0 0 12px rgba(212,175,55,0.2)' }}
              />
              <span className="text-[10px] text-white/30 font-medium">{b.d}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
