import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Send, Download, Check, Eye, EyeOff,
  ArrowUpRight, ArrowDownRight, Zap, X, Loader2, UserSearch, Banknote,
  Building2, ShieldCheck, IndianRupee, RefreshCw,
} from 'lucide-react';
import { useAccountData } from '../hooks/useAccountData';
import { api } from '../api';
import Avatar from './Avatar';
import { DirectUpiAdminReview } from './DirectUpiAdminReview';
import { DirectBankPayoutModal } from './DirectBankPayoutModal';
import { DirectBankPayoutAdminReview } from './DirectBankPayoutAdminReview';
import { BankTransferDepositPanel } from './BankTransferDepositPanel';
import { BankDepositAdminReview } from './BankDepositAdminReview';
import UsdAchPayoutPanel from './UsdAchPayoutPanel';
import ProductApplicationsAdminReview from './ProductApplicationsAdminReview';
import KycAdminReview from './KycAdminReview';

/** A real registered VaultBank user (from the backend directory). */
interface Recipient {
  id?: string;
  name: string;
  email?: string;
  accountNumber?: string | null;
}

/** A currency enabled for this deployment (from GET /api/currencies). */
interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  enabled: boolean;
  bankReceivingConfigured?: boolean;
}

type Currency = string;

interface RailsReadiness {
  usd: { bankTransferInstructions: boolean; internalTransfers: boolean; externalWithdrawals: boolean; achFileExport?: boolean; achCustomerAccessEnabled?: boolean; achFileExportReason?: string; achAutomaticTransfer?: boolean };
  inr: { directBankPayouts: boolean; directBankPayoutsAutoTransfer?: boolean; directBankPayoutsCustomerAccessEnabled?: boolean; directBankPayoutsReason?: string; bankTransferInstructions?: boolean; internalTransfers: boolean };
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

  // ── Enabled currencies (single source of truth: server registry) ──
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([
    { code: 'USD', name: 'US Dollar', symbol: '$', enabled: true },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹', enabled: true },
  ]);
  useEffect(() => {
    api.getCurrencies()
      .then((r) => {
        const list = Array.isArray(r.currencies)
          ? (r.currencies as CurrencyOption[]).filter((c) => c && c.enabled)
          : [];
        if (list.length) setCurrencies(list);
      })
      .catch(() => { /* keep the conservative USD/INR default */ });
  }, []);
  const currencyMeta = currencies.find((c) => c.code === currency);
  const currencySymbol = currencyMeta?.symbol || currency;

  // ── INR wallet state ──
  const [walletState, setWalletState] = useState<'idle' | 'loading' | 'none' | 'ready' | 'error'>('idle');
  const [wallet, setWallet] = useState<{ currency: string; account: { accountNumber: string; balance: number }; transactions: InrTransaction[] } | null>(null);
  const walletSeq = useRef(0);

  const loadWallet = async (code: string) => {
    const seq = ++walletSeq.current;
    setWalletState('loading');
    try {
      const walletRes = await api.getCurrencyWallet(code);
      if (seq !== walletSeq.current) return;
      if (walletRes.success && walletRes.account) {
        setWallet({ currency: code, account: walletRes.account, transactions: (walletRes.transactions as InrTransaction[]) || [] });
        setWalletState('ready');
      } else {
        setWallet(null);
        setWalletState('none');
      }
    } catch (err: any) {
      if (seq !== walletSeq.current) return;
      if (err?.status === 404) {
        setWallet(null);
        setWalletState('none');
      } else {
        setWalletState('error');
      }
    }
  };
  const loadInr = () => loadWallet('INR');
  const inrWallet = wallet?.currency === 'INR' ? wallet : null;
  const inrState = currency === 'INR' ? walletState : (inrWallet ? 'ready' : 'idle');

