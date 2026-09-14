import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, Loader2, CheckCircle2, Wallet, TrendingUp, Gauge,
  Zap, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import { refreshBus } from '../refreshBus';

interface CreditLedgerEntry {
  kind: string;
  amount: number;
  balance_owed_after: number;
  description: string | null;
  created_at: string;
}

interface CreditStatus {
  exists: boolean;
  creditLimit?: number;
  balanceOwed?: number;
  availableCredit?: number;
  apr?: number;
  creditScore?: number;
  autopay?: boolean;
  minimumPayment?: number;
  ledger?: CreditLedgerEntry[];
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, (score - 300) / 550));
  const r = 52, c = 2 * Math.PI * r;
  const color = score >= 740 ? '#34d399' : score >= 670 ? '#22d3ee' : score >= 580 ? '#fbbf24' : '#fb7185';
  return (
    <div className="relative w-32 h-32">
      <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <motion.circle
          cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl text-white">{score}</span>
        <span className="text-[9px] tracking-widest text-white/40 font-bold">VB SCORE</span>
      </div>
    </div>
  );
}

export default function CreditSection() {
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [repayAmount, setRepayAmount] = useState('');
  const [repaying, setRepaying] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getCreditStatus();
      setStatus(r.success ? (r as unknown as CreditStatus) : { exists: false });
    } catch {
      setStatus({ exists: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApply = async () => {
    setApplying(true);
    setMsg(null);
    try {
      const r = await api.applyCredit();
      if (r.success) {
        setMsg({ type: 'success', text: (r.message as string) || 'Approved!' });
        refreshBus.emit();
        await load();
      } else {
        setMsg({ type: 'error', text: r.message || 'Application failed.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Could not reach the server.' });
    } finally {
      setApplying(false);
    }
  };

  const handleRepay = async () => {
    const amt = parseFloat(repayAmount);
    if (!(amt > 0)) { setMsg({ type: 'error', text: 'Enter an amount to repay.' }); return; }
    setRepaying(true);
    setMsg(null);
    try {
      const r = await api.repayCredit({ amount: amt });
      if (r.success) {
        setMsg({ type: 'success', text: 'Payment applied — ' + fmt(r.paid as number) + ' paid down.' });
        setRepayAmount('');
        refreshBus.emit();
        await load();
      } else {
        setMsg({ type: 'error', text: r.message || 'Payment failed.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Could not reach the server.' });
    } finally {
      setRepaying(false);
    }
  };

  const handleAutopayToggle = async () => {
    if (!status?.exists) return;
    const next = !status.autopay;
    setStatus({ ...status, autopay: next });
    await api.toggleCreditAutopay(next).catch(() => {});
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white/30" />
      </div>
    );
  }

  const hasCard = !!status?.exists;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-10">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <p className="text-xs tracking-widest text-white/40 font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" /> VAULTBANK CREDIT ENGINE
        </p>
        <p className="font-display text-4xl lg:text-5xl text-white mt-2">
          Real Credit<span className="text-amber-400">.</span>
        </p>
        <p className="text-sm text-white/40 mt-2">
          Approved in seconds from your real VaultBank activity. Cards spend cash first, credit second — automatically.
        </p>
      </motion.div>

      {msg && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className={`mb-5 rounded-2xl px-4 py-3 text-sm font-semibold border ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          {msg.text}
        </motion.div>
      )}

      {!hasCard ? (
        /* ── APPLY — instant decision ── */
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-panel rounded-3xl p-8 text-center"
        >
          <div className="w-16 h-16 mx-auto rounded-2xl bg-linear-to-br from-amber-400 to-yellow-500 flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-amber-950" />
          </div>
          <h3 className="font-display text-2xl text-white">Get your credit line in seconds</h3>
          <p className="text-sm text-white/40 mt-2 max-w-md mx-auto">
            No paperwork. No bureau pulls. We underwrite from your real deposits, balance and money movement — instantly.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mt-6 mb-7">
            {[
              { icon: Gauge, label: 'Instant decision' },
              { icon: ShieldCheck, label: 'VaultBank Score' },
              { icon: Zap, label: 'Cards spend on credit' },
            ].map((f) => (
              <div key={f.label} className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <f.icon className="w-5 h-5 text-amber-300 mx-auto mb-2" />
                <p className="text-[11px] text-white/60 font-semibold">{f.label}</p>
              </div>
            ))}
          </div>
          <button
            onClick={handleApply}
            disabled={applying}
            className="px-8 py-3.5 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold shadow-lg glow-amber disabled:opacity-50"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply now — instant decision'}
          </button>
        </motion.div>
      ) : (
      <>

          {/* ── DASHBOARD ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="glass-panel rounded-3xl p-6 mb-5"
          >
            <div className="flex flex-col md:flex-row items-center gap-8">
              <ScoreRing score={status!.creditScore || 0} />
              <div className="flex-1 w-full">
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-xs tracking-widest text-white/40 font-bold">AVAILABLE CREDIT</p>
                  <p className="text-[11px] text-white/40">{status!.apr}% APR variable</p>
                </div>
                <p className="font-display text-5xl text-white mb-3">{fmt(status!.availableCredit || 0)}</p>
                <div className="h-2.5 rounded-full bg-white/10 overflow-hidden mb-1">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, ((status!.balanceOwed || 0) / Math.max(1, status!.creditLimit || 1)) * 100)}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className="h-full rounded-full bg-linear-to-r from-amber-400 to-yellow-500"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-white/40">
                  <span>Owed {fmt(status!.balanceOwed || 0)}</span>
                  <span>Limit {fmt(status!.creditLimit || 0)}</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── REPAY + AUTOPAY ── */}
          <div className="grid md:grid-cols-2 gap-5 mb-5">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-panel rounded-3xl p-6">
              <h3 className="font-display text-lg text-white mb-1 flex items-center gap-2"><Wallet className="w-4 h-4 text-emerald-300" /> Pay it down</h3>
              <p className="text-xs text-white/40 mb-4">Pays straight from your VaultBank balance.</p>
              <div className="flex gap-2">
                <input
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm outline-none focus:border-amber-400/50"
                />
                <button
                  onClick={handleRepay}
                  disabled={repaying || (status!.balanceOwed || 0) <= 0}
                  className="px-5 py-3 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-bold text-sm disabled:opacity-40"
                >
                  {repaying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Repay'}
                </button>
              </div>
              {(status!.minimumPayment || 0) > 0 && (
                <button
                  onClick={() => setRepayAmount(String(status!.minimumPayment!.toFixed(2)))}
                  className="mt-3 text-[11px] text-amber-300 font-semibold hover:underline"
                >
                  Pay minimum {fmt(status!.minimumPayment!)}
                </button>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-3xl p-6">
              <h3 className="font-display text-lg text-white mb-1 flex items-center gap-2"><RefreshCw className="w-4 h-4 text-sky-300" /> Autopay</h3>
              <p className="text-xs text-white/40 mb-4">Minimum payment taken automatically. Interest accrues daily.</p>
              <button
                onClick={handleAutopayToggle}
                className={`relative w-14 h-8 rounded-full transition-colors ${status!.autopay ? 'bg-emerald-500/60' : 'bg-white/10'}`}
                aria-label="Toggle autopay"
              >
                <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${status!.autopay ? 'left-7' : 'left-1'}`} />
              </button>
              <p className="text-[11px] text-white/40 mt-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
                {status!.autopay ? 'On — never miss a payment' : 'Off — pay manually'}
              </p>
            </motion.div>
          </div>

          {/* ── LEDGER ── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="glass-panel rounded-3xl p-6">
            <p className="text-[10px] tracking-widest text-white/40 font-bold mb-4">CREDIT ACTIVITY</p>
            {(status!.ledger || []).length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300" /> No credit activity yet — your cards will draw credit automatically when cash runs short.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {(status!.ledger || []).map((e, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                    <div>
                      <p className="text-xs text-white font-semibold capitalize">{e.kind} · {e.description || ''}</p>
                      <p className="text-[10px] text-white/30">{new Date(e.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold font-mono ${e.kind === 'repayment' ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {e.kind === 'repayment' ? '−' : '+'}{fmt(e.amount)}
                      </p>
                      <p className="text-[10px] text-white/30">owed {fmt(e.balance_owed_after)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}

