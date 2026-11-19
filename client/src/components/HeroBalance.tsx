import { useState, useEffect, memo, useCallback, useRef } from 'react';
import { Eye, EyeOff, Sparkles, Plus, Send, Receipt, ShieldCheck } from 'lucide-react';
import RichIcon from './RichIcon';

interface HeroBalanceProps {
  balance?: number;
  accountNumber?: string;
  loading?: boolean;
  income?: number;
  expenses?: number;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

// Count-up is a desktop flourish. On phones (and for reduced-motion users) the
// final balance paints immediately: no intermediate value, no LCP churn.
const Counter = memo(function Counter({ value }: { value: number }) {
  const animateOnMount = !prefersReducedMotion() && !isCoarsePointer();
  const [display, setDisplay] = useState(animateOnMount ? 0 : value);

  useEffect(() => {
    if (!animateOnMount) { setDisplay(value); return; }
    let raf: number;
    const t0 = Date.now();
    const dur = 900;
    const tick = () => {
      const p = Math.min((Date.now() - t0) / dur, 1);
      setDisplay(value * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, animateOnMount]);

  return (
    <span>${display.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
  );
});

const HeroBalance = memo(function HeroBalance({ balance = 0, accountNumber, loading, income = 0, expenses = 0 }: HeroBalanceProps) {
  const [show, setShow] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  const displayBalance = Number.isFinite(balance) ? balance : 0;
  const displayIncome = Number.isFinite(income) ? income : 0;
  const displayExpenses = Number.isFinite(expenses) ? expenses : 0;

  // Desktop pointer tilt, written straight to CSS variables (no React render).
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el || isCoarsePointer()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--hero-rx', `${(-y * 5).toFixed(2)}deg`);
    el.style.setProperty('--hero-ry', `${(x * 5).toFixed(2)}deg`);
  }, []);

  const handleMouseLeave = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--hero-rx', '0deg');
    el.style.setProperty('--hero-ry', '0deg');
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="vb-enter hero-tilt relative rounded-3xl overflow-hidden iridescent-border"
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
                <button
                  onClick={() => setShow(s => !s)}
                  aria-label={show ? 'Hide balance' : 'Show balance'}
                  className="transition-transform active:scale-90"
                >
                  <RichIcon icon={show ? <Eye size={13} /> : <EyeOff size={13} />} variant="gold" size="sm" />
                </button>
              </div>
              <div className="font-display text-4xl lg:text-6xl text-gold leading-none">
                {loading ? 'Loading...' : (show ? <Counter value={displayBalance} /> : '••••••••••')}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-300">Live balance</span>
                </div>
                <span className="text-xs text-white/40">from your account ledger</span>
              </div>
            </div>

            <div className="hidden md:grid grid-cols-2 gap-3">
              <div className="glass-panel px-4 py-3 rounded-xl min-w-27.5">
                <div className="text-[10px] text-white/40 tracking-wider">RECENT IN</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">${displayIncome.toLocaleString()}</div>
              </div>
              <div className="glass-panel px-4 py-3 rounded-xl min-w-27.5">
                <div className="text-[10px] text-white/40 tracking-wider">RECENT OUT</div>
                <div className="text-lg font-bold text-rose-400 mt-0.5">${displayExpenses.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-9 shrink-0 rounded-md bg-linear-to-br from-amber-300 via-yellow-400 to-amber-600 relative overflow-hidden">
                <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/40 to-transparent" />
                <div className="absolute inset-1 border border-amber-800/40 rounded-sm" />
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px p-1 opacity-40">
                  {Array.from({ length: 9 }).map((_, i) => <div key={i} className="bg-amber-900/30 rounded-[1px]" />)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-white/50">VAULT · OBSIDIAN GOLD</div>
                <div className="text-xs sm:text-sm font-mono tracking-wider sm:tracking-widest text-amber-200/80 mt-0.5 break-all">
                  {accountNumber || 'Account number available after sign-in'}
                </div>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-[10px] text-white/40 tracking-wider">AVAILABLE</div>
              <div className="text-lg sm:text-xl font-bold text-white">${displayBalance.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {[
              { icon: Send, label: 'Send', primary: true },
              { icon: Plus, label: 'Deposit', primary: false },
              { icon: Receipt, label: 'Statement', primary: false },
              { icon: Sparkles, label: 'Invest', primary: false },
            ].map((b) => (
              <button
                key={b.label}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] ${
                  b.primary
                    ? 'bg-linear-to-r from-amber-400 via-yellow-400 to-amber-500 text-amber-950 glow-amber'
                    : 'glass-btn text-white/80 hover:text-white'
                }`}
              >
                <b.icon className="w-4 h-4" />
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default HeroBalance;