  useEffect(() => {
    if (currency === 'USD') return;
    if (wallet?.currency === currency && walletState === 'ready') return;
    loadWallet(currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // ── Open a zero-balance wallet in the selected currency ──
  const [openWalletStatus, setOpenWalletStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [openWalletMsg, setOpenWalletMsg] = useState('');
  const openWallet = async () => {
    setOpenWalletStatus('loading');
    setOpenWalletMsg('');
    try {
      const res = await api.openCurrencyAccount(currency);
      if (!res.success && !res.already) throw new Error(res.message || `Could not open your ${currency} wallet.`);
      await loadWallet(currency);
      setOpenWalletStatus('idle');
    } catch (err: any) {
      setOpenWalletStatus('error');
      setOpenWalletMsg(err?.message || `Could not open your ${currency} wallet.`);
    }
  };

  // One idempotent INR payout form is shared by all Withdraw buttons.
  const [showDirectBankPayout, setShowDirectBankPayout] = useState(false);

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
      if (currency !== 'USD') loadWallet(currency);
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
  const currentRole = String(api.getUser()?.role || '').trim().toLowerCase();
  const isAdminUser = currentRole === 'admin' || currentRole === 'super_admin';
  const canUseDirectBankPayout = !!inrRail?.directBankPayouts && (isAdminUser || inrRail.directBankPayoutsCustomerAccessEnabled === true);
  const canOpenBankDeposit = currency === 'USD' || currencyMeta?.bankReceivingConfigured === true;
  const canAddMoney = canOpenBankDeposit;

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
      key: 'bankusd', name: 'Bank Transfer (USD)', desc: 'Unique reference + manual statement verification',
      ready: usdRail ? usdRail.bankTransferInstructions : null, icon: Building2, color: '#f59e0b',
      hint: usdRail?.bankTransferInstructions ? 'Instructions available in Deposits' : 'Not configured — receiving account env required',
    },
    {
      key: 'directbankpayout', name: 'VaultBank Manual Bank Payout', desc: 'Funds reserved; operator sends via bank and reconciles the statement',
      ready: inrRail ? canUseDirectBankPayout : null, icon: Banknote, color: '#d97706',
      hint: !inrRail?.directBankPayouts
        ? 'Not configured — encryption key and manual rail flag required'
        : (canUseDirectBankPayout
          ? 'Available for this account · operator must send manually and confirm the bank UTR'
          : 'Admin-only pilot — customer access is disabled'),
      action: canUseDirectBankPayout ? () => { setCurrency('INR'); setShowDirectBankPayout(true); } : undefined, actionLabel: 'Open',
    },
    {
      key: 'usdach', name: 'USD ACH File Export', desc: 'Bank-compatible credit file; file export is not settlement',
      ready: usdRail ? (usdRail.achFileExport ?? false) : null, icon: Building2, color: '#64748b',
      hint: usdRail?.achFileExport ? 'ODFI profile configured; operator upload and bank reconciliation still required' : 'Disabled — authorized ODFI profile and encryption key required',
    },
    {
      key: 'usdext', name: 'USD External Withdrawals', desc: 'Outbound USD to a bank account',
      ready: usdRail ? usdRail.externalWithdrawals : null, icon: Banknote, color: '#64748b',
      hint: 'Automatic external USD settlement is not enabled',
    },
  ];

  const visibleRails = rails;

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
                </div>
                {/* Currency selector — every operator-enabled currency */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {currencies.map(c => (
                    <button
                      key={c.code}
                      onClick={() => setCurrency(c.code)}
                      className={`px-4 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        currency === c.code
                          ? 'bg-linear-to-r from-cyan-400 to-blue-500 text-white border-transparent glow-blue'
                          : 'glass-btn text-white/50 border-white/10 hover:text-white'
                      }`}
                    >
                      {c.code === 'INR'
                        ? <span className="flex items-center gap-1"><IndianRupee className="w-3 h-3" /> INR</span>
                        : `${c.symbol} ${c.code}`}
                    </button>
                  ))}
                </div>
                {currency === 'USD' ? (
                  <p className="font-display text-5xl lg:text-6xl text-white">
                    {hideBalances || accountLoading ? '••••••' : `$${(balance?.total ?? account?.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                  </p>
                ) : (
                  <p className="font-display text-5xl lg:text-6xl text-white">
                    {hideBalances ? '••••••' : wallet?.currency === currency && walletState === 'ready'
                      ? `${currencySymbol}${wallet.account.balance.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2 })}`
                      : walletState === 'loading' ? '…' : '—'}
                  </p>
                )}
                <p className="text-sm text-white/40 mt-1.5">
                  {currency === 'USD'
                    ? `REAL balance · ${account?.accountNumber ? `VaultBank •• ${account.accountNumber.slice(-4)}` : 'VaultBank account'}`
                    : wallet?.currency === currency && walletState === 'ready'
                      ? `REAL ${currency} balance · VaultBank •• ${wallet.account.accountNumber.slice(-4)}`
                      : `${currency} wallet` + (walletState === 'none' ? ' — not opened yet' : '')}
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
                    if (canOpenBankDeposit && onOpenModal) onOpenModal('deposit');
                  }}
                  disabled={!canAddMoney}
                  title={!canAddMoney ? `${currency} receiving is not configured yet` : undefined}
                  className="px-5 py-3 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm flex items-center gap-2 glow-blue disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Add Money
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => { setCurrency('INR'); if (canUseDirectBankPayout) setShowDirectBankPayout(true); }}
                  disabled={!canUseDirectBankPayout}
                  className="px-4 py-3 rounded-xl glass-btn text-sm font-bold text-white/80 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  title={!canUseDirectBankPayout ? 'Manual payout is restricted to the admin pilot until customer access is authorized' : 'USD external bank payouts are not available'}
                >
                  <Download className="w-4 h-4" /> Withdraw INR
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
                    : wallet?.currency === currency && walletState === 'ready'
                      ? `${currencySymbol}${wallet.account.balance.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US')}`
                      : '—'}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">real funds</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">RECORDS</p>
                </div>
                <p className="text-xl font-bold text-white">
                  {currency === 'USD' ? transactions.length : (wallet?.currency === currency ? wallet.transactions.length : 0)}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">real transactions</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">BANK RAILS READY</p>
                </div>
                <p className="text-xl font-bold text-white">
                  {readiness
                    ? [...Object.values(readiness.usd), ...Object.values(readiness.inr)].filter(Boolean).length
                    : '…'}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">configured bank options</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Quick action buttons only offer rails this account can access. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Send, label: 'Send Money', desc: `VaultBank user (${currency})`, color: '#3b82f6', action: () => setShowSend(true) },
          { icon: Plus, label: 'Add Money', desc: currency === 'USD' ? 'Deposits & rails' : (canOpenBankDeposit ? `Bank transfer (${currency})` : 'Receiving rail not enabled'), color: '#06b6d4', action: () => { if (canOpenBankDeposit && onOpenModal) onOpenModal('deposit'); } },
          ...(canUseDirectBankPayout ? [{ icon: Banknote, label: 'Withdraw INR', desc: 'VaultBank manual bank payout', color: '#f59e0b', action: () => { setCurrency('INR'); setShowDirectBankPayout(true); } }] : []),
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

      {/* ── Non-INR currency wallet: explicit opt-in, zero balance ── */}
      {currency !== 'USD' && currency !== 'INR' && walletState === 'none' && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-3xl p-6">
          <h3 className="font-display text-xl text-white mb-1 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-cyan-300" /> Open your {currency} wallet
          </h3>
          <p className="text-sm text-white/50 mb-4">
            A separate, zero-balance {currency} account. Your USD balance is untouched, and nothing is converted — {currency} arrives only from a verified {currency} transfer.
          </p>
          <button onClick={openWallet} disabled={openWalletStatus === 'loading'}
            className="px-5 py-3 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
            {openWalletStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Open {currency} wallet
          </button>
          {openWalletStatus === 'error' && <p className="text-xs text-rose-400 font-bold mt-3">{openWalletMsg}</p>}
        </motion.div>
      )}

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
                <button onClick={openWallet} disabled={openWalletStatus === 'loading'}
                  className="px-5 py-3 rounded-xl bg-linear-to-r from-emerald-400 to-teal-500 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50">
                  {openWalletStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Open INR Wallet
                </button>
                {openWalletStatus === 'error' && <p className="text-xs text-rose-400 font-bold mt-3">{openWalletMsg}</p>}
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

          {/* INR payout entry point — all requests use the same guarded, idempotent modal */}
          <div className="glass-panel rounded-3xl p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-xl text-white flex items-center gap-2">
                <Banknote className="w-5 h-5 text-amber-400" /> Withdraw INR to Bank
              </h3>
              <button onClick={() => setShowDirectBankPayout(true)} className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-xs font-bold text-white hover:bg-white/15">
                Open VaultBank manual form
              </button>
            </div>
            {!inrRail?.directBankPayouts ? (
              <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                VaultBank manual payouts are disabled or the destination encryption key is missing. No funds will be reserved until the operator explicitly enables the rail.
              </p>
            ) : (
              <p className="text-sm text-white/50">
                This VaultBank-owned path reserves funds atomically. The operator sends the transfer from the bank and confirms its official statement UTR; no processor API sends the money.
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* VaultBank-owned bank-transfer instruction + manual statement reconciliation. */}
      <BankTransferDepositPanel />
      <UsdAchPayoutPanel visible={currency === 'USD'} />

      {/* ── REAL rails readiness — no fake providers ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-1">Banking Rails</h3>
        <p className="text-xs text-white/40 mb-5">VaultBank-native ledger and settlement workflows. External bank settlement is shown only when its receiving details and reconciliation controls are configured.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleRails.map((r, i) => (
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
        {currency !== 'USD' && (walletState === 'loading' ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading {currency} records…</div>
        ) : !wallet || wallet.currency !== currency || walletState !== 'ready' ? (
          <div className="py-4 text-sm text-white/40">{walletState === 'none' ? `Open your ${currency} wallet to see ${currency} activity.` : `No ${currency} wallet loaded.`}</div>
        ) : wallet.transactions.length === 0 ? (
          <div className="py-4 text-sm text-white/40">No {currency} activity yet — receive {currency} or transfer from another VaultBank user.</div>
        ) : (
          <div className="space-y-2">
            {wallet.transactions.slice(0, 6).map((t) => {
              const positive = t.amount > 0;
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${positive ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/20'}`}>
                    {positive ? <ArrowDownRight className="w-4 h-4 text-emerald-300" /> : <ArrowUpRight className="w-4 h-4 text-rose-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{t.description || t.category}</p>
                    <p className="text-[11px] text-white/40">{t.date ? new Date(t.date).toLocaleDateString(currency === 'INR' ? 'en-IN' : 'en-US', { month: 'short', day: 'numeric' }) : ''} · {t.status}</p>
                  </div>
                  <p className={`font-bold text-sm ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {positive ? '+' : '-'}{currencySymbol}{Math.abs(t.amount).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2 })}
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
                {currency !== 'USD' && (walletState !== 'ready' || wallet?.currency !== currency) && (
                  <p className="text-xs text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">Open your {currency} wallet first to send {currency}.</p>
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
                  disabled={sendStatus === 'sending' || !sendAmount || (!selected && query.trim().length < 2) || (currency !== 'USD' && (walletState !== 'ready' || wallet?.currency !== currency))}
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
      <DirectBankPayoutModal
        isOpen={showDirectBankPayout}
        onClose={() => setShowDirectBankPayout(false)}
        accountState={inrState}
        onOpenInrAccount={openWallet}
      />
      {isAdminUser && (
        <section aria-label="Legacy UPI reconciliation" className="space-y-2">
          <div>
            <h3 className="text-sm font-bold text-white/80">Legacy UPI reconciliation</h3>
            <p className="mt-1 text-xs text-white/40">New UPI deposits are retired. This admin-only queue is retained to inspect and reconcile existing historical requests; it cannot create new deposits.</p>
          </div>
          <DirectUpiAdminReview />
        </section>
      )}
      {((api.getUser()?.role === 'admin') || (api.getUser()?.role === 'super_admin')) && <DirectBankPayoutAdminReview />}
      {((api.getUser()?.role === 'admin') || (api.getUser()?.role === 'super_admin')) && <BankDepositAdminReview />}
      {((api.getUser()?.role === 'admin') || (api.getUser()?.role === 'super_admin')) && <ProductApplicationsAdminReview />}
      {((api.getUser()?.role === 'admin') || (api.getUser()?.role === 'super_admin')) && <KycAdminReview />}
    </div>
  );
}
