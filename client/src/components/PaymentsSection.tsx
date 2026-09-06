import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Send, Download, Copy, Check, Eye, EyeOff, QrCode,
  ArrowUpRight, ArrowDownRight, Search,
  Bitcoin, Globe, Zap, X,
  Smartphone, Link2, ScanLine, Loader2, UserSearch, Banknote,
} from 'lucide-react';
import { digitalWallets, regionalPayments, cryptoWallets, availablePaymentMethods } from '../data';
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

type PaymentTab = 'digital' | 'regional' | 'crypto';

export default function PaymentsSection() {
  const [tab, setTab] = useState<PaymentTab>('digital');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showAddresses, setShowAddresses] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideBalances, setHideBalances] = useState(false);

  // REAL account data from the backend
  const { account, transactions, balance, loading: accountLoading } = useAccountData();
  const recentPayments = transactions.slice(0, 6);

  // REAL send-money state (live user search + real transfer)
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [results, setResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [sendMsg, setSendMsg] = useState('');
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Detect whether real Stripe keys are configured (LIVE vs SANDBOX)
  const [railMode, setRailMode] = useState<'live' | 'demo' | null>(null);
  useEffect(() => {
    api.stripeBalance()
      .then(r => setRailMode(r.mode === 'live' ? 'live' : 'demo'))
      .catch(() => setRailMode('demo'));
  }, []);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // LIVE search over REAL registered VaultBank users (debounced)
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
  };

  const executeSend = async () => {
    const recipient = selected ? (selected.accountNumber || selected.email || selected.name) : query.trim();
    if (!recipient || !sendAmount || parseFloat(sendAmount) <= 0) return;
    setSendStatus('sending');
    setSendMsg('');
    try {
      const isEmail = recipient.includes('@');
      const res = isEmail
        ? await api.sendMoney({ recipientEmail: recipient, amount: parseFloat(sendAmount) })
        : await api.sendMoney({ recipientAccountNumber: recipient, amount: parseFloat(sendAmount) });
      if (!res.success) throw new Error(res.message || 'Transfer failed.');
      setSendStatus('success');
      setSendMsg(`Real transfer of $${parseFloat(sendAmount).toFixed(2)} completed.`);
      setTimeout(resetSend, 2200);
    } catch (err: any) {
      setSendStatus('error');
      setSendMsg(err?.message || 'Transfer failed.');
    }
  };

  const filteredMethods = availablePaymentMethods.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  );

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
                  <p className="text-xs tracking-[0.3em] text-white/40 font-bold">DIGITAL PAYMENTS</p>
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
                <p className="font-display text-5xl lg:text-6xl text-white">
                  {hideBalances || accountLoading ? '••••••' : `$${(balance?.total ?? account?.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                </p>
                <p className="text-sm text-white/40 mt-1.5">
                  REAL balance · {account?.accountNumber ? `VaultBank •• ${account.accountNumber.slice(-4)}` : 'VaultBank account'}
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
                  onClick={() => setShowQR(true)}
                  className="px-4 py-3 rounded-xl glass-btn text-sm font-bold text-white/80 flex items-center gap-2"
                >
                  <QrCode className="w-4 h-4" /> My QR
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setShowAdd(true)}
                  className="px-5 py-3 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm flex items-center gap-2 glow-blue"
                >
                  <Plus className="w-4 h-4" /> Add Method
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
                <p className="text-xl font-bold text-white">{hideBalances ? '••••' : `$${(balance?.available ?? 0).toLocaleString()}`}</p>
                <p className="text-[10px] text-white/40 mt-0.5">real funds</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">PAYMENTS</p>
                </div>
                <p className="text-xl font-bold text-white">{transactions.length}</p>
                <p className="text-[10px] text-white/40 mt-0.5">real transactions</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Bitcoin className="w-3.5 h-3.5 text-amber-300" />
                  <p className="text-[10px] text-white/40 tracking-wider">PROVIDERS</p>
                </div>
                <p className="text-xl font-bold text-white">{availablePaymentMethods.length}</p>
                <p className="text-[10px] text-white/40 mt-0.5">available to link</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Quick action buttons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Send, label: 'Send Money', desc: 'To anyone', color: '#3b82f6', action: () => setShowSend(true) },
          { icon: Download, label: 'Request', desc: 'Get paid', color: '#10b981', action: () => setShowQR(true) },
          { icon: ScanLine, label: 'Scan & Pay', desc: 'QR payment', color: '#a855f7', action: () => setShowQR(true) },
          { icon: Banknote, label: 'Withdraw', desc: 'To your bank', color: '#f59e0b', action: () => setShowWithdraw(true) },
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

      {/* REAL recent payments — actual transactions from the backend */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white">Recent Payments</h3>
        <p className="text-xs text-white/40 mt-0.5 mb-5">Real transactions from your VaultBank account</p>
        {accountLoading ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading real payments…
          </div>
        ) : recentPayments.length === 0 ? (
          <div className="py-4 text-sm text-white/40">No real payments yet — make a deposit or send money and it will show up here.</div>
        ) : (
          <div className="space-y-2">
            {recentPayments.map((t) => {
              const positive = t.type === 'credit' || t.amount > 0;
              const amt = Math.abs(t.amount);
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${positive ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/20'}`}>
                    {positive ? <ArrowDownRight className="w-4 h-4 text-emerald-300" /> : <ArrowUpRight className="w-4 h-4 text-rose-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{t.description || t.category}</p>
                    <p className="text-[11px] text-white/40">
                      {t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''} · {t.status}
                    </p>
                  </div>
                  <p className={`font-bold text-sm ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {positive ? '+' : '-'}${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: 'digital' as PaymentTab, label: 'Digital Wallets', icon: Smartphone, count: digitalWallets.length },
          { id: 'regional' as PaymentTab, label: 'Regional Pay', icon: Globe, count: regionalPayments.length },
          { id: 'crypto' as PaymentTab, label: 'Crypto', icon: Bitcoin, count: cryptoWallets.length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${
              tab === t.id ? 'bg-linear-to-r from-cyan-400 to-blue-500 text-white glow-blue' : 'glass-btn text-white/60 hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />{t.label}
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${tab === t.id ? 'bg-white/20' : 'bg-white/5'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Digital Wallets Tab */}
      <AnimatePresence mode="wait">
        {tab === 'digital' && (
          <motion.div key="digital" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {digitalWallets.map((w, i) => (
                <motion.div
                  key={w.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  whileHover={{ y: -4, scale: 1.01 }}
                  onClick={() => setSelectedMethod(selectedMethod === w.id ? null : w.id)}
                  className="relative rounded-3xl p-5 cursor-pointer overflow-hidden border border-white/10"
                  style={{ background: `linear-gradient(145deg, ${w.brandColor}30, ${w.brandColor}10)` }}
                >
                  <div className="absolute inset-0 shimmer opacity-20" />
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg" style={{ background: w.brandColor, color: w.accentColor }}>
                        {w.name[0]}
                      </div>
                      {w.connected && (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold text-emerald-300">
                          <Check className="w-2.5 h-2.5" /> ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="font-bold text-white text-lg">{w.name}</p>
                    <p className="text-xs text-white/40 mb-3">{w.region}</p>
                    <p className="text-sm text-white/50 mb-3">Link to sync your real balance</p>

                    {selectedMethod === w.id && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 pt-4 border-t border-white/10 flex gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setShowSend(true); }} className="flex-1 py-2 rounded-lg bg-white/10 text-xs font-bold text-white flex items-center justify-center gap-1.5">
                          <Send className="w-3 h-3" /> Send
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); }} className="flex-1 py-2 rounded-lg bg-white/10 text-xs font-bold text-white flex items-center justify-center gap-1.5">
                          <Download className="w-3 h-3" /> Request
                        </button>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Regional Payments Tab */}
        {tab === 'regional' && (
          <motion.div key="regional" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {regionalPayments.map((r, idx) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  whileHover={{ y: -4, scale: 1.01 }}
                  className="glass-panel rounded-3xl p-5 cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: `${r.brandColor}20`, border: `1px solid ${r.brandColor}40` }}>
                        {r.emoji}
                      </div>
                      <div>
                        <p className="font-bold text-white">{r.name}</p>
                        <p className="text-[11px] text-white/40">{r.region}</p>
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded-full text-[9px] font-bold bg-white/5 border border-white/10 text-white/40">
                      ○ UNLINKED
                    </span>
                  </div>
                  <p className="text-sm text-white/50">
                    Link {r.name} to enable real {r.currency} payments
                  </p>
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                    <code className="text-[10px] text-white/40 font-mono">{r.handle}</code>
                    <button onClick={() => copy(r.handle, r.id)} className="text-white/30 hover:text-white">
                      {copied === r.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Crypto Tab */}
        {tab === 'crypto' && (
          <motion.div key="crypto" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="space-y-5">
            {/* Crypto grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {cryptoWallets.map((c, i) => {
                const positive = c.change >= 0;
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    onClick={() => setSelectedMethod(selectedMethod === c.id ? null : c.id)}
                    className="relative rounded-3xl p-5 cursor-pointer overflow-hidden border border-white/10"
                    style={{ background: `linear-gradient(145deg, ${c.color}25, transparent)` }}
                  >
                    <div className="absolute inset-0 shimmer opacity-20" />
                    <div className="relative z-10">
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: `${c.color}30`, border: `2px solid ${c.color}`, color: c.color }}>
                          {c.icon}
                        </div>
                        <span className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${positive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                          {positive ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                          {Math.abs(c.change)}%
                        </span>
                      </div>
                      <p className="font-bold text-white">{c.name}</p>
                      <p className="text-[11px] text-white/40 mb-3">{c.chain}</p>
                      <p className="font-display text-xl text-white">{c.symbol} <span className="text-xs text-white/40">{c.chain}</span></p>
                      <p className="text-sm text-white/50 mt-0.5">Link a real wallet to see holdings</p>

                      {selectedMethod === c.id && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 pt-4 border-t border-white/10">
                          <div className="flex items-center gap-1 mb-3">
                            <code className="text-[9px] text-white/40 font-mono flex-1 truncate">{c.address}</code>
                            <button onClick={(e) => { e.stopPropagation(); copy(c.address, c.id); }} className="text-white/40 hover:text-white">
                              {copied === c.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setShowSend(true); }} className="py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">Receive</button>
                            <button onClick={(e) => { e.stopPropagation(); setShowSend(true); }} className="py-2 rounded-lg bg-white/10 text-xs font-bold text-white">Send</button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Deposit addresses summary */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel rounded-3xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-xl text-white flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-amber-400" /> Deposit Addresses
                </h3>
                <button onClick={() => setShowAddresses(!showAddresses)} className="text-xs font-bold text-amber-400 hover:text-amber-300">
                  {showAddresses ? 'Hide' : 'Show All'}
                </button>
              </div>
              <AnimatePresence>
                {showAddresses && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-2">
                    {cryptoWallets.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold" style={{ background: `${c.color}25`, color: c.color, border: `1px solid ${c.color}50` }}>{c.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{c.symbol} · {c.chain}</p>
                          <code className="text-[11px] text-white/40 font-mono">{c.address}</code>
                        </div>
                        <button onClick={() => copy(c.address, c.id + '-addr')} className="text-white/40 hover:text-white">
                          {copied === c.id + '-addr' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              {!showAddresses && <p className="text-sm text-white/40">Tap "Show All" to reveal {cryptoWallets.length} wallet addresses for deposits.</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All Connected Methods Overview */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display text-xl text-white">All Payment Methods</h3>
            <p className="text-xs text-white/40 mt-0.5">{availablePaymentMethods.length} providers available to link</p>
          </div>
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 rounded-xl glass-btn text-xs font-bold text-white/70 hover:text-white flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Connect
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payment methods..."
            className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/30"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {filteredMethods.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              whileHover={{ y: -3, scale: 1.02 }}
              className="p-4 rounded-2xl border cursor-pointer transition-all flex flex-col items-center text-center"
              style={{
                background: m.connected ? `${m.color}12` : 'rgba(255,255,255,0.02)',
                borderColor: m.connected ? `${m.color}40` : 'rgba(255,255,255,0.05)',
              }}
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 font-bold text-xl"
                style={{ background: `${m.color}25`, border: `1px solid ${m.color}50` }}
              >
                {m.emoji || <span style={{ color: m.color }}>{m.name[0]}</span>}
              </div>
              <p className="font-bold text-white text-sm">{m.name}</p>
              <p className="text-[10px] text-white/40 mb-2">{m.category}</p>
              {m.connected ? (
                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400">
                  <Check className="w-2.5 h-2.5" /> Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400">
                  <Plus className="w-2.5 h-2.5" /> Connect
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── QR Code Modal ── */}
      <AnimatePresence>
        {showQR && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowQR(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl glass-panel p-8 text-center"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-display text-xl text-white">Receive Payment</h3>
                <button onClick={() => setShowQR(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              {/* QR Code */}
              <div className="relative w-56 h-56 mx-auto mb-6 rounded-3xl bg-white p-5">
                <div className="absolute inset-0 rounded-3xl shimmer opacity-50" />
                {/* Fake QR pattern */}
                <div className="w-full h-full grid grid-cols-12 gap-0.5">
                  {Array.from({ length: 144 }).map((_, i) => (
                    <div key={i} className={`rounded-[1px] ${Math.random() > 0.5 ? 'bg-black' : 'bg-transparent'}`} />
                  ))}
                </div>
                {/* Corner markers */}
                <div className="absolute top-4 left-4 w-10 h-10 border-[3px] border-black rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 bg-black rounded-sm" />
                </div>
                <div className="absolute top-4 right-4 w-10 h-10 border-[3px] border-black rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 bg-black rounded-sm" />
                </div>
                <div className="absolute bottom-4 left-4 w-10 h-10 border-[3px] border-black rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 bg-black rounded-sm" />
                </div>
              </div>

              <p className="text-sm text-white/60 mb-1">Scan or share your REAL account number</p>
              <p className="font-display text-lg text-gold mb-4">{account?.accountNumber || 'Loading…'}</p>

              <div className="flex gap-2">
                <button onClick={() => copy(account?.accountNumber || '', 'qr')} className="flex-1 py-3 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm glow-blue flex items-center justify-center gap-2">
                  {copied === 'qr' ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy ID</>}
                </button>
                <button className="px-4 py-3 rounded-xl glass-btn text-white/70"><Download className="w-4 h-4" /></button>
              </div>

              {/* Payment options */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-[10px] text-white/40 mb-2">ACCEPTED VIA</p>
                <div className="flex justify-center gap-2 flex-wrap">
                  {['🍎 Pay', 'G Pay', 'UPI', '₿ BTC', 'Ξ ETH', 'PayPal'].map(p => (
                    <span key={p} className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold text-white/60">{p}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                    <h3 className="font-display text-xl text-white">Send Money</h3>
                    <p className="text-xs text-white/40">Instant transfer</p>
                  </div>
                </div>
                <button onClick={() => setShowSend(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <div className="space-y-3">
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
                          placeholder="Search by name, email or account number…"
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
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 font-display text-2xl">$</span>
                    <input
                      type="number" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full glass-input rounded-xl pl-10 pr-4 py-4 text-2xl font-display text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['10', '25', '50', '100'].map(v => (
                    <button key={v} onClick={() => setSendAmount(v)} className="py-2 rounded-lg glass-btn text-xs text-white/70 hover:text-white">${v}</button>
                  ))}
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
                  disabled={sendStatus === 'sending' || !sendAmount || (!selected && query.trim().length < 2)}
                  className="w-full py-4 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 text-white font-bold text-sm glow-blue flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
                >
                  {sendStatus === 'sending' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending real money…</>
                  ) : sendStatus === 'success' ? (
                    <><Check className="w-4 h-4" /> Sent!</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Send Real Transfer</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Withdraw Modal — REAL bank payout ── */}
      <AnimatePresence>
        {showWithdraw && (
          <WithdrawModal isOpen={true} onClose={() => setShowWithdraw(false)} />
        )}
      </AnimatePresence>

      {/* ── Add Payment Method Modal ── */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowAdd(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl glass-panel p-6 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
                    <Plus className="w-5 h-5 text-cyan-300" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">Connect Payment Method</h3>
                    <p className="text-xs text-white/40">Add a new wallet or payment system</p>
                  </div>
                </div>
                <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input placeholder="Search payment methods..." className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/30" />
              </div>

              <div className="space-y-2">
                {availablePaymentMethods.filter(m => !m.connected).concat(availablePaymentMethods.filter(m => m.connected).slice(0, 4)).map((m, i) => (
                  <motion.div
                    key={m.id + i}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-white/3 border border-white/5 hover:border-cyan-500/30 transition-all cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-lg"
                      style={{ background: `${m.color}20`, border: `1px solid ${m.color}40`, color: m.color }}
                    >
                      {m.emoji || m.name[0]}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-white text-sm">{m.name}</p>
                      <p className="text-[11px] text-white/40">{m.category}</p>
                    </div>
                    {m.connected ? (
                      <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Active</span>
                    ) : (
                      <button className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25">Connect</button>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
