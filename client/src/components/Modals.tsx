import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Plus, Receipt, ArrowRightLeft, Globe, Smartphone, CheckCircle2, Loader2, TrendingUp, UserSearch, CreditCard, Zap, Banknote, Building2 } from 'lucide-react';
import RichIcon from './RichIcon';
import Avatar from './Avatar';
import { api } from '../api';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TransferModalProps extends ModalProps {
  onSend: (recipient: string, amount: number, note?: string, recipientName?: string) => Promise<void>;
}

/** A real registered VaultBank user (from the backend directory). */
interface Recipient {
  id?: string;
  name: string;
  email?: string;
  accountNumber?: string | null;
}

/** Best identifier to send money to: account number > email. */
const recipientValue = (r: Recipient): string => r.accountNumber || r.email || r.name;

export function TransferModal({ isOpen, onClose, onSend }: TransferModalProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [results, setResults] = useState<Recipient[]>([]);
  const [recent, setRecent] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastSent, setLastSent] = useState<{ name: string; amount: number } | null>(null);

  // REAL recent recipients — derived from the user's actual transfer history
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getTransfers();
        if (cancelled || !res.success || !Array.isArray(res.transfers)) return;
        const recents: Recipient[] = [];
        const seen = new Set<string>();
        for (const t of res.transfers) {
          const name = t.to_user_name || t.toUserName;
          const email = t.to_user_email || t.toUserEmail;
          if (name && !seen.has(name)) {
            seen.add(name);
            recents.push({ id: t.to_user_id, name, email });
          }
        }
        setRecent(recents.slice(0, 6));
      } catch { /* history is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // LIVE search over REAL registered VaultBank users (debounced)
  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchUsers(q);
        setResults(res.success && Array.isArray(res.users) ? res.users : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selected]);

  const pick = (r: Recipient) => {
    setSelected(r);
    setQuery('');
    setResults([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipient = selected ? recipientValue(selected) : query.trim();
    if (!recipient || !amount) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const amountNum = parseFloat(amount);
      const sentTo = selected?.name || recipient;
      await onSend(recipient, amountNum, note, sentTo);
      setStatus('success');
      setLastSent({ name: sentTo, amount: amountNum });
      setTimeout(() => {
        setStatus('idle');
        setSelected(null);
        setQuery('');
        setAmount('');
        setNote('');
        setLastSent(null);
        onClose();
      }, 2200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Transfer failed. Please try again.');
      setStatus('error');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={Send} title="Send Money" subtitle="REAL INSTANT TRANSFER">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">RECIPIENT — REAL VAULTBANK USERS</label>

          {selected ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/30">
              <Avatar name={selected.name} size="sm" ring={false} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-semibold truncate">{selected.name}</p>
                <p className="text-[10px] text-white/40 truncate">{selected.accountNumber || selected.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10"
              >
                <X className="w-3.5 h-3.5 text-white/60" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <UserSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  id="send-recipient"
                  name="recipient"
                  aria-label="Search recipient by name, email or account number"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, email or account number…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3.5 pl-10 text-sm text-white focus:outline-none focus:border-amber-500/40 transition-colors"
                />
                {searching && (
                  <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400 animate-spin" />
                )}
              </div>

              {/* Live results — real registered users only */}
              {results.length > 0 && (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                  {results.map((r) => (
                    <button
                      key={r.id || r.email || r.name}
                      type="button"
                      onClick={() => pick(r)}
                      className="w-full flex items-center gap-3 p-2.5 hover:bg-white/5 transition-colors text-left"
                    >
                      <Avatar name={r.name} size="xs" ring={false} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{r.name}</p>
                        <p className="text-[10px] text-white/40 truncate">{r.email}{r.accountNumber ? ` · ${r.accountNumber}` : ''}</p>
                      </div>
                      <Send className="w-3 h-3 text-amber-400/60" />
                    </button>
                  ))}
                </div>
              )}

              {query.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="mt-2 text-[10px] text-white/30 px-1">
                  No matching user yet — you can also paste a full email address or account number (VB-…).
                </p>
              )}
            </>
          )}
        </div>

        {/* REAL recent recipients from actual transfer history */}
        {recent.length > 0 && !selected && (
          <div>
            <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">RECENT — YOUR REAL TRANSFERS</label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {recent.map((c, i) => (
                <button
                  key={c.id || c.email || i}
                  type="button"
                  onClick={() => pick(c)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:border-amber-500/30 transition-colors flex-shrink-0"
                >
                  <Avatar name={c.name} size="xs" ring={false} />
                  <span className="text-xs text-white/70">{c.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="send-amount" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400 font-display text-2xl">$</span>
            <input
              id="send-amount"
              name="amount"
              aria-label="Send amount in dollars"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 pl-10 text-2xl font-display text-white focus:outline-none focus:border-amber-500/40 transition-colors"
            />
          </div>
        </div>
        <div>
          <label htmlFor="send-note" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">NOTE (OPTIONAL)</label>
          <input
            id="send-note"
            name="note"
            aria-label="Transfer note (optional)"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's it for?"
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3.5 text-sm text-white focus:outline-none focus:border-amber-500/40 transition-colors"
          />
        </div>

        {status === 'error' && (
          <p className="text-xs text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
            {errorMsg}
          </p>
        )}

        {status === 'success' && lastSent && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"
          >
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 0.9, ease: 'easeInOut' }}
              className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-emerald-400/20 to-transparent"
            />
            <div className="relative flex items-center gap-3">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
                className="w-10 h-10 rounded-full bg-emerald-500/25 border border-emerald-400/40 flex items-center justify-center shrink-0"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-300" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-emerald-200">
                  ${(lastSent.amount).toFixed(2)} sent to {lastSent.name}
                </p>
                <p className="text-[10px] text-emerald-400/70 mt-0.5 tracking-wide">
                  REAL MONEY · INSTANT · SETTLED
                </p>
              </div>
              <motion.div
                animate={{ scale: [1, 1.25, 1] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
              />
            </div>
          </motion.div>
        )}

        <SubmitButton status={status} idleText="Confirm Real Transfer" />
      </form>
    </BaseModal>
  );
}

export function DepositModal({ isOpen, onClose }: ModalProps) {
  const [mode, setMode] = useState<'inr' | 'bank' | 'card' | 'instant' | 'paypal' | 'usdc'>('inr');
  const [usdc, setUsdc] = useState<{ address: string; network: string; qr: string | null } | null>(null);
  const [usdcTestnet, setUsdcTestnet] = useState(false);
  const [usdcChecking, setUsdcChecking] = useState(false);
  const [cryptoToken, setCryptoToken] = useState<'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [inrReadiness, setInrReadiness] = useState<any>(null);
  const [inrDetails, setInrDetails] = useState<any>(null);
  const [bankCfg, setBankCfg] = useState<any>(null);
  const [bankInstr, setBankInstr] = useState<any>(null);

  // Bank-transfer rail: real instructions appear ONLY when a verified
  // receiving account is configured server-side.
  useEffect(() => {
    if (!isOpen || mode !== 'bank' || bankCfg) return;
    api.bankDepositConfig()
      .then((r) => setBankCfg(r.success ? r : { enabled: false }))
      .catch(() => setBankCfg({ enabled: false }));
  }, [isOpen, mode, bankCfg]);

  // INR readiness is read from the server; environment variables alone do not mean settlement is live.
  useEffect(() => {
    if (!isOpen || mode !== 'inr') return;
    let cancelled = false;
    api.paymentsReadiness()
      .then((r) => { if (!cancelled) setInrReadiness(r?.rails?.inr || null); })
      .catch(() => { if (!cancelled) setInrReadiness(null); });
    return () => { cancelled = true; };
  }, [isOpen, mode]);

  // Fetch your personal USDC address when the USDC rail opens (no signup needed).
  useEffect(() => {
    if (!isOpen || mode !== 'usdc' || usdc) return;
    api.usdcAddress()
      .then((r) => {
        if (r.success && r.address) {
          setUsdc({ address: r.address, network: r.network || 'base', qr: r.qr || null });
          setUsdcTestnet(!!(r as Record<string, unknown>).testnet);
        }
        else throw new Error(r.message || 'USDC deposits are not enabled yet.');
      })
      .catch((err: any) => { setErrorMsg(err?.message || 'USDC deposits are not enabled yet.'); setStatus('error'); });
  }, [isOpen, mode, usdc]);

  const checkUsdc = async () => {
    setUsdcChecking(true);
    setErrorMsg('');
    try {
      const r = await api.usdcCheck();
      if (!r.success) throw new Error(r.message || 'Scan failed.');
      const n = (r.credited || []).length;
      if (n > 0) {
        setStatus('success');
        setTimeout(() => { setStatus('idle'); onClose(); }, 1600);
      } else {
        setErrorMsg(`No confirmed ${cryptoToken} yet — wait for 12 network confirmations, then check again.`);
        setStatus('error');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Scan failed.');
      setStatus('error');
    } finally {
      setUsdcChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'usdc') return; // USDC flow uses the address panel + check button.
    if (mode === 'inr') {
      setStatus('loading');
      setErrorMsg('');
      try {
        let readiness = inrReadiness;
        if (!readiness) {
          const r = await api.paymentsReadiness();
          readiness = r?.rails?.inr || null;
          setInrReadiness(readiness);
        }
        if (!readiness?.collections || readiness.collectionsMode !== 'live') {
          const reason = readiness?.collectionsReason || 'readiness-unavailable';
          throw new Error(`Cashfree INR receiving is not live-ready yet (${reason}). Do not send funds until VaultBank displays provider-issued bank details.`);
        }
        try {
          await api.getInrAccount();
        } catch (accountError: any) {
          if (accountError?.status !== 404) throw accountError;
          try {
            await api.openInrAccount();
          } catch (openError: any) {
            if (openError?.status !== 409) throw openError;
            await api.getInrAccount();
          }
        }
        const result = await api.collectionsMyDetails();
        if (!result?.success || !result?.details?.accountNumber || !result?.details?.ifsc) {
          throw new Error(result?.message || 'Cashfree did not return an active receiving account.');
        }
        setInrDetails(result);
        setStatus('success');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Could not load Cashfree INR receiving details.');
        setStatus('error');
      }
      return;
    }
    if (mode === 'bank') {
      if (bankInstr) return; // Instructions already issued — use the panel.
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) return;
      setStatus('loading');
      setErrorMsg('');
      try {
        const res = await api.createBankDepositInstruction({ amount: amt });
        if (!res.success || !res.instruction) throw new Error(res.message || 'Could not create the deposit instruction.');
        setBankInstr(res);
        setStatus('success');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Could not create the deposit instruction.');
        setStatus('error');
      }
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      if (mode === 'card') {
        // REAL money in — Stripe Checkout (card payment processed by Stripe)
        const res = await api.stripeDeposit({ amount: amt });
        if (res.success && res.checkoutUrl) {
          window.location.href = res.checkoutUrl;
          return;
        }
        throw new Error(res.message || 'Could not start Stripe checkout.');
      }
      if (mode === 'paypal') {
        // REAL money in — PayPal Checkout (approved on paypal.com, captured on return)
        const res = await api.paypalDeposit({ amount: amt });
        if (res.success && res.approvalUrl) {
          window.location.href = res.approvalUrl;
          return;
        }
        throw new Error(res.message || 'PayPal deposits are not enabled yet.');
      }
      // Instant internal deposit — real backend balance update
      const res = await api.accountDeposit({ amount: amt, description: 'Instant deposit' });
      if (!res.success) throw new Error(res.message || 'Deposit failed.');
      setStatus('success');
      setTimeout(() => { setStatus('idle'); setAmount(''); onClose(); }, 1600);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Deposit failed.');
      setStatus('error');
    }
  };

  // Bank mode shows the configured receiving currency; all USD rails keep "$".
  const amountPrefix = mode === 'bank' && bankCfg && bankCfg.currency ? bankCfg.currency : '$';

  const amountFields = (
    <>
      <div>
        <label htmlFor="deposit-amount" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400 font-display text-2xl">{amountPrefix}</span>
          <input
            id="deposit-amount"
            name="amount"
            aria-label="Deposit amount in dollars"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 pl-10 text-2xl font-display text-white focus:outline-none focus:border-emerald-500/40 transition-colors"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['100', '500', '1000', '2500', '5000', '10000'].map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(v)}
            className="py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/60 hover:text-white hover:border-emerald-500/30 transition-colors"
          >
            ${amountPrefix}{v}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={Plus} title="Deposit Funds" subtitle="REAL MONEY IN">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* LIVE / SANDBOX badge */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40 tracking-wider font-semibold">PAYMENT RAIL</span>
          {mode === 'inr' && (
            <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold border ${
              inrReadiness?.collections && inrReadiness?.collectionsMode === 'live'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
            }`}>
              {inrReadiness?.collections && inrReadiness?.collectionsMode === 'live'
                ? '● LIVE RAIL CONFIGURED · SETTLEMENT UNVERIFIED'
                : '○ INR RECEIVING NOT READY'}
            </span>
          )}
        </div>

        {/* Only the supported fiat receive choices are shown. Card providers and crypto remain paused. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setMode('inr'); setInrDetails(null); setStatus('idle'); setErrorMsg(''); }}
            className={`p-3 rounded-xl border text-left transition-colors ${
              mode === 'inr' ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <p className="text-xs font-bold text-white flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> INR bank account</p>
            <p className="text-[9px] text-white/40 mt-1">Cashfree-issued receiving details</p>
          </button>
          <button
            type="button"
            onClick={() => { setMode('bank'); setBankInstr(null); setStatus('idle'); setErrorMsg(''); }}
            className={`p-3 rounded-xl border text-left transition-colors ${
              mode === 'bank' ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <p className="text-xs font-bold text-white flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Manual bank transfer</p>
            <p className="text-[9px] text-white/40 mt-1">Only if a verified receiving account is configured</p>
          </button>
        </div>

        {mode === 'inr' ? (
          <div className="space-y-3">
            <p className="text-[11px] text-white/50 leading-relaxed">
              VaultBank will show only bank details issued by Cashfree. Funds are not credited until a valid, signed provider payment event is reconciled.
            </p>
            {!inrReadiness && (
              <p className="text-xs text-white/40 text-center py-3">Checking INR receiving readiness…</p>
            )}
            {inrReadiness && (!inrReadiness.collections || inrReadiness.collectionsMode !== 'live') && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300 font-bold text-center leading-relaxed">
                INR receiving is not ready yet. Current reason: {inrReadiness.collectionsReason || 'provider-not-configured'}. Do not transfer money until provider-issued account details appear here.
              </div>
            )}
            {inrReadiness?.collections && inrReadiness?.collectionsMode === 'live' && !inrDetails && (
              <p className="text-[11px] text-white/50 text-center">Your receiving account will be provisioned by Cashfree. No bank account number or IFSC is generated by VaultBank.</p>
            )}
            {inrDetails && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2">
                <p className="text-[9px] text-emerald-300 tracking-wider font-bold">PROVIDER-ISSUED INR RECEIVING ACCOUNT</p>
                <p className="text-xs text-white/70">Bank: <span className="font-bold text-white">{inrDetails.details.bankCode || 'Cashfree partner bank'}</span></p>
                <p className="text-xs text-white/70">Account number</p>
                <button type="button" onClick={() => { navigator.clipboard.writeText(String(inrDetails.details.accountNumber)); }} className="w-full font-mono text-sm text-emerald-200 bg-black/20 rounded-lg p-2.5 break-all">{inrDetails.details.accountNumber}</button>
                <p className="text-xs text-white/70">IFSC</p>
                <button type="button" onClick={() => { navigator.clipboard.writeText(String(inrDetails.details.ifsc)); }} className="w-full font-mono text-sm text-emerald-200 bg-black/20 rounded-lg p-2.5 break-all">{inrDetails.details.ifsc}</button>
                <p className="text-[10px] text-amber-200 leading-relaxed">Settlement is not yet verified. Confirm Cashfree approval and settlement terms before receiving customer funds.</p>
              </div>
            )}
          </div>
        ) : mode === 'bank' ? (
          <div className="space-y-3">
            {!bankCfg && <p className="text-xs text-white/40 text-center py-4">Checking bank transfer availability…</p>}
            {bankCfg && !bankCfg.enabled && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300 font-bold text-center leading-relaxed">
                Bank transfers are not set up yet — a verified receiving account isn't configured. Please use another rail for now.
              </div>
            )}
            {bankCfg && bankCfg.enabled && !bankInstr && (
              <>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  Create an instruction to get a unique payment reference, then send the transfer from your bank.
                  Your balance is credited only after our team verifies the arrival on the bank statement (manual verification, typically 1-3 business days).
                </p>
                {amountFields}
              </>
            )}
            {bankCfg && bankCfg.enabled && bankInstr && (
              <div className="space-y-2.5">
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1.5">
                  <p className="text-[9px] text-emerald-300/70 tracking-wider font-bold">PAYMENT REFERENCE — INCLUDE IT IN YOUR TRANSFER</p>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(bankInstr.instruction.reference); }}
                    className="w-full font-mono text-sm text-emerald-200 bg-black/20 rounded-lg p-2.5 break-all hover:text-white transition-colors"
                    title="Tap to copy"
                  >
                    {bankInstr.instruction.reference}
                  </button>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1 text-[11px] text-white/70">
                  <p><span className="text-white/40 font-bold">Send to:</span> {bankInstr.transfer.holder} — {bankInstr.transfer.bankName}</p>
                  <p className="font-mono break-all"><span className="text-white/40 font-bold">Account:</span> {bankInstr.transfer.details}</p>
                  <p><span className="text-white/40 font-bold">Amount:</span> {bankInstr.transfer.currency} {Number(bankInstr.transfer.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className={`rounded-xl border p-2.5 text-[11px] font-bold text-center ${
                  bankInstr.instruction.status === 'settled'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}>
                  {bankInstr.instruction.status === 'settled'
                    ? '● VERIFIED — funds credited to your balance'
                    : '○ PENDING — awaiting bank arrival + statement verification'}
                </div>
                <p className="text-[10px] text-white/40 leading-relaxed">{bankInstr.transfer.note}</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await api.getBankDepositInstruction(bankInstr.instruction.id);
                      if (r.success && r.instruction) setBankInstr({ ...bankInstr, instruction: r.instruction });
                    } catch { /* status refresh is best-effort */ }
                  }}
                  className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white/60 hover:text-white hover:border-emerald-500/30 transition-colors"
                >
                  Refresh status
                </button>
              </div>
            )}
          </div>
        ) : mode === 'usdc' ? (
          <div className="space-y-3">
            {/* Token toggle — the SAME address receives both; check credits both. */}
            <div className="grid grid-cols-2 gap-2">
              {(['USDC', 'USDT'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCryptoToken(t)}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-colors ${
                    cryptoToken === t ? 'bg-emerald-500/10 border-emerald-500/40 text-white' : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
                  }`}
                >
                  {t === 'USDC' ? '🪙 USDC' : '₮ USDT'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">
              Send <span className="text-white font-bold">{cryptoToken} on {usdcTestnet ? 'Base Sepolia (TESTNET)' : 'Base'}</span> to your personal address below.
              No account or verification needed — funds credit after 12 network confirmations.
            </p>
            {usdcTestnet && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-300 font-bold text-center">
                🧪 TESTNET MODE — sandbox balance, no real-world value
              </div>
            )}
            {usdc ? (
              <>
                {usdc.qr && <img src={usdc.qr} alt="USDC deposit QR" className="w-40 h-40 mx-auto rounded-xl bg-white p-2" />}
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(usdc.address); }}
                  className="w-full font-mono text-xs text-amber-200 bg-white/5 border border-white/10 rounded-xl p-3 break-all hover:border-amber-500/40 transition-colors"
                  title="Tap to copy"
                >
                  {usdc.address}
                </button>
                <button
                  type="button"
                  onClick={checkUsdc}
                  className="w-full py-3 rounded-xl bg-linear-to-r from-emerald-400 to-teal-500 text-white font-bold text-sm"
                >
                  {usdcChecking ? 'Scanning chain…' : "I've sent it — check now"}
                </button>
              </>
            ) : (
              status !== 'error' && <p className="text-xs text-white/40 text-center py-4">Generating your address…</p>
            )}
          </div>
        ) : (
        <>
          {amountFields}
        </>
        )}

        {status === 'error' && (
          <p className="text-xs text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">{errorMsg}</p>
        )}

        {status === 'success' && mode === 'usdc' && (
          <p className="text-xs text-emerald-300 font-bold bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">{cryptoToken} deposit confirmed — balance updated.</p>
        )}

        {mode !== 'usdc' && !(mode === 'bank' && bankInstr) && !(mode === 'inr' && inrDetails) && (
        <SubmitButton status={status} idleText={mode === 'inr' ? 'Get INR Receiving Details' : 'Get Bank Transfer Instructions'} color="emerald" />
        )}
      </form>
    </BaseModal>
  );
}

export function WithdrawModal({ isOpen, onClose }: ModalProps) {
  const [amount, setAmount] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [readiness, setReadiness] = useState<any>(null);
  const [payoutId, setPayoutId] = useState('');
  const [transferId, setTransferId] = useState('');
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `vbpo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    api.paymentsReadiness()
      .then((r) => { if (!cancelled) setReadiness(r?.rails?.inr || null); })
      .catch(() => { if (!cancelled) setReadiness(null); });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Require a successful read-only Cashfree payout credential probe before
  // offering the live payout form; configured environment variables alone are not enough.
  const payoutReady = readiness?.payouts === true &&
    readiness?.payoutsMode === 'live' &&
    readiness?.payoutsProviderLive === true;

  const resetAndClose = () => {
    setAmount('');
    setBankAccount('');
    setIfsc('');
    setAddress1('');
    setCity('');
    setState('');
    setPincode('');
    setStatus('idle');
    setSuccessMsg('');
    setErrorMsg('');
    setPayoutId('');
    setTransferId('');
    setUnknownOutcome(false);
    setNeedsReconcile(false);
    setIdempotencyKey(`vbpo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountText = amount.trim();
    if (!/^\\d+(\\.\\d{1,2})?$/.test(amountText) || !Number.isFinite(Number(amountText)) || Number(amountText) < 10 || Number(amountText) > 500000) {
      setStatus('error');
      setErrorMsg('Enter a valid INR payout amount between ₹10 and ₹5,00,000 with at most two decimal places.');
      return;
    }
    if (!/^[0-9]{6,20}$/.test(bankAccount.trim()) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
      setStatus('error');
      setErrorMsg('Enter a valid bank account number and IFSC.');
      return;
    }
    if (address1.trim().length < 3 || !city.trim() || !state.trim() || !/^[0-9]{6}$/.test(pincode.trim())) {
      setStatus('error');
      setErrorMsg('A real street address, city, state and six-digit PIN code are required.');
      return;
    }
    if (!payoutReady) {
      setStatus('error');
      setErrorMsg(readiness?.payoutsReason
        ? `Cashfree payouts are not live-ready (${readiness.payoutsReason}). No payout was requested. An admin must configure live credentials and run the read-only credential probe.`
        : 'Cashfree payout readiness could not be verified. No payout was requested.');
      return;
    }

    setStatus('loading');
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const result = await api.createPayoutRequest({
        amount: Number(amountText),
        bankAccount: bankAccount.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        address1: address1.trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
      }, idempotencyKey);
      if (!result?.success) throw new Error(result?.message || 'Cashfree did not accept the payout request.');
      setPayoutId(String(result.payoutId || ''));
      setTransferId(String(result.transferId || ''));
      if (result.status === 'reconciliation_required') {
        setNeedsReconcile(true);
        setUnknownOutcome(true);
        setSuccessMsg(`Payout outcome needs reconciliation. Your funds remain reserved; do not start another payout until this one is resolved. Reference: ${result.transferId || result.payoutId || 'check payout history'}.`);
        setStatus('success');
        return;
      }
      setSuccessMsg(`INR payout submitted to Cashfree. Status: ${result.status || 'submitted'}; this is not confirmation that the beneficiary bank has received the funds. Reference: ${result.transferId || result.payoutId || 'saved in payout history'}.`);
      setUnknownOutcome(false);
      setStatus('success');
    } catch (err: any) {
      const httpStatus = Number(err?.status || 0);
      if (httpStatus === 0 || httpStatus >= 500) {
        // The reservation or provider request may already exist. Lock the
        // inputs and preserve the exact same idempotency key for safe retry.
        setUnknownOutcome(true);
        setErrorMsg('We could not verify the payout outcome. Do not change these details or create another payout. Retry this exact request with the same idempotency key, or ask an admin to check the payout queue.');
      } else {
        // A definitive client error is returned. A payout record may have
        // been safely rejected/refunded; use a fresh key only for a new attempt.
        setUnknownOutcome(false);
        setIdempotencyKey(`vbpo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
        setErrorMsg(err?.message || 'Payout request was rejected.');
      }
      setStatus('error');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={resetAndClose} icon={Banknote} title="Withdraw INR" subtitle="CASHFREE BANK PAYOUT">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40 tracking-wider font-semibold">PAYOUT RAIL</span>
          <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold border ${
            payoutReady
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
          }`}>
            {payoutReady ? '● LIVE CREDENTIALS VERIFIED' : '○ PAYOUT NOT READY'}
          </span>
        </div>

        {!payoutReady && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300 leading-relaxed">
            {readiness
              ? `Payouts are disabled: ${readiness.payoutsReason || 'live credentials have not passed the read-only probe'}.`
              : 'Checking Cashfree payout readiness…'}
            {' '}No money will be sent from this form until live credentials have been verified.
          </div>
        )}

        <div>
          <label htmlFor="withdraw-inr-amount" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT (INR)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-rose-400 font-display text-2xl">₹</span>
            <input id="withdraw-inr-amount" name="withdrawInrAmount" aria-label="INR payout amount" type="number" min="10" max="500000" step="0.01" required value={amount} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full bg-white/5 border border-white/10 rounded-xl p-4 pl-10 text-2xl font-display text-white focus:outline-none focus:border-rose-500/40 transition-colors disabled:opacity-50" />
          </div>
          <p className="mt-1 text-[10px] text-white/30">Allowed range: ₹10–₹5,00,000 per payout.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="payout-bank-account" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">BANK ACCOUNT</label>
            <input id="payout-bank-account" autoComplete="off" inputMode="numeric" required value={bankAccount} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setBankAccount(e.target.value.replace(/\\s/g, ''))} placeholder="Account number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-rose-500/40 disabled:opacity-50" />
          </div>
          <div>
            <label htmlFor="payout-ifsc" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">IFSC</label>
            <input id="payout-ifsc" autoComplete="off" required value={ifsc} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/\\s/g, ''))} placeholder="HDFC0000001" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm font-mono text-white focus:outline-none focus:border-rose-500/40 disabled:opacity-50" />
          </div>
        </div>

        <div>
          <label htmlFor="payout-address1" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">STREET ADDRESS</label>
          <input id="payout-address1" autoComplete="street-address" required value={address1} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setAddress1(e.target.value)} placeholder="Your real residential address" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-rose-500/40 disabled:opacity-50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="payout-city" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">CITY</label>
            <input id="payout-city" autoComplete="address-level2" required value={city} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setCity(e.target.value)} placeholder="City" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-rose-500/40 disabled:opacity-50" />
          </div>
          <div>
            <label htmlFor="payout-state" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">STATE</label>
            <input id="payout-state" autoComplete="address-level1" required value={state} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setState(e.target.value)} placeholder="State" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-rose-500/40 disabled:opacity-50" />
          </div>
        </div>
        <div>
          <label htmlFor="payout-pincode" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">PIN CODE</label>
          <input id="payout-pincode" autoComplete="postal-code" inputMode="numeric" required pattern="[0-9]{6}" maxLength={6} value={pincode} disabled={unknownOutcome || status === 'loading'} onChange={(e) => setPincode(e.target.value.replace(/\\D/g, '').slice(0, 6))} placeholder="6-digit PIN code" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-rose-500/40 disabled:opacity-50" />
        </div>

        <p className="text-[10px] text-white/35 leading-relaxed">
          Your VaultBank profile must contain your real full name, email and phone. Funds are reserved before submission and remain held if the provider outcome is ambiguous. A submitted status is not proof of bank settlement.
        </p>

        {status === 'error' && (
          <p className="text-xs text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">{errorMsg}</p>
        )}
        {status === 'success' && (
          <div className="text-xs text-emerald-300 font-bold bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 space-y-2">
            <p className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />{successMsg}</p>
            {payoutId && <p className="font-mono text-[10px] break-all">Payout ID: {payoutId}</p>}
            {transferId && <p className="font-mono text-[10px] break-all">Reference: {transferId}</p>}
          </div>
        )}

        {status === 'success' ? (
          <button type="button" onClick={resetAndClose} className="w-full py-3 rounded-xl bg-white/10 border border-white/10 text-white font-bold text-sm">Close</button>
        ) : (
          <SubmitButton status={status} idleText={unknownOutcome ? 'Retry Same Payout Request' : 'Submit INR Payout'} color="rose" />
        )}
        {needsReconcile && (
          <p className="text-[10px] text-amber-200 leading-relaxed">This payout is held for reconciliation. Do not retry with a new key or submit another payout. Ask an admin to check the payout queue and provider status.</p>
        )}
      </form>
    </BaseModal>
  );
}

export function PayBillModal({ isOpen, onClose, onPayBill }: ModalProps & { onPayBill: (name: string, amount: number) => Promise<boolean | void> }) {
  const [name, setName] = useState('Netflix');
  const [amount, setAmount] = useState('15.99');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      await onPayBill(name, parseFloat(amount));
      setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 1800);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Payment failed.');
      setStatus('error');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={Receipt} title="Pay Bill" subtitle="SCHEDULED PAYMENTS">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          {['Netflix', 'Electric', 'Rent', 'Internet', 'Insurance'].map(bill => (
            <button
              key={bill}
              type="button"
              onClick={() => setName(bill)}
              className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
                name === bill ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/5 border-white/5 hover:bg-white/[0.04]'
              }`}
            >
              <span className="text-sm text-white">{bill}</span>
              {name === bill && <CheckCircle2 className="w-4 h-4 text-rose-400" />}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="paybill-amount" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-rose-400 font-display text-2xl">$</span>
            <input
              id="paybill-amount"
              name="amount"
              aria-label="Bill payment amount in dollars"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 pl-10 text-2xl font-display text-white focus:outline-none focus:border-rose-500/40 transition-colors"
            />
          </div>
        </div>
        {status === 'error' && (
          <p className="text-xs text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">{errorMsg}</p>
        )}
        <SubmitButton status={status} idleText="Pay Bill" color="rose" />
      </form>
    </BaseModal>
  );
}

export function ConvertModal({ isOpen, onClose }: ModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={ArrowRightLeft} title="Currency Convert" subtitle="FOREX EXCHANGE">
      <div className="text-center py-8 text-white/40">
        <Globe className="w-12 h-12 mx-auto mb-3 text-amber-400/40" />
        <p>Advanced FX trading coming soon</p>
      </div>
    </BaseModal>
  );
}

export function WireModal({ isOpen, onClose }: ModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={Globe} title="International Wire" subtitle="SWIFT TRANSFERS">
      <div className="text-center py-8 text-white/40">
        <Smartphone className="w-12 h-12 mx-auto mb-3 text-purple-400/40" />
        <p>Wire transfer setup coming soon</p>
      </div>
    </BaseModal>
  );
}

