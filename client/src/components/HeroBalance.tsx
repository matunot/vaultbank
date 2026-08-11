import { useState, useEffect, memo, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Eye, EyeOff, ArrowUpRight, Sparkles, Plus, Send, Receipt } from 'lucide-react';
import { balance } from '../data';
import RichIcon from './RichIcon';

const Counter = memo(function Counter({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf: number;
    const t0 = Date.now();
    const dur = 2200;
    const tick = () => {
      const p = Math.min((Date.now() - t0) / dur, 1);
      setDisplay(value * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span>${display.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
  );
});

const HeroBalance = memo(function HeroBalance() {
  const [show, setShow] = useState(true);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [4, -4]), { stiffness: 300, damping: 30 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-4, 4]), { stiffness: 300, damping: 30 });

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  }, [mx, my]);

  const handleMouseLeave = useCallback(() => { mx.set(0); my.set(0); }, [mx, my]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative rounded-3xl overflow-hidden iridescent-border will-change-transform"
    >
      <div className="relative rounded-3xl overflow-hidden">
        <div className="absolute inset-0 holo-card opacity-80" />
        <div className="absolute inset-0 glass opacity-50" />
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute right-12 top-1/2 -translate-y-1/2 w-44 h-44 rounded-full border border-amber-500/10 animate-spin-slow pointer-events-none" />
        <div className="absolute right-16 top-1/2 -translate-y-1/2 w-36 h-36 rounded-full border border-purple-500/10 animate-spin-slow pointer-events-none" style={{ animationDirection: 'reverse', animationDuration: '40s' }} />

        <div className="relative z-10 p-6 lg:p-10">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] tracking-[0.3em] text-amber-200/60 font-semibold uppercase">Total Balance</span>
                <motion.button whileTap={{ scale: 0.85 }} onClick={() => setShow(s => !s)}>
                  <RichIcon icon={show ? <Eye size={13} /> : <EyeOff size={13} />} variant="gold" size="sm" />
                </motion.button>
              </div>
              <div className="font-display text-4xl lg:text-6xl text-gold leading-none">
                {show ? <Counter value={balance.total} /> : '••••••••••'}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-300">+14.2%</span>
                </div>
                <span className="text-xs text-white/40">this month</span>
              </div>
            </div>

            <div className="hidden md:grid grid-cols-2 gap-3">
              <div className="glass-panel px-4 py-3 rounded-xl min-w-[110px]">
                <div className="text-[10px] text-white/40 tracking-wider">INCOME</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">${balance.income.toLocaleString()}</div>
              </div>
              <div className="glass-panel px-4 py-3 rounded-xl min-w-[110px]">
                <div className="text-[10px] text-white/40 tracking-wider">SPENT</div>
                <div className="text-lg font-bold text-rose-400 mt-0.5">${balance.spent.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-9 rounded-md bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-600 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                <div className="absolute inset-1 border border-amber-800/40 rounded-sm" />
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px p-1 opacity-40">
                  {Array.from({ length: 9 }).map((_, i) => <div key={i} className="bg-amber-900/30 rounded-[1px]" />)}
                </div>
              </div>
              <div>
                <div className="text-xs text-white/50">VAULT · OBSIDIAN GOLD</div>
                <div className="text-sm font-mono tracking-widest text-amber-200/80 mt-0.5">•••• •••• •••• 4827</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-white/40 tracking-wider">AVAILABLE</div>
              <div className="text-xl font-bold text-white">${balance.available.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {[
              { icon: Send, label: 'Send', primary: true },
              { icon: Plus, label: 'Deposit', primary: false },
              { icon: Receipt, label: 'Statement', primary: false },
              { icon: Sparkles, label: 'Invest', primary: false },
            ].map((b) => (
              <motion.button
                key={b.label}
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  b.primary
                    ? 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-amber-950 glow-amber'
                    : 'glass-btn text-white/80 hover:text-white'
                }`}
              >
                <b.icon className="w-4 h-4" />
                {b.label}
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

export default HeroBalance;
