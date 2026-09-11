import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Snowflake, Unlock, Lock, CreditCard, X, Loader2,
  ShieldCheck, Eye, Sparkles, AlertTriangle, CheckCircle2, TrendingUp,
} from 'lucide-react';
import { api } from '../api';
import { refreshBus } from '../refreshBus';

const STRIPE_JS_API_VERSION = '2024-06-20';
// Stripe.js loads from the CDN at runtime so builds never depend on the npm
// package being installed (fixes Vercel builds with stale node_modules caches).
declare global {
  interface Window {
    Stripe?: (key: string, opts?: any) => any;
  }
}

function loadStripeCdn(publishableKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe(publishableKey));
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3';
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe(publishableKey)) : reject(new Error('Stripe.js failed to initialize.')));
    s.onerror = () => reject(new Error('Failed to load Stripe.js from CDN.'));
    document.head.appendChild(s);
  });
}

interface RealCard {
  id: string;
  network: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  status: string;
  frozen: boolean;
  brandLabel: string;
  monthlyLimit: number;
  perTransactionLimit: number;
  cardholder: string;
  createdAt?: string;
}

interface DemoCard {
  id: number;
  type: string;
  network: string;
  last4: string;
  balance: number;
  limit: number;
  color: string;
  accent: string;
  expiry: string;
  holder: string;
  locked?: boolean;
}

interface CardActivity {
  id: string;
  amount: number;
  description: string;
  category: string;
  status: string;
  date: string;
}

interface Props {
  cards: DemoCard[];
  onLockCard: (id: number) => void;
  formatMoney: (amount: number) => string;
}

interface IssuingStatus {
  available: boolean;
  mode: string;
  cardholder: string | null;
  publishableKey: string | null;
  reason?: string;
}

const networkVisual: Record<string, { gradient: string; label: string }> = {
  visa: { gradient: 'from-blue-600/30 via-indigo-600/20 to-blue-900/40', label: 'VISA' },
  mastercard: { gradient: 'from-orange-600/25 via-red-600/15 to-stone-800/40', label: 'MASTERCARD' },
};

