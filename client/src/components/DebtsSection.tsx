import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, TrendingDown, ArrowRight, Calculator, Send, Plus, Calendar,
  Zap, Clock, Award, TrendingUp, Target, DollarSign, Percent,
  Sparkles, Activity, X,
} from 'lucide-react';
import { debts, debtOffers, debtCategories } from '../data';

type CalcTab = 'extra' | 'consolidate' | 'dti';
type LoanCategory = string;

export default function DebtsSection() {
  const [selectedOffer, setSelectedOffer] = useState<string | null>(null);
  const [loanAmount, setLoanAmount] = useState('25000');
  const [loanTerm, setLoanTerm] = useState('3');
  const [showApply, setShowApply] = useState(false);
  const [calcTab, setCalcTab] = useState<CalcTab>('extra');
  const [activeCategory, setActiveCategory] = useState<LoanCategory>('all');

  // Extra payment calculator
  const [extraPayment, setExtraPayment] = useState('200');
  // Consolidation inputs
  const [consolidateAmount, setConsolidateAmount] = useState('439000');
  const [consolidateRate, setConsolidateRate] = useState('5.5');
  // DTI inputs
  const [monthlyIncome, setMonthlyIncome] = useState('12000');

  const activeDebts = debts.filter(d => d.status === 'active');
  const completedDebts = debts.filter(d => d.status === 'completed');
  const totalRemaining = activeDebts.reduce((s, d) => s + d.remaining, 0);
  const totalMonthly = activeDebts.reduce((s, d) => s + d.monthly, 0);
  const totalPaid = debts.reduce((s, d) => s + d.paid, 0);
  const totalBorrowed = debts.reduce((s, d) => s + d.total, 0);
  const interestPaid = totalPaid - (totalBorrowed - totalRemaining);

  const creditScore = 762;
  const creditRating = 'Excellent';

  // ── Urgent loans ──
  const urgentLoans = debtOffers.filter(o => o.category === 'urgent');
  // ── Non-urgent loans ──
  const regularLoans = debtOffers.filter(o => o.category !== 'urgent');
  const filteredLoans = activeCategory === 'all' ? regularLoans : regularLoans.filter(o => o.category === activeCategory);

  // ── Loan calculator ──
  const selectedOfferObj = selectedOffer ? debtOffers.find(o => o.name === selectedOffer) : null;
  const calcRate = selectedOfferObj?.rate || '6.99';
  const rateDecimal = parseFloat(calcRate.replace('%', '')) / 100;
  const amount = parseFloat(loanAmount) || 0;
  const months = parseInt(loanTerm) * 12;
  const monthlyPayment = amount > 0 ? (amount * (rateDecimal / 12) * Math.pow(1 + rateDecimal / 12, months)) / (Math.pow(1 + rateDecimal / 12, months) - 1) : 0;
  const totalPayment = monthlyPayment * months;
  const totalInterest = totalPayment - amount;

  // ── Extra payment impact ──
  const extraImpact = useMemo(() => {
    if (!activeDebts.length) return { monthsSaved: 0, interestSaved: 0, newMonths: 0 };
    const extra = parseFloat(extraPayment) || 0;
    // Use highest-rate debt for snowball
    const debt = [...activeDebts].sort((a, b) => b.rate - a.rate)[0];
    const r = debt.rate / 100 / 12;
    const baseMonthly = debt.monthly;
    let bal = debt.remaining, monthsBase = 0, monthsExtra = 0, intBase = 0, intExtra = 0;
    // Base scenario
    let b = bal;
    while (b > 0 && monthsBase < 600) {
      const int = b * r;
      intBase += int;
      b = b + int - baseMonthly;
      monthsBase++;
    }
    // Extra scenario
    b = bal;
    while (b > 0 && monthsExtra < 600) {
      const int = b * r;
      intExtra += int;
      b = b + int - (baseMonthly + extra);
      monthsExtra++;
    }
    return {
      monthsSaved: monthsBase - monthsExtra,
      interestSaved: intBase - intExtra,
      newMonths: monthsExtra,
      originalMonths: monthsBase,
      targetDebt: debt.name,
    };
  }, [extraPayment, activeDebts]);

  // ── Consolidation savings ──
  const consolidationSavings = useMemo(() => {
    const consolidated = parseFloat(consolidateAmount) || 0;
    const newRate = parseFloat(consolidateRate) / 100;
    // Current weighted avg rate
    const weightedRate = activeDebts.reduce((sum, d) => sum + (d.remaining * d.rate), 0) / totalRemaining;
    const termYears = 7;
    const termMonths = termYears * 12;
    // Current monthly payment (sum)
    const currentMonthly = totalMonthly;
    // New consolidated monthly
    const newMonthly = (consolidated * (newRate / 12) * Math.pow(1 + newRate / 12, termMonths)) / (Math.pow(1 + newRate / 12, termMonths) - 1);
    const monthlySavings = currentMonthly - newMonthly;
    const totalInterestCurrent = (currentMonthly * termMonths) - consolidated;
    const totalInterestNew = (newMonthly * termMonths) - consolidated;
    return {
      monthlySavings,
      totalInterestSavings: totalInterestCurrent - totalInterestNew,
      newMonthly,
      currentMonthly,
      rateDiff: weightedRate - parseFloat(consolidateRate),
    };
  }, [consolidateAmount, consolidateRate, activeDebts, totalRemaining, totalMonthly]);

  // ── DTI calculation ──
  const dti = useMemo(() => {
    const income = parseFloat(monthlyIncome) || 1;
    return {
      ratio: (totalMonthly / income) * 100,
      status: (totalMonthly / income) * 100 < 28 ? 'Excellent' : (totalMonthly / income) * 100 < 36 ? 'Good' : (totalMonthly / income) * 100 < 43 ? 'Fair' : 'High',
      color: (totalMonthly / income) * 100 < 28 ? '#10b981' : (totalMonthly / income) * 100 < 36 ? '#f59e0b' : '#ef4444',
    };
  }, [monthlyIncome, totalMonthly]);

  // ── Debt health score ──
  const debtHealth = useMemo(() => {
    const payoffPct = (totalPaid / totalBorrowed) * 100;
    const dtiFactor = Math.max(0, 100 - dti.ratio * 2);
    const score = Math.round((payoffPct * 0.4 + dtiFactor * 0.4 + (creditScore / 8.5) * 0.2));
    return Math.min(100, Math.max(0, score));
  }, [totalPaid, totalBorrowed, dti.ratio, creditScore]);

  return (
    <div className="space-y-5">
      {/* ── Hero Stats ── */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-blue-500/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs tracking-widest text-white/40 font-semibold">DEBT MANAGEMENT</p>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
                {creditScore} • {creditRating}
              </span>
            </div>
            <p className="font-display text-5xl lg:text-6xl text-white">
              ${totalRemaining.toLocaleString()}
            </p>
            <p className="text-sm text-rose-400 mt-1.5">
              ${totalMonthly.toLocaleString()}/month across {activeDebts.length} active debts
            </p>

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-300">${totalPaid.toLocaleString()} total paid</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-rose-500/20">
                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-xs font-bold text-rose-300">${interestPaid.toLocaleString('en-US', { maximumFractionDigits: 0 })} in interest</span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 mt-6">
              <div className="glass-btn rounded-xl p-3 text-center"><p className="text-[10px] text-white/40 tracking-wider">ACTIVE</p><p className="text-xl font-bold text-rose-400 mt-0.5">{activeDebts.length}</p></div>
              <div className="glass-btn rounded-xl p-3 text-center"><p className="text-[10px] text-white/40 tracking-wider">PAID OFF</p><p className="text-xl font-bold text-emerald-400 mt-0.5">{completedDebts.length}</p></div>
              <div className="glass-btn rounded-xl p-3 text-center"><p className="text-[10px] text-white/40 tracking-wider">BORROWED</p><p className="text-xl font-bold text-white mt-0.5">${(totalBorrowed / 1000).toFixed(0)}k</p></div>
              <div className="glass-btn rounded-xl p-3 text-center"><p className="text-[10px] text-white/40 tracking-wider">PAYOFF</p><p className="text-xl font-bold text-emerald-400 mt-0.5">{Math.round((totalPaid / totalBorrowed) * 100)}%</p></div>
            </div>
          </div>

          {/* Debt Health Gauge */}
          <div className="flex flex-col items-center justify-center">
            <p className="text-xs tracking-wider text-white/40 font-semibold mb-3">DEBT HEALTH</p>
            <div className="relative w-40 h-40">
              <svg viewBox="0 0 120 120" className="w-40 h-40 -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                <motion.circle cx="60" cy="60" r="52" fill="none" stroke="url(#healthGrad)" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 52}`}
                  initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - debtHealth / 100) }}
                  transition={{ duration: 2, ease: 'easeOut' }}
                />
                <defs>
                  <linearGradient id="healthGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="50%" stopColor="#d4af37" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-4xl text-gold">{debtHealth}</span>
                <span className="text-[10px] text-emerald-400 font-bold tracking-wider">{debtHealth > 70 ? 'EXCELLENT' : debtHealth > 50 ? 'GOOD' : 'FAIR'}</span>
              </div>
            </div>
            <p className="text-[10px] text-white/40 text-center mt-2 max-w-40">
              Based on payoff rate, DTI, and credit score
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6 relative z-10">
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
            className="flex-1 px-5 py-3 rounded-xl bg-linear-to-r from-blue-400 to-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 glow-blue"
          >
            <Send className="w-4 h-4" /> Make Payment
          </motion.button>
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowApply(true)}
            className="flex-1 px-5 py-3 rounded-xl glass-btn text-sm font-bold text-white/80 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Loan
          </motion.button>
        </div>
      </motion.div>

      {/* ── URGENT LOANS - Highlighted Section ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="relative rounded-3xl overflow-hidden iridescent-border"
      >
        <div className="relative p-6 lg:p-8 bg-linear-to-br from-rose-500/10 via-orange-500/5 to-amber-500/10">
          <div className="absolute inset-0 glass opacity-40" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-rose-500/20 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 2, repeat: Infinity }}>
                <Zap className="w-6 h-6 text-amber-300" />
              </motion.div>
              <div>
                <h3 className="font-display text-2xl text-gold">Urgent & Emergency Loans</h3>
                <p className="text-xs text-white/50 mt-0.5">Instant approval • Money in your account today</p>
              </div>
              <div className="ml-auto hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>
                <span className="text-xs font-bold text-rose-300">24/7 AVAILABLE</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {urgentLoans.map((loan, i) => (
                <motion.div
                  key={loan.name}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.1 }}
                  whileHover={{ y: -6, scale: 1.02 }}
                  onClick={() => { setSelectedOffer(loan.name); setShowApply(true); }}
                  className="relative p-5 rounded-2xl bg-linear-to-br from-white/8 to-white/2 border border-white/10 hover:border-amber-500/40 cursor-pointer overflow-hidden group"
                >
                  <div className="absolute inset-0 shimmer opacity-40 group-hover:opacity-70 transition-opacity" />
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: `${loan.color}30`, border: `1px solid ${loan.color}60` }}>
                        {loan.icon}
                      </div>
                      <span className="px-2 py-1 rounded-full text-[9px] font-bold bg-amber-400 text-amber-950 flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" />{loan.badge}
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-lg">{loan.name}</h4>
                    <p className="text-xs text-white/50 mt-1 mb-4 leading-relaxed">{loan.desc}</p>

                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div>
                        <p className="text-[9px] text-white/40 tracking-wider">UP TO</p>
                        <p className="text-base font-bold text-gold">${loan.maxAmount.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-white/40 tracking-wider">APR FROM</p>
                        <p className="text-base font-bold text-white">{loan.rate}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mb-4 text-[11px]">
                      <Clock className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300 font-semibold">{loan.processing} approval</span>
                    </div>

                    <div className="space-y-1.5 mb-4">
                      {loan.features.map((f, j) => (
                        <div key={j} className="flex items-center gap-1.5 text-xs text-white/60">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>

                    <button className="w-full py-2.5 rounded-xl bg-linear-to-r from-amber-400 to-orange-500 text-amber-950 font-bold text-sm flex items-center justify-center gap-2 glow-amber group-hover:shadow-lg group-hover:shadow-amber-500/30 transition-shadow">
                      Apply Now <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Active Debts ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display text-xl text-white">Active Debts</h3>
            <p className="text-xs text-white/40 mt-0.5">Track and pay off your obligations</p>
          </div>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="px-4 py-2 rounded-xl glass-btn text-sm font-semibold text-white/70 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Schedule
          </motion.button>
        </div>
        <div className="space-y-3">
          {activeDebts.map((debt, i) => {
            const pct = Math.round((debt.paid / debt.total) * 100);
            return (
              <motion.div
                key={debt.id}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.08 }}
                whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.05)' }}
                className="p-5 rounded-2xl bg-white/3 border border-white/5 hover:border-white/10 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: `${debt.color}20`, border: `1px solid ${debt.color}40` }}>
                      {debt.icon}
                    </div>
                    <div>
                      <p className="font-bold text-white text-lg">{debt.name}</p>
                      <p className="text-xs text-white/40">{debt.term} · Started {debt.startDate}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-white/40 tracking-wider">NEXT PAYMENT</p>
                    <p className="text-sm font-bold text-amber-400">{debt.nextPayment}</p>
                    <p className="text-xs font-bold text-white">${debt.monthly.toLocaleString()}/mo</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span className="text-white/50">Paid ${debt.paid.toLocaleString()}</span>
                  <span style={{ color: debt.color }} className="font-bold">{pct}%</span>
                  <span className="text-white/50">${debt.remaining.toLocaleString()} left</span>
                </div>

                <div className="h-2.5 rounded-full bg-white/5 overflow-hidden glass">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ delay: 0.3 + i * 0.1, duration: 1.2 }}
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${debt.color}, ${debt.color}dd)`, boxShadow: `0 0 10px ${debt.color}60` }}
                  />
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" style={{ color: debt.color }} />
                    <span className="text-[11px] text-white/50">{debt.rate}% APR</span>
                  </div>
                  <span className="text-[11px] text-white/40">{Math.ceil(debt.remaining / debt.monthly)} months remaining</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ── All Loan Types (Categorized) ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h3 className="font-display text-xl text-white">Explore Loan Options</h3>
            <p className="text-xs text-white/40 mt-0.5">{debtOffers.length} loan types across {debtCategories.length} categories</p>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              activeCategory === 'all' ? 'bg-amber-400 text-amber-950 glow-amber' : 'glass-btn text-white/60 hover:text-white'
            }`}
          >
            All ({regularLoans.length})
          </button>
          {debtCategories.map(cat => {
            const count = regularLoans.filter(o => o.category === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  activeCategory === cat.id ? 'bg-amber-400 text-amber-950 glow-amber' : 'glass-btn text-white/60 hover:text-white'
                }`}
              >
                <span>{cat.icon}</span>{cat.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {filteredLoans.map((offer) => (
              <motion.div
                key={offer.name}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                whileHover={{ y: -4, scale: 1.01 }}
                onClick={() => { setSelectedOffer(offer.name); setLoanAmount(String(Math.min(parseFloat(loanAmount) || 25000, offer.maxAmount))); }}
                className={`relative p-5 rounded-2xl cursor-pointer overflow-hidden group border ${
                  selectedOffer === offer.name ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/5 bg-white/2 hover:bg-white/4 hover:border-white/10'
                }`}
              >
                {offer.badge && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ background: `${offer.color}25`, border: `1px solid ${offer.color}40`, color: offer.color }}>
                    {offer.badge}
                  </span>
                )}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl" style={{ background: `${offer.color}20`, border: `1px solid ${offer.color}40` }}>
                    {offer.icon}
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">{offer.name}</p>
                    <p className="text-[10px] text-white/40">{offer.term}</p>
                  </div>
                </div>
                <p className="text-xs text-white/50 leading-relaxed mb-4 min-h-9">{offer.desc}</p>

                <div className="grid grid-cols-3 gap-2 mb-4 pt-3 border-t border-white/5">
                  <div>
                    <p className="text-[9px] text-white/40 tracking-wider">UP TO</p>
                    <p className="text-xs font-bold text-white">${(offer.maxAmount / 1000).toFixed(0)}K</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/40 tracking-wider">FROM</p>
                    <p className="text-xs font-bold" style={{ color: offer.color }}>{offer.rate}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/40 tracking-wider">MIN CREDIT</p>
                    <p className="text-xs font-bold text-white">{offer.minCredit}</p>
                  </div>
                </div>

                {offer.features && (
                  <div className="space-y-1 mb-3">
                    {offer.features.slice(0, 3).map((f, j) => (
                      <div key={j} className="flex items-center gap-1 text-[10px] text-white/50">
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />{f}
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedOffer(offer.name); setShowApply(true); }}
                  className="w-full py-2 rounded-lg glass-btn text-xs font-bold text-white/70 hover:text-white flex items-center justify-center gap-1.5"
                >
                  Apply <ArrowRight className="w-3 h-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Smart Calculators ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
            <Calculator className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="font-display text-xl text-white">Smart Calculators</h3>
            <p className="text-xs text-white/40">Plan your debt payoff strategy</p>
          </div>
        </div>

        <div className="flex gap-2 mb-5">
          {[
            { id: 'extra' as CalcTab, label: 'Extra Payments', icon: DollarSign },
            { id: 'consolidate' as CalcTab, label: 'Consolidation', icon: TrendingUp },
            { id: 'dti' as CalcTab, label: 'Debt-to-Income', icon: Percent },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setCalcTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                calcTab === tab.id ? 'bg-amber-400 text-amber-950 glow-amber' : 'glass-btn text-white/60 hover:text-white'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />{tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Extra Payment Calculator ── */}
          {calcTab === 'extra' && (
            <motion.div key="extra" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">EXTRA MONTHLY PAYMENT</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-display text-xl">$</span>
                      <input type="number" value={extraPayment} onChange={(e) => setExtraPayment(e.target.value)}
                        className="w-full glass-input rounded-xl pl-9 pr-4 py-3 text-xl font-display text-white"
                      />
                    </div>
                    <input type="range" min="0" max="2000" step="50" value={extraPayment} onChange={(e) => setExtraPayment(e.target.value)} className="w-full accent-emerald-400 mt-2" />
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-xs text-emerald-300/80 mb-2 flex items-center gap-1.5"><Target className="w-3 h-3" />Applied to highest-rate debt:</p>
                    <p className="font-bold text-white">{extraImpact.targetDebt}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-linear-to-br from-emerald-500/15 to-transparent border border-emerald-500/25">
                    <Sparkles className="w-5 h-5 text-emerald-400 mb-2" />
                    <p className="text-[10px] text-white/40 tracking-wider">MONTHS SAVED</p>
                    <p className="text-3xl font-display text-emerald-300 mt-1">{extraImpact.monthsSaved}</p>
                    <p className="text-[10px] text-white/40 mt-1">months off your debt</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-linear-to-br from-amber-500/15 to-transparent border border-amber-500/25">
                    <DollarSign className="w-5 h-5 text-amber-400 mb-2" />
                    <p className="text-[10px] text-white/40 tracking-wider">INTEREST SAVED</p>
                    <p className="text-3xl font-display text-amber-300 mt-1">${Math.round(extraImpact.interestSaved).toLocaleString()}</p>
                    <p className="text-[10px] text-white/40 mt-1">saved in interest</p>
                  </div>
                  <div className="col-span-2 p-4 rounded-2xl bg-white/3 border border-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-white/40 tracking-wider">NEW PAYOFF TIME</p>
                        <p className="text-xl font-bold text-white mt-1">{Math.ceil((extraImpact.newMonths || 0) / 12)} years {Math.round((extraImpact.newMonths || 0) % 12)} months</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-white/40 tracking-wider">WAS</p>
                        <p className="text-xl font-bold text-white/50 mt-1">{Math.ceil((extraImpact.originalMonths || 0) / 12)}y {Math.round((extraImpact.originalMonths || 0) % 12)}m</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Consolidation Calculator ── */}
          {calcTab === 'consolidate' && (
            <motion.div key="consolidate" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">TOTAL DEBT TO CONSOLIDATE</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-400 font-display text-xl">$</span>
                      <input type="number" value={consolidateAmount} onChange={(e) => setConsolidateAmount(e.target.value)}
                        className="w-full glass-input rounded-xl pl-9 pr-4 py-3 text-lg font-display text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">NEW INTEREST RATE (%)</label>
                    <input type="number" step="0.1" value={consolidateRate} onChange={(e) => setConsolidateRate(e.target.value)}
                      className="w-full glass-input rounded-xl px-4 py-3 text-lg font-display text-white"
                    />
                    <input type="range" min="2" max="15" step="0.1" value={consolidateRate} onChange={(e) => setConsolidateRate(e.target.value)} className="w-full accent-cyan-400 mt-2" />
                  </div>
                  <div className="p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300/80 flex items-start gap-2">
                    <Activity className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Consolidating all {activeDebts.length} active debts into one payment. Current weighted rate: <span className="font-bold text-cyan-200">{((activeDebts.reduce((sum, d) => sum + (d.remaining * d.rate), 0) / totalRemaining)).toFixed(2)}%</span></span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-linear-to-br from-emerald-500/15 to-transparent border border-emerald-500/25">
                    <TrendingUp className="w-5 h-5 text-emerald-400 mb-2" />
                    <p className="text-[10px] text-white/40 tracking-wider">MONTHLY SAVINGS</p>
                    <p className="text-3xl font-display text-emerald-300 mt-1">${Math.round(consolidationSavings.monthlySavings).toLocaleString()}</p>
                    <p className="text-[10px] text-white/40 mt-1">saved per month</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-linear-to-br from-amber-500/15 to-transparent border border-amber-500/25">
                    <Award className="w-5 h-5 text-amber-400 mb-2" />
                    <p className="text-[10px] text-white/40 tracking-wider">TOTAL SAVED</p>
                    <p className="text-3xl font-display text-amber-300 mt-1">${Math.round(consolidationSavings.totalInterestSavings).toLocaleString()}</p>
                    <p className="text-[10px] text-white/40 mt-1">over 7 years</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/3 border border-white/5">
                    <p className="text-[10px] text-white/40 tracking-wider">CURRENT PAYMENT</p>
                    <p className="text-lg font-bold text-white/60 mt-1">${Math.round(consolidationSavings.currentMonthly).toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/3 border border-white/5">
                    <p className="text-[10px] text-white/40 tracking-wider">NEW PAYMENT</p>
                    <p className="text-lg font-bold text-cyan-300 mt-1">${Math.round(consolidationSavings.newMonthly).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── DTI Calculator ── */}
          {calcTab === 'dti' && (
            <motion.div key="dti" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">MONTHLY INCOME (GROSS)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-display text-xl">$</span>
                      <input type="number" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value)}
                        className="w-full glass-input rounded-xl pl-9 pr-4 py-3 text-lg font-display text-white"
                      />
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/3 border border-white/5">
                    <p className="text-xs text-white/40 mb-3">DEBT BREAKDOWN</p>
                    {activeDebts.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/5 last:border-0">
                        <span className="text-white/60 flex items-center gap-2">{d.icon} {d.name}</span>
                        <span className="font-bold text-white">${d.monthly.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-white/10">
                      <span className="font-bold text-white/80">Total Debt</span>
                      <span className="font-bold text-amber-400">${totalMonthly.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center gap-4">
                  <div className="relative w-44 h-44">
                    <svg viewBox="0 0 120 120" className="w-44 h-44 -rotate-90">
                      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                      <motion.circle cx="60" cy="60" r="52" fill="none" stroke={dti.color} strokeWidth="12" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 52}`}
                        initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - Math.min(dti.ratio, 100) / 100) }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                        style={{ filter: `drop-shadow(0 0 8px ${dti.color})` }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-4xl text-white">{dti.ratio.toFixed(1)}%</span>
                      <span className="text-xs font-bold" style={{ color: dti.color }}>{dti.status}</span>
                    </div>
                  </div>
                  <div className="w-full space-y-1 text-xs">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500" /><span className="text-white/60">Under 28%: Excellent</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500" /><span className="text-white/60">28-36%: Good</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500" /><span className="text-white/60">Over 36%: Consider reducing debt</span></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Completed Debts ── */}
      {completedDebts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="glass rounded-3xl p-6">
          <h3 className="font-display text-lg text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Paid in Full
          </h3>
          {completedDebts.map((debt) => (
            <div key={debt.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/2 border border-emerald-500/20">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: `${debt.color}20` }}>
                {debt.icon}
              </div>
              <div className="flex-1">
                <p className="font-bold text-white text-sm">{debt.name}</p>
                <p className="text-xs text-emerald-400">Fully paid · ${debt.total.toLocaleString()}</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
          ))}
        </motion.div>
      )}

      {/* ── Apply Modal ── */}
      <AnimatePresence>
        {showApply && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowApply(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl glass-panel p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-linear-to-br from-blue-500/20 to-indigo-500/10 border border-blue-500/30 flex items-center justify-center">
                    {selectedOfferObj ? <span className="text-xl">{selectedOfferObj.icon}</span> : <Plus className="w-5 h-5 text-blue-300" />}
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">{selectedOfferObj?.name || 'Apply for Loan'}</h3>
                    <p className="text-xs text-white/40">Quick approval • Pre-qualified</p>
                  </div>
                </div>
                <button onClick={() => setShowApply(false)} className="rounded-xl p-2 glass-btn hover:bg-white/10">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              {selectedOfferObj && (
                <div className="p-4 rounded-2xl bg-linear-to-br from-blue-500/10 to-transparent border border-blue-500/20 mb-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-[9px] text-white/40 tracking-wider">UP TO</p><p className="text-lg font-bold text-white">${selectedOfferObj.maxAmount.toLocaleString()}</p></div>
                    <div><p className="text-[9px] text-white/40 tracking-wider">RATE FROM</p><p className="text-lg font-bold text-amber-400">{selectedOfferObj.rate}</p></div>
                    <div><p className="text-[9px] text-white/40 tracking-wider">TERM</p><p className="text-lg font-bold text-white">{selectedOfferObj.term}</p></div>
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4 flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Pre-approved up to <span className="font-bold text-white">$75,000</span> based on your credit
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">LOAN AMOUNT</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400 font-display text-lg">$</span>
                      <input type="number" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)}
                        className="w-full glass-input rounded-xl pl-7 pr-3 py-2.5 text-sm text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">TERM</label>
                    <select value={loanTerm} onChange={(e) => setLoanTerm(e.target.value)}
                      className="w-full glass-input rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer"
                    >
                      {[1, 2, 3, 5, 7, 10, 15, 20].map(y => (
                        <option key={y} value={y} className="bg-[#0d0d14]">{y} {y === 1 ? 'year' : 'years'}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {amount > 0 && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div><p className="text-[9px] text-white/40 tracking-wider">MONTHLY</p><p className="text-base font-bold text-amber-300">${monthlyPayment.toFixed(0)}</p></div>
                      <div><p className="text-[9px] text-white/40 tracking-wider">INTEREST</p><p className="text-base font-bold text-rose-300">${Math.round(totalInterest).toLocaleString()}</p></div>
                      <div><p className="text-[9px] text-white/40 tracking-wider">TOTAL</p><p className="text-base font-bold text-white">${Math.round(totalPayment).toLocaleString()}</p></div>
                    </div>
                  </div>
                )}

                <input placeholder="Full name" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Email" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />
                  <input placeholder="Phone" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />
                </div>
                <input placeholder="Annual income" type="number" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />
                <input placeholder="Employer / Purpose of loan" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />

                <div className="flex gap-2 pt-2">
                  <button onClick={() => setShowApply(false)} className="flex-1 py-3 rounded-xl glass-btn text-sm font-bold text-white/70">Cancel</button>
                  <button onClick={() => setShowApply(false)}
                    className="flex-1 py-3 rounded-xl bg-linear-to-r from-blue-400 to-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 glow-blue"
                  >
                    Submit <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
