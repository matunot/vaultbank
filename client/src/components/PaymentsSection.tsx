import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Send, Download, Check, Eye, EyeOff, QrCode,
  ArrowUpRight, ArrowDownRight, Zap, X, Loader2, UserSearch, Banknote,
  Building2, CreditCard, Globe, ShieldCheck, IndianRupee, RefreshCw,
} from 'lucide-react';
import { useAccountData } from '../hooks/useAccountData';
import { api } from '../api';
import Avatar from './Avatar';
import { WithdrawModal } from './Modals';

/** A real registered VaultBank user (from the backend directory). */
interface Recipient {
  id?: string;
  name: string;
  email?: string;
  accountNumber?: string | null;
}

type Currency = 'USD' | 'INR';

interface RailsReadiness {
  usd: { cardStripe: boolean; paypal: boolean; bankTransferInstructions: boolean; internalTransfers: boolean; externalWithdrawals: boolean };
  inr: { collections: boolean; collectionsProvider: string | null; internalTransfers: boolean; payouts: boolean; payoutsProvider: string | null };
}

interface InrTransaction {
  id: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  category?: string;
  date?: string;
  externalReference?: string | null;
}

interface PayoutRecord {
  id: string;
  transfer_id: string;
  amount: string;
  currency: string;
  destination_account_masked: string;
  destination_ifsc: string;
  status: string;
  utr: string | null;
  failure_reason: string | null;
  created_at: string;
}