export default function IssuingCardsSection({ cards: demoCards, onLockCard, formatMoney }: Props) {
  const [status, setStatus] = useState<IssuingStatus | null>(null);
  const [realCards, setRealCards] = useState<RealCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showIssue, setShowIssue] = useState(false);
  const [issueNetwork, setIssueNetwork] = useState<'visa' | 'mastercard'>('visa');
  const [issueMonthly, setIssueMonthly] = useState('2000');
  const [issuePerTx, setIssuePerTx] = useState('500');
  const [selected, setSelected] = useState<RealCard | null>(null);
  const [activity, setActivity] = useState<CardActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [revealedCard, setRevealedCard] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef<any>(null);

  const loadCards = useCallback(async () => {
    try {
      const res = await api.getIssuingCards();
      if (res.success && Array.isArray(res.cards)) setRealCards(res.cards);
    } catch { /* keep current */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await api.getIssuingStatus();
        if (!cancelled) setStatus({
          available: !!st.available,
          mode: st.mode || 'none',
          cardholder: st.cardholder || null,
          publishableKey: st.publishableKey || null,
          reason: st.reason,
        });
      } catch {
        if (!cancelled) setStatus({ available: false, mode: 'none', cardholder: null, publishableKey: null, reason: 'unreachable' });
      }
      if (!cancelled) setLoading(false);
      if (!cancelled) loadCards();
    })();
    return () => { cancelled = true; };
  }, [loadCards]);

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleIssue = async () => {
    setBusy(true);
    try {
      if (!status?.cardholder) {
        const ch = await api.createCardholder({});
        if (!ch.success) throw new Error(ch.message || 'Cardholder enrollment failed.');
      }
      const res = await api.issueCard({
        network: issueNetwork,
        monthlyLimit: parseFloat(issueMonthly) || 2000,
        perTransactionLimit: parseFloat(issuePerTx) || 500,
      });
      if (!res.success) throw new Error(res.message || 'Could not issue card.');
      flash('success', (res.card?.brandLabel || 'Card') + ' •• ' + (res.card?.last4 || '') + ' is live. Real number ready to use.');
      setShowIssue(false);
      await loadCards();
      refreshBus.emit();
    } catch (err: any) {
      flash('error', err?.message || 'Issue failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleFreeze = async (card: RealCard) => {
    setBusy(true);
    try {
      const res = await api.freezeIssuingCard(card.id, !card.frozen);
      if (!res.success) throw new Error(res.message || 'Failed.');
      flash('success', res.message || 'Updated.');
      await loadCards();
    } catch (err: any) {
      flash('error', err?.message || 'Failed.');
    } finally {
      setBusy(false);
    }
  };

  const openDetails = async (card: RealCard) => {
    setSelected(card);
    setActivity([]);
    setRevealedCard(null);
    setRevealError(null);
    setActivityLoading(true);
    try {
      const res = await api.getIssuingCardActivity(card.id);
      if (res.success && Array.isArray(res.transactions)) setActivity(res.transactions);
    } catch { /* empty */ }
    finally { setActivityLoading(false); }
  };

  const revealCard = async (card: RealCard) => {
    if (!status?.publishableKey) {
      setRevealError('Secure reveal needs the Stripe publishable key on the server (STRIPE_PUBLISHABLE_KEY).');
      return;
    }
    setRevealLoading(true);
    setRevealError(null);
    try {
      const keyRes = await api.getCardEphemeralKey(card.id, STRIPE_JS_API_VERSION);
      if (!keyRes.success) throw new Error(keyRes.message || 'Ephemeral key failed.');
      const stripe = await loadStripeCdn(status.publishableKey);
      await new Promise(r => setTimeout(r, 50));
      if (!revealRef.current) throw new Error('Mount point missing.');
      if (elementsRef.current) { try { elementsRef.current.destroy?.(); } catch { /* noop */ } }
      const elements = stripe.elements({ locale: 'en' });
      elementsRef.current = elements;
      const cardEl = elements.create('issuingCard' as any, {
        issuingCard: card.id,
        ephemeralKeySecret: keyRes.clientSecret,
        mutable: true,
      } as any);
      cardEl.mount(revealRef.current);
      setRevealedCard(card.id);
    } catch (err: any) {
      setRevealError(err?.message || 'Could not reveal card.');
    } finally {
      setRevealLoading(false);
    }
  };

  const fmtExp = (c: RealCard) => {
    if (!c.expMonth || !c.expYear) return '—/--';
    return String(c.expMonth).padStart(2, '0') + '/' + String(c.expYear).slice(-2);
  };

  return (
    <div className="space-y-5">
      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="w-5 h-5 text-amber-300" />
              <p className="text-xs tracking-[0.3em] text-white/40 font-bold">REAL CARDS · STRIPE ISSUING</p>
              {status?.available && (
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${status.mode === 'live' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/15 border-amber-500/30 text-amber-300'}`}>
                  {status.mode === 'live' ? '● ISSUING LIVE' : '● ISSUING TEST'}
                </span>
              )}
            </div>
            <p className="font-display text-3xl lg:text-4xl text-white">Cards that spend real money</p>
            <p className="text-sm text-white/40 mt-1.5 max-w-xl">
              Issue a virtual Visa or Mastercard with a real number — pay for Netflix, Spotify or anything online.
              Your VaultBank balance backs every purchase in real time.
            </p>
          </div>
          {status?.available && (
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => setShowIssue(true)}
              className="px-5 py-3 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm flex items-center gap-2 glow-amber"
            >
              <Plus className="w-4 h-4" /> New real card
            </motion.button>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {msg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`flex items-center gap-2 p-3 rounded-2xl text-sm font-semibold border ${msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-300'}`}>
            {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="flex items-center justify-center py-10 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
      )}

      {/* Issuing not available banner */}
      {!loading && !status?.available && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-3xl p-5 border border-amber-500/20">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Real card issuing is not enabled yet</p>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">
                Activate <span className="text-amber-300 font-semibold">Stripe Issuing</span> in the Stripe Dashboard to mint real spendable cards.
                Until then, below are preview cards. Everything else (deposits, transfers) is already real money.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* REAL cards grid */}
      {!loading && status?.available && realCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {realCards.map((card, i) => {
            const v = networkVisual[card.network] || networkVisual.visa;
            return (
              <motion.div key={card.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                whileHover={{ y: -4 }}
                onClick={() => openDetails(card)}
                className={`relative rounded-3xl overflow-hidden cursor-pointer bg-linear-to-br ${v.gradient} border border-white/10`}>
                <div className="absolute inset-0 glass opacity-40" />
                <div className="relative z-10 p-5">
                  <div className="flex items-start justify-between mb-8">
                    <div>
                      <p className="text-[10px] tracking-widest text-white/60 font-bold">{card.brandLabel.toUpperCase()}</p>
                      <p className="text-[9px] text-white/30">VIRTUAL · INSTANT</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-[9px] font-bold border ${card.frozen ? 'bg-sky-500/15 border-sky-500/30 text-sky-300' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'}`}>
                      {card.frozen ? '❄ FROZEN' : '● ACTIVE'}
                    </span>
                  </div>
                  <p className="font-mono text-xl text-white tracking-wider">•••• •••• •••• {card.last4}</p>
                  <div className="flex items-end justify-between mt-6">
                    <div>
                      <p className="text-[9px] text-white/40">VALID THRU</p>
                      <p className="font-mono text-sm text-white">{fmtExp(card)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] text-white/40">MONTHLY LIMIT</p>
                      <p className="font-mono text-sm text-white">{formatMoney(card.monthlyLimit)}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {!loading && status?.available && realCards.length === 0 && (
        <div className="glass-panel rounded-3xl p-8 text-center">
          <Sparkles className="w-8 h-8 text-amber-300 mx-auto mb-3" />
          <p className="text-white font-bold">No real cards yet</p>
          <p className="text-xs text-white/40 mt-1">Issue your first virtual card — it takes about 3 seconds and works immediately.</p>
        </div>
      )}

      {/* Legacy preview cards (when issuing unavailable) */}
      {!loading && !status?.available && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {demoCards.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="relative rounded-2xl overflow-hidden border border-white/10 bg-linear-to-br from-white/5 to-white/0 p-4">
              <div className="flex items-center justify-between mb-6">
                <p className="text-[10px] tracking-widest text-white/50 font-bold">{c.type.toUpperCase()}</p>
                <span className="text-[9px] text-white/30 border border-white/10 rounded-full px-2 py-0.5">PREVIEW</span>
              </div>
              <p className="font-mono text-white tracking-wider">•••• {c.last4}</p>
              <div className="flex items-center justify-between mt-4">
                <p className="text-[10px] text-white/40">{c.network}</p>
                <button onClick={() => onLockCard(c.id)}
                  className={`flex items-center gap-1 text-[10px] font-bold ${c.locked ? 'text-sky-300' : 'text-rose-300'}`}>
                  {c.locked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  {c.locked ? 'Unfreeze' : 'Freeze'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Issue modal */}
      <AnimatePresence>
        {showIssue && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !busy && setShowIssue(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl">
            <motion.div initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">Issue a real card</h3>
                    <p className="text-xs text-white/40">Real number · works online instantly</p>
                  </div>
                </div>
                <button onClick={() => setShowIssue(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <p className="text-[10px] tracking-widest text-white/40 font-bold mb-2">NETWORK</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {(['visa', 'mastercard'] as const).map(n => (
                  <button key={n} onClick={() => setIssueNetwork(n)}
                    className={`py-3 rounded-xl text-sm font-bold border transition-all ${issueNetwork === n ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-white/3 border-white/10 text-white/50'}`}>
                    {n === 'visa' ? 'VISA' : 'MASTERCARD'}
                  </button>
                ))}
              </div>

              <p className="text-[10px] tracking-widest text-white/40 font-bold mb-2">SPEND CONTROLS (network-enforced)</p>
              <div className="grid grid-cols-2 gap-2 mb-5">
                <div>
                  <label className="text-[10px] text-white/40">Monthly limit</label>
                  <input value={issueMonthly} onChange={(e) => setIssueMonthly(e.target.value)} type="number" min="0"
                    className="w-full glass-input rounded-xl px-3 py-2.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-white/40">Per purchase</label>
                  <input value={issuePerTx} onChange={(e) => setIssuePerTx(e.target.value)} type="number" min="0"
                    className="w-full glass-input rounded-xl px-3 py-2.5 text-sm text-white" />
                </div>
              </div>

              <button onClick={handleIssue} disabled={busy}
                className="w-full py-3.5 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {busy ? 'Issuing real card…' : 'Issue card'}
              </button>
              {status?.mode === 'test' && <p className="text-[10px] text-amber-300/70 text-center mt-3">Issuing test mode — activate Issuing live in Stripe to spend real funds.</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Details drawer */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setSelected(null); setRevealedCard(null); }}
            className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-xl overflow-y-auto">
            <motion.div initial={{ scale: 0.96, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-lg mx-auto mt-10 rounded-3xl glass-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display text-xl text-white">{selected.brandLabel}</h3>
                  <p className="font-mono text-xs text-white/40">•••• {selected.last4} · exp {fmtExp(selected)}</p>
                </div>
                <button onClick={() => { setSelected(null); setRevealedCard(null); }} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <div className="flex gap-2 mb-4">
                <button onClick={() => handleFreeze(selected)} disabled={busy}
                  className={`flex-1 py-2.5 rounded-xl glass-btn text-xs font-bold flex items-center justify-center gap-2 ${selected.frozen ? 'text-emerald-300' : 'text-sky-300'}`}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : selected.frozen ? <Unlock className="w-3.5 h-3.5" /> : <Snowflake className="w-3.5 h-3.5" />}
                  {selected.frozen ? 'Unfreeze card' : 'Freeze card'}
                </button>
                <button onClick={() => revealCard(selected)} disabled={revealLoading}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center justify-center gap-2">
                  {revealLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                  Reveal details
                </button>
              </div>

              {revealError && <p className="text-[11px] text-rose-300 mb-3">{revealError}</p>}

              {revealedCard === selected.id && (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-4">
                  <p className="text-[10px] text-white/40 mb-2 flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-emerald-300" /> Shown in Stripe's secure vault — copy from here</p>
                  <div ref={revealRef} />
                </div>
              )}

              <div className="flex items-center gap-2 mb-2 mt-2">
                <TrendingUp className="w-4 h-4 text-white/40" />
                <p className="text-[10px] tracking-widest text-white/40 font-bold">CARD ACTIVITY</p>
              </div>
              {activityLoading ? (
                <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
              ) : activity.length === 0 ? (
                <p className="text-xs text-white/30 py-4 text-center">No purchases yet. Use the card number at any online checkout — charges appear here live.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {activity.map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                      <div>
                        <p className="text-xs text-white font-semibold truncate max-w-56">{t.description}</p>
                        <p className="text-[10px] text-white/30">{new Date(t.date).toLocaleString()}</p>
                      </div>
                      <p className={`text-sm font-bold font-mono ${t.amount < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{formatMoney(t.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
