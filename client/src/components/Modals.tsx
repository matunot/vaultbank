import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, CheckCircle2, Loader2, TrendingUp, UserSearch, Banknote, Building2 } from 'lucide-react';
import RichIcon from './RichIcon';
import Avatar from './Avatar';
import { api } from '../api';
import { BankTransferDepositPanel } from './BankTransferDepositPanel';

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
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      icon={Building2}
      title="Bank transfer deposit"
      subtitle="VAULTBANK NATIVE BANK RAIL"
    >
      <BankTransferDepositPanel />
    </BaseModal>
  );
}

export function WithdrawModal({ isOpen, onClose }: ModalProps) {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      icon={Banknote}
      title="Bank payout"
      subtitle="VAULTBANK MANUAL BANK TRANSFER"
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-white/65">
          Bank payouts are managed from Payments → Banking Rails. A payout request reserves available funds; an authorised operator sends the transfer through the bank and confirms the official bank reference before the request is reconciled.
        </p>
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-100/80">
          This screen does not submit a third-party payout or claim that an external bank transfer has been sent.
        </p>
        <button type="button" onClick={onClose} className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15">
          Close
        </button>
      </div>
    </BaseModal>
  );
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