export default function PaymentsSection({ onOpenModal }: { onOpenModal?: (modal: string) => void }) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [hideBalances, setHideBalances] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // REAL account data (USD primary account) from the backend
  const { account, transactions, balance, loading: accountLoading } = useAccountData();
  const usdRecent = transactions.slice(0, 6);

  // ── Readiness: every rail's REAL configuration state ──
  const [readiness, setReadiness] = useState<RailsReadiness | null>(null);
  useEffect(() => {
    api.paymentsReadiness()
      .then((r) => setReadiness((r && r.rails) || null))
      .catch(() => setReadiness(null));
  }, []);

  // Detect whether real Stripe keys are configured (LIVE vs not) — card rail badge
  const [railMode, setRailMode] = useState<'live' | 'demo' | null>(null);
  useEffect(() => {
    api.stripeBalance()
      .then(r => setRailMode(r.mode === 'live' ? 'live' : 'demo'))
      .catch(() => setRailMode('demo'));
  }, []);

  // ── INR wallet state ──
  const [inrState, setInrState] = useState<'idle' | 'loading' | 'none' | 'ready' | 'error'>('idle');
  const [inrWallet, setInrWallet] = useState<{ account: { accountNumber: string; balance: number }; transactions: InrTransaction[] } | null>(null);
  const [payoutRecords, setPayoutRecords] = useState<PayoutRecord[]>([]);

  const loadInr = async () => {
    setInrState('loading');
    try {
      const [walletRes, payoutsRes] = await Promise.all([
        api.getInrAccount(),
        api.myPayouts().catch(() => ({ success: false, requests: [] })),
      ]);
      if (walletRes.success && walletRes.account) {
        setInrWallet({ account: walletRes.account, transactions: walletRes.transactions || [] });
        setInrState('ready');
      } else {
        setInrWallet(null);
        setInrState('none');
      }
      setPayoutRecords((payoutsRes.requests as PayoutRecord[]) || []);
    } catch (err: any) {
      if (err?.status === 404) {
        setInrWallet(null);
        setInrState('none');
      } else {
        setInrState('error');
      }
    }
  };

  useEffect(() => {
    if (currency === 'INR' && inrState === 'idle') loadInr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // ── Open INR wallet ──
  const [openInrStatus, setOpenInrStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [openInrMsg, setOpenInrMsg] = useState('');
  const openInrWallet = async () => {
    setOpenInrStatus('loading');
    setOpenInrMsg('');
    try {
      const res = await api.openInrAccount();
      if (!res.success && !res.already) throw new Error(res.message || 'Could not open your INR wallet.');
      setInrState('idle'); // triggers reload below
      await loadInr();
      setOpenInrStatus('idle');
    } catch (err: any) {
      setOpenInrStatus('error');
      setOpenInrMsg(err?.message || 'Could not open your INR wallet.');
    }
  };

  // ── INR receiving details (provider-issued only) ──
  const [inrDetails, setInrDetails] = useState<{ accountNumber: string; ifsc: string; bankCode?: string | null } | null>(null);
  const [detailsStatus, setDetailsStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [detailsMsg, setDetailsMsg] = useState('');
  const fetchMyDetails = async () => {
    setDetailsStatus('loading');
    setDetailsMsg('');
    try {
      const res = await api.collectionsMyDetails();
      if (!res.success || !res.details) throw new Error(res.message || 'Receiving details are not available right now.');
      setInrDetails(res.details);
      setDetailsStatus('idle');
    } catch (err: any) {
      setDetailsStatus('error');
      setDetailsMsg(err?.message || 'Could not load your receiving details.');
    }
  };

  // One idempotent INR payout form is shared by all Withdraw buttons.
  const [showWithdraw, setShowWithdraw] = useState(false);

  // ── REAL send-money flow (live user search + real transfer) ──
  const [showSend, setShowSend] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [results, setResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [sendMsg, setSendMsg] = useState('');
  // Idempotency key: one per transfer ATTEMPT — reused across retries of the
  // same attempt, never regenerated on timeout, cleared only on a definitive
  // result or when the user starts a new transfer.
  const sendKeyRef = useRef<string | null>(null);
  const sendInFlightRef = useRef(false);

  useEffect(() => {
    if (!showSend || selected) return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchUsers(q);
        setResults(res.success && Array.isArray(res.users) ? res.users : []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, showSend, selected]);

  const resetSend = () => {
    setShowSend(false);
    setSelected(null);
    setQuery('');
    setResults([]);
    setSendAmount('');
    setSendStatus('idle');
    setSendMsg('');
    sendKeyRef.current = null;
    sendInFlightRef.current = false;
  };

  const executeSend = async () => {
    const recipient = selected ? (selected.accountNumber || selected.email || selected.name) : query.trim();
    if (!recipient || !sendAmount || parseFloat(sendAmount) <= 0) return;
    // Double-submission guard: if a request is already in flight for this
    // attempt, ignore the click — the same key is already protecting it.
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    // Generate the key ONCE per attempt — a retry reuses it so the server
    // can safely deduplicate.
    if (!sendKeyRef.current) {
      sendKeyRef.current = `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
    setSendStatus('sending');
    setSendMsg('');
    try {
      const isEmail = recipient.includes('@');
      const res = await api.sendMoney(
        isEmail
          ? { recipientEmail: recipient, amount: parseFloat(sendAmount), currency }
          : { recipientAccountNumber: recipient, amount: parseFloat(sendAmount), currency },
        sendKeyRef.current
      );
      if (!res.success) throw new Error(res.message || 'Transfer failed.');
      setSendStatus('success');
      setSendMsg(`${currency} ${parseFloat(sendAmount).toFixed(2)} transfer completed.`);
      sendKeyRef.current = null; // definitive result — key consumed
      if (currency === 'INR') loadInr();
      setTimeout(resetSend, 2200);
    } catch (err: any) {
      setSendStatus('error');
      setSendMsg(err?.message || 'Transfer failed.');
      // Keep the key for retries — the server will deduplicate if the
      // original request actually reached it (e.g., timeout after commit).
      // Only clear on definitive non-retryable errors.
      if (err?.status === 400 || err?.status === 404) {
        sendKeyRef.current = null; // definitive client error — start fresh next time
      }
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const curSymbol = currency === 'INR' ? '₹' : '$';
  const inrRail = readiness?.inr;
  const usdRail = readiness?.usd;

  const rails: Array<{
    key: string; name: string; desc: string; ready: boolean | null;
    icon: typeof Wallet; color: string; hint?: string;
    action?: () => void; actionLabel?: string;
  }> = [
    {
      key: 'internal', name: 'Internal Transfers', desc: 'Instant, free VaultBank-to-VaultBank in the same currency',
      ready: true, icon: Send, color: '#3b82f6', action: () => { setCurrency(currency); setShowSend(true); }, actionLabel: 'Send',
    },
    {
      key: 'card', name: 'Card via Stripe', desc: 'Real card deposits through Stripe Checkout',
      ready: usdRail ? usdRail.cardStripe : null, icon: CreditCard, color: '#6366f1',
      hint: railMode === 'live' ? 'LIVE keys detected' : 'Not configured — set the Stripe secret key',
    },
    {
      key: 'paypal', name: 'PayPal', desc: 'PayPal Checkout deposits with verified capture',
      ready: usdRail ? usdRail.paypal : null, icon: Globe, color: '#0ea5e9',
      hint: usdRail?.paypal ? 'Configured' : 'Not configured — PayPal credentials required',
    },
    {
      key: 'bankusd', name: 'Bank Transfer (USD)', desc: 'Unique reference + manual statement verification',
      ready: usdRail ? usdRail.bankTransferInstructions : null, icon: Building2, color: '#f59e0b',
      hint: usdRail?.bankTransferInstructions ? 'Instructions available in Deposits' : 'Not configured — receiving account env required',
    },
    {
      key: 'collections', name: 'INR Receiving Details', desc: 'Provider-issued per-user account + IFSC, auto-credited',
      ready: inrRail ? inrRail.collections : null, icon: IndianRupee, color: '#10b981',
      hint: inrRail?.collections ? `Provider: ${inrRail.collectionsProvider}` : 'Not configured — collection provider required',
      action: inrRail?.collections ? () => { setCurrency('INR'); fetchMyDetails(); } : undefined, actionLabel: 'Get details',
    },
    {
      key: 'payouts', name: 'INR Bank Withdrawals', desc: 'Reserved funds, provider status, exactly-once refunds',
      ready: inrRail ? inrRail.payouts : null, icon: Banknote, color: '#d97706',
      hint: inrRail?.payouts ? `Provider: ${inrRail.payoutsProvider}` : 'Not configured — payout provider required',
      action: inrRail?.payouts ? () => setCurrency('INR') : undefined, actionLabel: 'Withdraw',
    },
    {
      key: 'usdext', name: 'USD External Withdrawals', desc: 'Outbound USD to a bank account',
      ready: usdRail ? usdRail.externalWithdrawals : null, icon: Banknote, color: '#64748b',
      hint: 'No authorized USD payout rail exists yet — kept honestly disabled',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl overflow-hidden iridescent-border"
      >
        <div className="relative p-6 lg:p-8 bg-linear-to-br from-cyan-500/10 via-blue-500/5 to-purple-500/10">
          <div className="absolute inset-0 glass opacity-40" />
          <div className="absolute -top-20 -right-20 w-72 h-72 bg-cyan-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-purple-500/15 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-5 h-5 text-cyan-300" />
                  <p className="text-xs tracking-[0.3em] text-white/40 font-bold">VAULTBANK PAYMENTS</p>
                  {railMode && (
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                      railMode === 'live'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                    }`}>
                      {railMode === 'live' ? '● LIVE RAIL' : '○ SANDBOX'}
                    </span>
                  )}
                </div>
                {/* Currency selector — USD / INR */}
                <div className="flex items-center gap-2 mb-3">
                  {(['USD', 'INR'] as Currency[]).map(c => (
                    <button
                      key={c}
                      onClick={() => setCurrency(c)}
                      className={`px-4 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        currency === c
                          ? 'bg-linear-to-r from-cyan-400 to-blue-500 text-white border-transparent glow-blue'
                          : 'glass-btn text-white/50 border-white/10 hover:text-white'
                      }`}
                    >
                      {c === 'INR' ? <span className="flex items-center gap-1"><IndianRupee className="w-3 h-3" /> INR</span> : '$ USD'}
                    </button>
                  ))}
                </div>
                {currency === 'USD' ? (
                  <p className="font-display text-5xl lg:text-6xl text-white">
                    {hideBalances || accountLoading ? '••••••' : `$${(balance?.total ?? account?.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                  </p>
                ) : (
                  <p className="font-display text-5xl lg:text-6xl text-white">
                    {hideBalances ? '••••••' : inrState === 'ready' && inrWallet
                      ? `₹${inrWallet.account.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                      : inrState === 'loading' ? '…' : '—'}
                  </p>
                )}
                <p className="text-sm text-white/40 mt-1.5">
                  {currency === 'USD'
                    ? `REAL balance · ${account?.accountNumber ? `VaultBank •• ${account.accountNumber.slice(-4)}` : 'VaultBank account'}`
                    : inrState === 'ready' && inrWallet
                      ? `REAL INR balance · VaultBank •• ${inrWallet.account.accountNumber.slice(-4)}`
                      : 'INR wallet' + (inrState === 'none' ? ' — not opened yet' : '')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => setHideBalances(!hideBalances)}
                  className="p-3 rounded-xl glass-btn"
                >
                  {hideBalances ? <Eye className="w-4 h-4 text-white/60" /> : <EyeOff className="w-4 h-4 text-white/60" />}
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    if (currency === 'USD' && onOpenModal) onOpenModal('deposit');
                    if (currency === 'INR') { if (inrState === 'none') openInrWallet(); else fetchMyDetails(); }
                  }}
                  className="px-5 py-3 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm flex items-center gap-2 glow-blue"
                >
                  <Plus className="w-4 h-4" /> Add Money
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setShowWithdraw(true)}
                  className="px-4 py-3 rounded-xl glass-btn text-sm font-bold text-white/80 flex items-center gap-2"
                  title="Open the verified INR payout form"
                >
                  <Download className="w-4 h-4" /> Withdraw
                </motion.button>
              </div>
            </div>

            {/* Quick stats — REAL data */}
            <div className="grid grid-cols-3 gap-4">
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="w-3.5 h-3.5 text-cyan-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">AVAILABLE</p>
                </div>
                <p className="text-xl font-bold text-white">
                  {hideBalances ? '••••' : currency === 'USD'
                    ? `$${(balance?.available ?? 0).toLocaleString()}`
                    : inrState === 'ready' && inrWallet ? `₹${inrWallet.account.balance.toLocaleString('en-IN')}` : '—'}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">real funds</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">RECORDS</p>
                </div>
                <p className="text-xl font-bold text-white">
                  {currency === 'USD' ? transactions.length : (inrWallet?.transactions.length ?? 0)}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">real transactions</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">RAILS READY</p>
                </div>
                <p className="text-xl font-bold text-white">
                  {readiness
                    ? [...Object.values(readiness.usd), ...Object.values(readiness.inr)].filter(Boolean).length
                    : '…'}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">of 9 verified live</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Quick action buttons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Send, label: 'Send Money', desc: `VaultBank user (${currency})`, color: '#3b82f6', action: () => setShowSend(true) },
          { icon: QrCode, label: 'Receive', desc: 'Your account details', color: '#10b981', action: () => {} },
          { icon: Plus, label: 'Add Money', desc: currency === 'USD' ? 'Deposits & rails' : 'INR receiving details', color: '#06b6d4', action: () => { if (currency === 'USD' && onOpenModal) onOpenModal('deposit'); else fetchMyDetails(); } },
          { icon: Banknote, label: 'Withdraw INR', desc: 'Cashfree payout with live readiness gate', color: '#f59e0b', action: () => setShowWithdraw(true) },
        ].map((a, i) => (
          <motion.button
            key={a.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={a.action}
            className="glass glass-hover p-4 rounded-2xl text-left"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${a.color}20`, border: `1px solid ${a.color}40` }}>
              <a.icon className="w-5 h-5" style={{ color: a.color }} />
            </div>
            <p className="font-bold text-white text-sm">{a.label}</p>
            <p className="text-xs text-white/40">{a.desc}</p>
          </motion.button>
        ))}
      </div>

      {/* ── INR wallet zone ── */}
      {currency === 'INR' && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Wallet status / open */}
          <div className="glass-panel rounded-3xl p-6">
            <h3 className="font-display text-xl text-white mb-1 flex items-center gap-2">
              <IndianRupee className="w-5 h-5 text-emerald-400" /> INR Wallet
            </h3>
            {inrState === 'loading' && <p className="text-sm text-white/40 py-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading your INR account…</p>}
            {inrState === 'none' && (
              <div className="py-3">
                <p className="text-sm text-white/50 mb-4">You don't have an INR wallet yet. Open one — it's a separate, zero-balance account; your USD account is untouched.</p>
                <button onClick={openInrWallet} disabled={openInrStatus === 'loading'}
                  className="px-5 py-3 rounded-xl bg-linear-to-r from-emerald-400 to-teal-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
                  {openInrStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Open INR Wallet
                </button>
                {openInrStatus === 'error' && <p className="text-xs text-rose-400 font-bold mt-3">{openInrMsg}</p>}
              </div>
            )}
            {inrState === 'error' && <p className="text-sm text-rose-400 py-4">Could not load your INR account. Try again.</p>}
            {inrState === 'ready' && inrWallet && (
              <div className="py-2 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-white/40 tracking-wider font-bold">BALANCE</p>
                    <p className="font-display text-3xl text-white">₹{inrWallet.account.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <button onClick={loadInr} className="p-2 rounded-xl glass-btn" title="Refresh"><RefreshCw className="w-4 h-4 text-white/50" /></button>
                </div>
                <button onClick={() => copy(inrWallet.account.accountNumber, 'inr-acct')} className="w-full font-mono text-xs text-emerald-200 bg-white/5 border border-white/10 rounded-xl p-3 break-all hover:border-emerald-500/40 transition-colors">
                  {copied === 'inr-acct' ? 'Copied!' : inrWallet.account.accountNumber}
                </button>
              </div>
            )}
          </div>

          {/* Receiving details — provider-issued only */}
          <div className="glass-panel rounded-3xl p-6">
            <h3 className="font-display text-xl text-white mb-1 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-cyan-300" /> Receive INR
            </h3>
            {!inrRail?.collections ? (
              <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 my-3">
                Automatic INR receiving details are not available yet — the collection provider isn't configured. You'll get your own real account number + IFSC the moment it is.
              </p>
            ) : inrState !== 'ready' ? (
              <p className="text-sm text-white/40 py-4">Open your INR wallet first to get receiving details.</p>
            ) : !inrDetails ? (
              <div className="py-3">
                <p className="text-sm text-white/50 mb-4">Get your personal provider-issued bank details. Send INR from any Indian bank app — it's credited automatically after the provider confirms.</p>
                <button onClick={fetchMyDetails} disabled={detailsStatus === 'loading'}
                  className="px-5 py-3 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
                  {detailsStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />} Get My Receiving Details
                </button>
                {detailsStatus === 'error' && <p className="text-xs text-rose-400 font-bold mt-3">{detailsMsg}</p>}
              </div>
            ) : (
              <div className="py-2 space-y-2.5">
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2">
                  <p className="text-[9px] text-emerald-300/70 tracking-wider font-bold">YOUR INR ACCOUNT — PROVIDER-ISSUED</p>
                  <button onClick={() => copy(inrDetails.accountNumber, 'va-acct')} className="w-full font-mono text-sm text-emerald-200 bg-black/20 rounded-lg p-2.5 break-all hover:text-white transition-colors">
                    {copied === 'va-acct' ? 'Account number copied!' : inrDetails.accountNumber}
                  </button>
                  <button onClick={() => copy(inrDetails.ifsc, 'va-ifsc')} className="w-full font-mono text-sm text-emerald-200 bg-black/20 rounded-lg p-2.5 hover:text-white transition-colors">
                    {copied === 'va-ifsc' ? 'IFSC copied!' : inrDetails.ifsc}
                  </button>
                </div>
                <p className="text-[10px] text-white/40 leading-relaxed">Send INR to these details from any Indian banking app. Your balance is credited automatically once the provider verifies the payment — no manual step.</p>
              </div>
            )}
          </div>

          {/* INR payout entry point — all requests use the same guarded, idempotent modal */}
          <div className="glass-panel rounded-3xl p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-xl text-white flex items-center gap-2">
                <Banknote className="w-5 h-5 text-amber-400" /> Withdraw INR to Bank
              </h3>
              <button onClick={() => setShowWithdraw(true)} className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-xs font-bold text-white hover:bg-white/15">
                Open secure form
              </button>
            </div>
            {!inrRail?.payouts ? (
              <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                External INR payouts are not currently available. The form checks live credentials before it submits anything; no balance will be debited while the rail is unready.
              </p>
            ) : (
              <p className="text-sm text-white/50">
                Payout requests require your real profile contact details, recipient bank details, and a real postal address. An admin must verify Cashfree live credentials before the form will submit.
              </p>
            )}
            {payoutRecords.length > 0 && (
              <div className="mt-5 space-y-2">
                <p className="text-[10px] text-white/40 tracking-wider font-bold">MY WITHDRAWAL REQUESTS</p>
                {payoutRecords.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
                      <Banknote className="w-4 h-4 text-amber-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">₹{parseFloat(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} to {p.destination_account_masked}</p>
                      <p className="text-[11px] text-white/40">{new Date(p.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}{p.utr ? ` · UTR ${p.utr}` : ''}</p>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
                      p.status === 'succeeded' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : p.status === 'failed_refunded' || p.status === 'failed_unreserved' ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : p.status === 'reconciliation_required' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    }`}>
                      {p.status === 'succeeded' ? '✓ COMPLETED' : p.status === 'reconciliation_required' ? '⚑ RECONCILING' : p.status.startsWith('failed') ? '✕ FAILED — REFUNDED' : '○ PENDING'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── REAL rails readiness — no fake providers ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-1">Payment Rails</h3>
        <p className="text-xs text-white/40 mb-5">Live configuration state — verified against the server, never simulated</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rails.map((r, i) => (
            <motion.div
              key={r.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileHover={r.ready && r.action ? { y: -3 } : undefined}
              className={`rounded-2xl p-4 border flex flex-col gap-2 ${r.ready ? 'border-white/10 bg-white/3' : 'border-white/5 bg-white/2 opacity-80'}`}
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${r.color}15`, border: `1px solid ${r.color}35` }}>
                  <r.icon className="w-5 h-5" style={{ color: r.color }} />
                </div>
                {r.ready === null ? (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-white/30"><Loader2 className="w-3 h-3 animate-spin" /> CHECKING</span>
                ) : r.ready ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold text-emerald-300">● READY</span>
                ) : (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[9px] font-bold text-amber-300">○ NOT CONFIGURED</span>
                )}
              </div>
              <p className="font-bold text-white text-sm">{r.name}</p>
              <p className="text-xs text-white/40 flex-1">{r.desc}</p>
              {r.hint && <p className="text-[10px] text-white/30">{r.hint}</p>}
              {r.ready && r.action && (
                <button onClick={r.action} className="mt-1 px-3 py-2 rounded-lg bg-white/10 text-xs font-bold text-white hover:bg-white/15 flex items-center gap-1.5 w-fit">
                  {r.actionLabel === 'Send' && <Send className="w-3 h-3" />}
                  {r.actionLabel === 'Withdraw' && <Banknote className="w-3 h-3" />}
                  {r.actionLabel === 'Get details' && <Building2 className="w-3 h-3" />}
                  {r.actionLabel}
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Recent records — REAL, currency-scoped ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white">Recent Activity</h3>
        <p className="text-xs text-white/40 mt-0.5 mb-5">Real {currency} records from your VaultBank account</p>
        {currency === 'USD' && (accountLoading ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading real payments…</div>
        ) : usdRecent.length === 0 ? (
          <div className="py-4 text-sm text-white/40">No real payments yet — make a deposit or send money and it will show up here.</div>
        ) : (
          <div className="space-y-2">
            {usdRecent.map((t) => {
              const positive = t.type === 'credit' || t.amount > 0;
              const amt = Math.abs(t.amount);
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${positive ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/20'}`}>
                    {positive ? <ArrowDownRight className="w-4 h-4 text-emerald-300" /> : <ArrowUpRight className="w-4 h-4 text-rose-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{t.description || t.category}</p>
                    <p className="text-[11px] text-white/40">{t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} · {t.status}</p>
                  </div>
                  <p className={`font-bold text-sm ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {positive ? '+' : '-'}${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              );
            })}
          </div>
        ))}
        {currency === 'INR' && (inrState === 'loading' ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading INR records…</div>
        ) : inrState !== 'ready' || !inrWallet ? (
          <div className="py-4 text-sm text-white/40">{inrState === 'none' ? 'Open your INR wallet to see INR activity.' : 'No INR wallet loaded.'}</div>
        ) : inrWallet.transactions.length === 0 ? (
          <div className="py-4 text-sm text-white/40">No INR activity yet — receive INR or transfer from another VaultBank user.</div>
        ) : (
          <div className="space-y-2">
            {inrWallet.transactions.slice(0, 6).map((t) => {
              const positive = t.amount > 0;
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${positive ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/20'}`}>
                    {positive ? <ArrowDownRight className="w-4 h-4 text-emerald-300" /> : <ArrowUpRight className="w-4 h-4 text-rose-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{t.description || t.category}</p>
                    <p className="text-[11px] text-white/40">{t.date ? new Date(t.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : ''} · {t.status}</p>
                  </div>
                  <p className={`font-bold text-sm ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {positive ? '+' : '-'}₹{Math.abs(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              );
            })}
          </div>
        ))}
      </motion.div>

      {/* ── Send Money Modal ── */}
      <AnimatePresence>
        {showSend && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowSend(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                    <Send className="w-5 h-5 text-blue-300" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">Send {currency}</h3>
                    <p className="text-xs text-white/40">Instant internal transfer — same currency only</p>
                  </div>
                </div>
                <button onClick={() => setShowSend(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <div className="space-y-3">
                {currency === 'INR' && inrState !== 'ready' && (
                  <p className="text-xs text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">Open your INR wallet first to send INR.</p>
                )}
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">RECIPIENT — REAL VAULTBANK USERS</label>
                  {selected ? (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/30">
                      <Avatar name={selected.name} size="sm" ring={false} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-semibold truncate">{selected.name}</p>
                        <p className="text-[10px] text-white/40 truncate">{selected.accountNumber || selected.email}</p>
                      </div>
                      <button type="button" onClick={() => setSelected(null)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10">
                        <X className="w-3.5 h-3.5 text-white/60" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <UserSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                        <input
                          value={query} onChange={(e) => setQuery(e.target.value)}
                          placeholder={`Search by name, email or account number (${currency} account)…`}
                          className="w-full glass-input rounded-xl pl-10 pr-10 py-3 text-sm text-white"
                        />
                        {searching && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 animate-spin" />}
                      </div>
                      {results.length > 0 && (
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                          {results.map((r) => (
                            <button
                              key={r.id || r.email || r.name}
                              type="button"
                              onClick={() => { setSelected(r); setQuery(''); setResults([]); }}
                              className="w-full flex items-center gap-3 p-2.5 hover:bg-white/5 transition-colors text-left"
                            >
                              <Avatar name={r.name} size="xs" ring={false} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-white truncate">{r.name}</p>
                                <p className="text-[10px] text-white/40 truncate">{r.email}{r.accountNumber ? ` · ${r.accountNumber}` : ''}</p>
                              </div>
                              <Send className="w-3 h-3 text-cyan-400/60" />
                            </button>
                          ))}
                        </div>
                      )}
                      {query.trim().length >= 2 && !searching && results.length === 0 && (
                        <p className="mt-2 text-[10px] text-white/30 px-1">No match — paste a full email or account number (VB-…) instead.</p>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 font-display text-2xl">{curSymbol}</span>
                    <input
                      type="number" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full glass-input rounded-xl pl-10 pr-4 py-4 text-2xl font-display text-white"
                    />
                  </div>
                </div>
                {sendStatus === 'error' && (
                  <p className="text-xs text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">{sendMsg}</p>
                )}
                {sendStatus === 'success' && (
                  <p className="text-xs text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> {sendMsg}
                  </p>
                )}
                <button
                  onClick={executeSend}
                  disabled={sendStatus === 'sending' || !sendAmount || (!selected && query.trim().length < 2) || (currency === 'INR' && inrState !== 'ready')}
                  className="w-full py-4 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm glow-blue flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
                >
                  {sendStatus === 'sending' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  ) : sendStatus === 'success' ? (
                    <><Check className="w-4 h-4" /> Sent!</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Send {currency}</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keep the payout modal mounted while hidden so ambiguous outcomes retain the same idempotency key. */}
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} />
    </div>
  );
}
