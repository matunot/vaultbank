import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mountain, Shield, Lock, Eye, EyeOff, Copy, Check, Send, Plus, X,
  Sparkles, Award, ChevronRight, Fingerprint, KeyRound,
  Globe, ArrowUpRight, ArrowDownRight, Crown, ShieldCheck, Zap, Cpu, Network,
} from 'lucide-react';
import { swissAccounts, swissServices, preciousMetals, stealthAddresses, privacyTiers, anonymousTransfers } from '../data';

type Tab = 'accounts' | 'metals' | 'services' | 'anonymous';

export default function SwissSection() {
  const [tab, setTab] = useState<Tab>('accounts');
  const [revealed, setRevealed] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [showAnonSend, setShowAnonSend] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string>('Stealth');
  const [anonAmount, setAnonAmount] = useState('5000');
  const [anonRecipient, setAnonRecipient] = useState('');
  const [sendStatus, setSendStatus] = useState<'idle' | 'verifying' | 'routing' | 'completed'>('idle');

  const totalSwissAssets = swissAccounts.reduce((s, a) => s + a.balance, 0);
  const totalMetalsValue = preciousMetals.reduce((s, m) => s + m.value, 0);
  const totalAnonSent = anonymousTransfers.reduce((s, t) => s + t.amount, 0);
  const grandTotal = totalSwissAssets + totalMetalsValue;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleAnonSend = async () => {
    if (!anonRecipient || !anonAmount) return;
    setSendStatus('verifying');
    await new Promise(r => setTimeout(r, 1000));
    setSendStatus('routing');
    await new Promise(r => setTimeout(r, 1500));
    setSendStatus('completed');
    setTimeout(() => {
      setSendStatus('idle');
      setShowAnonSend(false);
      setAnonRecipient('');
      setAnonAmount('5000');
    }, 1800);
  };

  const tierObj = useMemo(() => privacyTiers.find(p => p.tier === selectedTier), [selectedTier]);
  const anonFee = useMemo(() => (parseFloat(anonAmount) || 0) * (tierObj?.fee || 0) / 100, [anonAmount, tierObj]);

  return (
    <div className="space-y-5">
      {/* ── Hero: Swiss Wealth ── */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl overflow-hidden iridescent-border"
      >
        <div className="relative p-6 lg:p-10 overflow-hidden">
          {/* Swiss flag accent */}
          <div className="absolute inset-0 bg-gradient-to-br from-red-600/10 via-transparent to-red-600/5" />
          <div className="absolute inset-0 glass opacity-50" />
          {/* Mountain decoration */}
          <div className="absolute -top-10 -right-10 opacity-10">
            <Mountain className="w-80 h-80 text-white" strokeWidth={1} />
          </div>
          {/* Swiss cross overlay */}
          <div className="absolute top-8 right-8 w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center shadow-2xl shadow-red-600/40">
            <div className="relative w-7 h-7">
              <div className="absolute left-1/2 -translate-x-1/2 top-0 w-2 h-7 bg-white rounded-sm" />
              <div className="absolute top-1/2 -translate-y-1/2 left-0 w-7 h-2 bg-white rounded-sm" />
            </div>
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <motion.div
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              >
                <Mountain className="w-7 h-7 text-red-400" />
              </motion.div>
              <div>
                <p className="text-xs tracking-[0.4em] text-red-300/80 font-bold">SWISS PRIVATE BANK</p>
                <p className="text-sm text-white/40">Zurich • Geneva • Lugano • Basel</p>
              </div>
            </div>

            <p className="font-display text-5xl lg:text-7xl text-gold mt-4">
              ${(grandTotal / 1_000_000).toFixed(2)}M
            </p>
            <p className="text-sm text-white/40 mt-1">Total assets under Swiss protection</p>

            <div className="flex flex-wrap items-center gap-3 mt-5">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-red-500/30">
                <Shield className="w-3.5 h-3.5 text-red-300" />
                <span className="text-xs font-bold text-red-200">Bank Secrecy Act</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-amber-500/30">
                <Crown className="w-3.5 h-3.5 text-amber-300" />
                <span className="text-xs font-bold text-amber-200">PRIVATE CLIENT</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/30">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                <span className="text-xs font-bold text-emerald-200">CHF Insured</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-7">
              <div className="glass-btn rounded-xl p-4">
                <p className="text-[10px] text-white/40 tracking-wider">CASH ASSETS</p>
                <p className="text-2xl font-display text-white mt-1">${(totalSwissAssets / 1_000_000).toFixed(2)}M</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <p className="text-[10px] text-white/40 tracking-wider">PRECIOUS METALS</p>
                <p className="text-2xl font-display text-amber-300 mt-1">${(totalMetalsValue / 1_000_000).toFixed(2)}M</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <p className="text-[10px] text-white/40 tracking-wider">ACCOUNTS</p>
                <p className="text-2xl font-display text-white mt-1">{swissAccounts.length}</p>
              </div>
              <div className="glass-btn rounded-xl p-4">
                <p className="text-[10px] text-white/40 tracking-wider">JURISDICTIONS</p>
                <p className="text-2xl font-display text-white mt-1">4</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6 flex-wrap">
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowOpen(true)}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-sm shadow-lg shadow-red-500/30"
              >
                <Plus className="w-4 h-4" /> Open Numbered Account
              </motion.button>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowAnonSend(true)}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm glow-amber"
              >
                <Fingerprint className="w-4 h-4" /> Anonymous Transfer
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: 'accounts' as Tab,  label: 'Numbered Accounts', icon: KeyRound, count: swissAccounts.length },
          { id: 'metals' as Tab,    label: 'Precious Metals',    icon: Award,    count: preciousMetals.length },
          { id: 'anonymous' as Tab, label: 'Anonymous Transfers', icon: Fingerprint, count: anonymousTransfers.length },
          { id: 'services' as Tab,  label: 'Premium Services',   icon: Crown,    count: swissServices.length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              tab === t.id ? 'bg-red-500 text-white shadow-lg shadow-red-500/30' : 'glass-btn text-white/60 hover:text-white'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${tab === t.id ? 'bg-white/20' : 'bg-white/10 text-white/40'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        {/* ── Numbered Accounts ── */}
        {tab === 'accounts' && (
          <motion.div
            key="accounts"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {swissAccounts.map((acc, i) => {
              const isRevealed = revealed === acc.id;
              return (
                <motion.div
                  key={acc.id}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="glass-panel rounded-3xl p-6 relative overflow-hidden"
                  whileHover={{ y: -2 }}
                >
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20" style={{ background: acc.color }} />

                  <div className="relative z-10 flex flex-col lg:flex-row gap-5">
                    {/* Left: Account ID */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="text-3xl">{acc.flag}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-white text-lg">{acc.nickname}</p>
                            {acc.encrypted && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold text-emerald-300 flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" /> ENCRYPTED
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-white/40 mt-0.5">{acc.established} • {acc.type} Account</p>
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/8 mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] text-white/40 tracking-wider font-semibold">ACCOUNT NUMBER</p>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setRevealed(isRevealed ? null : acc.id)} className="p-1 rounded hover:bg-white/10">
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5 text-white/60" /> : <Eye className="w-3.5 h-3.5 text-white/60" />}
                            </button>
                            <button onClick={() => handleCopy(acc.number)} className="p-1 rounded hover:bg-white/10">
                              {copied === acc.number ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/60" />}
                            </button>
                          </div>
                        </div>
                        <p className="font-mono text-lg tracking-[0.25em] text-white">
                          {isRevealed ? acc.number : acc.number.replace(/[0-9]/g, '•')}
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                          <p className="text-[9px] text-white/40 tracking-wider">PRIVACY</p>
                          <p className="text-xs font-bold text-red-300 mt-0.5">{acc.privacy}</p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                          <p className="text-[9px] text-white/40 tracking-wider">INTEREST</p>
                          <p className="text-xs font-bold text-emerald-400 mt-0.5">{acc.interest}%</p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                          <p className="text-[9px] text-white/40 tracking-wider">CURRENCY</p>
                          <p className="text-xs font-bold text-white mt-0.5">{acc.currency}</p>
                        </div>
                      </div>
                    </div>

                    {/* Right: Balance */}
                    <div className="lg:w-72 flex flex-col justify-between">
                      <div className="text-right">
                        <p className="text-[10px] text-white/40 tracking-wider">BALANCE</p>
                        <p className="font-display text-4xl text-gold mt-1">
                          {isRevealed
                            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: acc.currency }).format(acc.balance)
                            : '••••••'}
                        </p>
                        <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1 justify-end">
                          <ArrowUpRight className="w-3 h-3" /> +${((acc.balance * acc.interest) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}/yr
                        </p>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button className="flex-1 py-2.5 rounded-xl glass-btn text-xs font-bold text-white/70 flex items-center justify-center gap-1.5">
                          <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" /> Deposit
                        </button>
                        <button className="flex-1 py-2.5 rounded-xl glass-btn text-xs font-bold text-white/70 flex items-center justify-center gap-1.5">
                          <Send className="w-3.5 h-3.5 text-amber-400" /> Transfer
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* ── Precious Metals ── */}
        {tab === 'metals' && (
          <motion.div
            key="metals"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {preciousMetals.map((m, i) => (
              <motion.div
                key={m.metal}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ y: -4 }}
                className="glass-panel rounded-3xl p-6 relative overflow-hidden"
              >
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-30" style={{ background: m.color }} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: `${m.color}30`, border: `1px solid ${m.color}60` }}>
                        <Award className="w-6 h-6" style={{ color: m.color }} />
                      </div>
                      <div>
                        <p className="font-bold text-white text-lg">{m.metal}</p>
                        <p className="text-[11px] text-white/40 font-mono">{m.symbol} • Vault {m.vault}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${m.change > 0 ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'}`}>
                      {m.change > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(m.change)}%
                    </div>
                  </div>

                  <p className="font-display text-3xl text-gold">${m.value.toLocaleString()}</p>
                  <p className="text-xs text-white/40 mt-1">{m.weight.toLocaleString()} {m.unit} @ ${m.rate.toLocaleString()}/{m.unit}</p>

                  <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                      <Shield className="w-3 h-3" />
                      Physical bullion • Insured
                    </div>
                    <button className="text-xs font-bold text-amber-300 hover:text-amber-200 flex items-center gap-1">
                      Trade <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* ── Anonymous Transfers ── */}
        {tab === 'anonymous' && (
          <motion.div
            key="anonymous"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-5"
          >
            {/* Privacy Tier Showcase */}
            <div className="glass-panel rounded-3xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-display text-xl text-white">Privacy Tiers</h3>
                  <p className="text-xs text-white/40 mt-0.5">Choose your level of anonymity</p>
                </div>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setShowAnonSend(true)}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm flex items-center gap-2 glow-amber"
                >
                  <Fingerprint className="w-4 h-4" /> Send Anonymously
                </motion.button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {privacyTiers.map((p, i) => (
                  <motion.div
                    key={p.tier}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    onClick={() => { setSelectedTier(p.tier); setShowAnonSend(true); }}
                    className={`relative p-4 rounded-2xl cursor-pointer border transition-all overflow-hidden ${
                      selectedTier === p.tier
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15'
                    }`}
                  >
                    {p.tier === 'Untraceable' && (
                      <div className="absolute inset-0 shimmer opacity-40" />
                    )}
                    <div className="relative z-10">
                      <div className="text-3xl mb-2">{p.icon}</div>
                      <p className="font-bold text-white text-sm">{p.tier}</p>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-white/40">
                        <Zap className="w-2.5 h-2.5" /> {p.speed}
                      </div>
                      <div className="mt-3 pb-3 border-b border-white/5">
                        <p className="text-[10px] text-white/40 tracking-wider">FEE</p>
                        <p className="font-display text-xl mt-0.5" style={{ color: p.color }}>{p.fee}%</p>
                      </div>
                      <div className="mt-3 space-y-1">
                        {p.features.map((f, j) => (
                          <div key={j} className="flex items-start gap-1.5 text-[10px] text-white/60">
                            <Check className="w-2.5 h-2.5 text-emerald-400 mt-0.5 flex-shrink-0" />{f}
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Stealth Addresses */}
            <div className="glass-panel rounded-3xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-display text-xl text-white">Stealth Addresses</h3>
                  <p className="text-xs text-white/40 mt-0.5">Untraceable recipients</p>
                </div>
                <button className="text-xs font-bold text-amber-300 hover:text-amber-200 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add Address
                </button>
              </div>
              <div className="space-y-2">
                {stealthAddresses.map((s, i) => (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    whileHover={{ x: 4 }}
                    onClick={() => { setAnonRecipient(s.address); setShowAnonSend(true); }}
                    className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/15 cursor-pointer transition-all"
                  >
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${s.color}20`, border: `1px solid ${s.color}40` }}>
                      <Fingerprint className="w-5 h-5" style={{ color: s.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-white text-sm">{s.alias}</p>
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: `${s.color}20`, color: s.color, border: `1px solid ${s.color}40` }}>{s.tier}</span>
                      </div>
                      <p className="text-[11px] text-white/40 font-mono mt-0.5">{s.address}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-white/40">Last used</p>
                      <p className="text-xs font-bold text-white/70">{s.lastUsed}</p>
                    </div>
                    <Send className="w-4 h-4 text-white/40" />
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Anonymous Transfer History */}
            <div className="glass-panel rounded-3xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-display text-xl text-white">Hidden Transfers</h3>
                  <p className="text-xs text-white/40 mt-0.5">${totalAnonSent.toLocaleString()} sent anonymously</p>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/30">
                  <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span>
                  <span className="text-xs font-bold text-emerald-300">SECURE</span>
                </div>
              </div>
              <div className="space-y-2">
                {anonymousTransfers.map((tx, i) => {
                  const tier = privacyTiers.find(p => p.tier === tx.tier);
                  return (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.04)' }}
                      className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5 transition-all"
                    >
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl" style={{ background: `${tier?.color}20`, border: `1px solid ${tier?.color}40` }}>
                        {tier?.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs text-white/80">{tx.id}</p>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: `${tier?.color}20`, color: tier?.color }}>{tx.tier}</span>
                        </div>
                        <p className="text-[11px] text-white/40 font-mono mt-0.5">→ {tx.recipient}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-white text-sm">${tx.amount.toLocaleString()}</p>
                        <p className="text-[10px] text-white/40">Fee ${tx.fee} • {tx.hops} hops</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Premium Services ── */}
        {tab === 'services' && (
          <motion.div
            key="services"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {swissServices.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -3 }}
                className={`glass-panel rounded-3xl p-5 cursor-pointer transition-all relative overflow-hidden ${
                  s.active ? '' : 'opacity-60'
                }`}
              >
                {s.badge && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-400/20 border border-amber-400/40 text-amber-300">
                    {s.badge}
                  </span>
                )}
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                    {s.icon}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white">{s.name}</p>
                    <p className="text-xs text-white/50 mt-1 leading-relaxed">{s.desc}</p>
                    <button className={`mt-3 text-xs font-bold flex items-center gap-1 ${s.active ? 'text-emerald-400 hover:text-emerald-300' : 'text-amber-400 hover:text-amber-300'}`}>
                      {s.active ? 'Manage Service' : 'Activate'} <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Anonymous Transfer Modal ── */}
      <AnimatePresence>
        {showAnonSend && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => sendStatus === 'idle' && setShowAnonSend(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl glass-panel p-6 relative overflow-hidden"
            >
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-amber-500/20 rounded-full blur-3xl" />

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}>
                      <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                        <Fingerprint className="w-5 h-5 text-amber-300" />
                      </div>
                    </motion.div>
                    <div>
                      <h3 className="font-display text-xl text-white">Anonymous Transfer</h3>
                      <p className="text-[10px] text-emerald-400 font-bold tracking-wider">END-TO-END ENCRYPTED</p>
                    </div>
                  </div>
                  {sendStatus === 'idle' && (
                    <button onClick={() => setShowAnonSend(false)} className="rounded-xl p-2 glass-btn hover:bg-white/10">
                      <X className="w-4 h-4 text-white/60" />
                    </button>
                  )}
                </div>

                {sendStatus === 'idle' && (
                  <div className="space-y-4">
                    {/* Privacy Tier Selector */}
                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">PRIVACY LEVEL</label>
                      <div className="grid grid-cols-4 gap-2">
                        {privacyTiers.map(p => (
                          <button
                            key={p.tier}
                            onClick={() => setSelectedTier(p.tier)}
                            className={`p-3 rounded-xl border transition-all ${
                              selectedTier === p.tier
                                ? 'border-amber-500/40 bg-amber-500/10 scale-[1.02]'
                                : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="text-xl">{p.icon}</div>
                            <p className="text-[10px] font-bold mt-1" style={{ color: p.color }}>{p.tier}</p>
                            <p className="text-[9px] text-white/40 mt-0.5">{p.fee}%</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Recipient */}
                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">STEALTH ADDRESS</label>
                      <div className="relative">
                        <Network className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400" />
                        <input
                          value={anonRecipient}
                          onChange={(e) => setAnonRecipient(e.target.value)}
                          placeholder="0xA8B...3F2c or CH-X-1847"
                          className="w-full glass-input rounded-xl pl-10 pr-3 py-3 text-sm font-mono text-white"
                        />
                      </div>
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT (USD)</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400 font-display text-xl">$</span>
                        <input
                          type="number"
                          value={anonAmount}
                          onChange={(e) => setAnonAmount(e.target.value)}
                          className="w-full glass-input rounded-xl pl-9 pr-4 py-3 text-xl font-display text-white"
                        />
                      </div>
                    </div>

                    {/* Fee Summary */}
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div><p className="text-[9px] text-white/40 tracking-wider">AMOUNT</p><p className="text-base font-bold text-white">${parseFloat(anonAmount || '0').toLocaleString()}</p></div>
                        <div><p className="text-[9px] text-white/40 tracking-wider">FEE ({tierObj?.fee}%)</p><p className="text-base font-bold text-rose-300">${anonFee.toFixed(2)}</p></div>
                        <div><p className="text-[9px] text-white/40 tracking-wider">TOTAL</p><p className="text-base font-bold text-amber-300">${(parseFloat(anonAmount || '0') + anonFee).toFixed(2)}</p></div>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-emerald-200/80 leading-relaxed">
                        <span className="font-bold text-emerald-200">{tierObj?.tier}</span> mode • Routes through {tierObj?.tier === 'Untraceable' ? '7' : tierObj?.tier === 'Stealth' ? '5' : tierObj?.tier === 'Private' ? '3' : '1'} nodes • Expected: {tierObj?.speed}
                      </div>
                    </div>

                    <button
                      onClick={handleAnonSend}
                      disabled={!anonRecipient || !anonAmount}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold flex items-center justify-center gap-2 glow-amber disabled:opacity-50"
                    >
                      <Fingerprint className="w-4 h-4" /> Execute Anonymous Transfer
                    </button>
                  </div>
                )}

                {/* Status: Verifying */}
                {sendStatus === 'verifying' && (
                  <div className="py-10 text-center">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }} className="inline-block">
                      <Cpu className="w-16 h-16 text-amber-400" />
                    </motion.div>
                    <p className="font-bold text-white text-lg mt-4">Verifying Identity</p>
                    <p className="text-xs text-white/40 mt-1">Zero-knowledge proof generation...</p>
                  </div>
                )}

                {/* Status: Routing */}
                {sendStatus === 'routing' && (
                  <div className="py-10 text-center">
                    <div className="flex items-center justify-center gap-3 mb-4">
                      {[...Array(tierObj?.tier === 'Untraceable' ? 7 : 5)].map((_, i) => (
                        <motion.div
                          key={i}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: i * 0.15, duration: 0.3 }}
                          className="w-3 h-3 rounded-full bg-amber-400"
                          style={{ boxShadow: '0 0 10px rgba(245,158,11,0.6)' }}
                        />
                      ))}
                    </div>
                    <p className="font-bold text-white text-lg">Routing Through Network</p>
                    <p className="text-xs text-white/40 mt-1">Bouncing through {tierObj?.tier === 'Untraceable' ? '7' : '5'} nodes...</p>
                  </div>
                )}

                {/* Status: Completed */}
                {sendStatus === 'completed' && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="py-10 text-center">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}>
                      <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 mx-auto flex items-center justify-center">
                        <Check className="w-12 h-12 text-emerald-400" strokeWidth={3} />
                      </div>
                    </motion.div>
                    <p className="font-display text-2xl text-emerald-300 mt-4">Transfer Sent</p>
                    <p className="text-xs text-white/40 mt-2">Transaction is now untraceable</p>
                    <p className="font-mono text-[10px] text-white/30 mt-3">TX-{Math.random().toString(36).slice(2, 8).toUpperCase()}</p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Open Numbered Account Modal ── */}
      <AnimatePresence>
        {showOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowOpen(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                    <Mountain className="w-5 h-5 text-red-300" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">Open Numbered Account</h3>
                    <p className="text-xs text-white/40">Swiss Private Banking</p>
                  </div>
                </div>
                <button onClick={() => setShowOpen(false)} className="rounded-xl p-2 glass-btn">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">JURISDICTION</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Zurich', 'Geneva', 'Lugano', 'Basel'].map(city => (
                      <button key={city} className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-red-500/30 transition-colors text-sm text-white/80 hover:text-white flex items-center justify-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-red-400" /> {city}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">CURRENCY</label>
                  <select className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white cursor-pointer">
                    {['CHF', 'EUR', 'USD', 'GBP'].map(c => <option key={c} className="bg-[#0d0d14]">{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">ACCOUNT TYPE</label>
                  <select className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white cursor-pointer">
                    <option className="bg-[#0d0d14]">Numbered (Maximum Privacy)</option>
                    <option className="bg-[#0d0d14]">Discretionary Trust</option>
                    <option className="bg-[#0d0d14]">Investment</option>
                    <option className="bg-[#0d0d14]">Holding Company</option>
                  </select>
                </div>
                <input placeholder="Initial deposit (min CHF 250,000)" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/80 flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  Your dedicated Swiss banker will contact you within 4 hours
                </div>

                <button onClick={() => setShowOpen(false)} className="w-full py-3 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-sm flex items-center justify-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> Begin KYC Process
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