export function MobileModal({ isOpen, onClose }: ModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={Smartphone} title="Mobile Top-up" subtitle="PHONE RECHARGE">
      <div className="text-center py-8 text-white/40">
        <Smartphone className="w-12 h-12 mx-auto mb-3 text-orange-400/40" />
        <p>Mobile recharge coming soon</p>
      </div>
    </BaseModal>
  );
}

// Interactive Trading Simulator Modal
interface TradeModalProps extends ModalProps {
  onTrade: (ticker: string, type: 'buy' | 'sell', shares: number) => Promise<boolean>;
  investments: { ticker: string; name: string; price: number; shares: number }[];
  available: number;
}

export function TradeModal({ isOpen, onClose, onTrade, investments, available }: TradeModalProps) {
  const [ticker, setTicker] = useState('AAPL');
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState('1');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const activeAsset = investments.find(inv => inv.ticker === ticker) || investments[0];
  const totalPrice = activeAsset ? activeAsset.price * (parseFloat(shares) || 0) : 0;
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !shares || parseFloat(shares) <= 0) return;
    setStatus('loading');
    
    const success = await onTrade(ticker, type, parseFloat(shares));
    if (success) {
      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        setShares('1');
        onClose();
      }, 1500);
    } else {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} icon={TrendingUp} title="Trade Portfolio" subtitle="LIVE ASSET MARKET">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Toggle Buy / Sell */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl border border-white/5">
          <button
            type="button"
            onClick={() => setType('buy')}
            className={`py-2 rounded-lg text-sm font-bold transition-all ${
              type === 'buy' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-white/40 hover:text-white'
            }`}
          >
            Buy Asset
          </button>
          <button
            type="button"
            onClick={() => setType('sell')}
            className={`py-2 rounded-lg text-sm font-bold transition-all ${
              type === 'sell' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-white/40 hover:text-white'
            }`}
          >
            Sell Asset
          </button>
        </div>

        {/* Asset Selector */}
        <div>
          <label htmlFor="trade-asset" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">SELECT ASSET</label>
          <select
            id="trade-asset"
            name="asset"
            aria-label="Asset to trade"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
          >
            {investments.map(inv => (
              <option key={inv.ticker} value={inv.ticker} className="bg-[#0d0d14]">
                {inv.ticker} — {inv.name} (${inv.price.toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        {/* Current holdings display */}
        {activeAsset && (
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex justify-between text-xs">
            <span className="text-white/50">Your Holdings:</span>
            <span className="font-bold text-white">
              {activeAsset.shares.toLocaleString()} shares (${(activeAsset.shares * activeAsset.price).toLocaleString()})
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="trade-shares" className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">SHARES / UNITS</label>
            <input
              id="trade-shares"
              name="shares"
              aria-label="Number of shares"
              type="number"
              min="0.0001"
              step="any"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/40 font-bold"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">EST. TOTAL</label>
            <div className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3 text-sm text-white flex items-center font-display font-bold text-amber-400">
              ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Cost vs cash indicator */}
        <div className="flex justify-between text-[11px] px-1">
          <span className="text-white/40">Available cash:</span>
          <span className={`font-bold ${available < totalPrice && type === 'buy' ? 'text-rose-400' : 'text-emerald-400'}`}>
            ${available.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </div>

        <SubmitButton 
          status={status} 
          idleText={type === 'buy' ? 'Confirm Purchase' : 'Confirm Sale'} 
          color={type === 'buy' ? 'emerald' : 'rose'} 
        />
        
        {status === 'error' && (
          <p className="text-xs text-rose-400 font-bold text-center animate-bounce">
            {type === 'buy' ? 'Insufficient available funds' : 'Insufficient shares to sell'}
          </p>
        )}
      </form>
    </BaseModal>
  );
}

// Base modal wrapper
function BaseModal({ isOpen, onClose, icon: Icon, title, subtitle, children }: ModalProps & { icon: any, title: string, subtitle: string, children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 pointer-events-auto"
          />
          <motion.div
            initial={{ scale: 0.85, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, y: 40, opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="gradient-border p-[1px] w-full max-w-md pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              <div className="bg-[#0d0d14] rounded-3xl p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <RichIcon icon={<Icon size={20} strokeWidth={2.5} />} variant="gold" size="lg" glow pulse />
                    <div>
                      <h3 className="font-display text-xl text-white">{title}</h3>
                      <p className="text-[10px] text-white/40 tracking-wider">{subtitle}</p>
                    </div>
                  </div>
                  <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10">
                    <X className="w-4 h-4 text-white/60" />
                  </button>
                </div>
                {children}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Submit button with states
function SubmitButton({ status, idleText, color = 'amber' }: { status: string; idleText: string; color?: 'amber' | 'emerald' | 'rose' }) {
  const gradients = {
    amber: 'from-amber-400 via-yellow-400 to-amber-500',
    emerald: 'from-emerald-400 via-teal-400 to-emerald-500',
    rose: 'from-rose-400 via-pink-400 to-rose-500',
  };

  return (
    <motion.button
      type="submit"
      disabled={status === 'loading'}
      whileHover={status === 'idle' ? { scale: 1.02 } : {}}
      whileTap={status === 'idle' ? { scale: 0.98 } : {}}
      className={`w-full py-4 mt-6 rounded-xl bg-gradient-to-r ${gradients[color]} text-${color === 'amber' ? 'amber-950' : 'white'} font-bold flex items-center justify-center gap-2 glow-${color}`}
    >
      {status === 'idle' && idleText}
      {status === 'error' && 'Failed'}
      {status === 'loading' ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" /> Processing...
        </>
      ) : null}
      {status === 'success' && (
        <>
          <CheckCircle2 className="w-5 h-5" /> Done!
        </>
      )}
    </motion.button>
  );
}
