import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock, Unlock, Plus, ShieldCheck, TrendingUp, Key, ArrowUpRight, ArrowDownRight,
  History, Sparkles, ChevronRight, X, Check,
} from 'lucide-react';
import { vaults } from '../data';

type VaultAction = 'deposit' | 'withdraw' | 'create' | null;

export default function VaultSection() {
  const [selectedVault, setSelectedVault] = useState<number | null>(null);
  const [unlockAttempt, setUnlockAttempt] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [action, setAction] = useState<VaultAction>(null);
  const [amount, setAmount] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newVault, setNewVault] = useState({ name: '', target: '', locked: false, unlockMonths: '6' });

  const totalSaved = vaults.reduce((s, v) => s + v.current, 0);
  const totalTarget = vaults.reduce((s, v) => s + v.amount, 0);
  const lockedCount = vaults.filter(v => v.locked).length;
  const unlockedCount = vaults.filter(v => !v.locked).length;
  const yearlyInterest = vaults.reduce((s, v) => s + (v.current * v.rate / 100), 0);
  const monthlyInterest = yearlyInterest / 12;

  const selected = selectedVault !== null ? vaults.find(v => v.id === selectedVault) : null;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-500/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs tracking-widest text-white/40 font-semibold">SECURE VAULT</p>
              <p className="font-display text-5xl lg:text-6xl text-gold mt-2">
                ${totalSaved.toLocaleString()}
              </p>
              <p className="text-sm text-white/40 mt-1">
                of ${totalTarget.toLocaleString()} goal across {vaults.length} vaults
              </p>
              <div className="flex items-center gap-3 mt-4 flex-wrap">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-amber-500/20">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-amber-300">+${yearlyInterest.toLocaleString('en-US', { maximumFractionDigits: 2 })}/yr interest</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-300">+${monthlyInterest.toLocaleString('en-US', { maximumFractionDigits: 2 })}/mo</span>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="relative w-28 h-28">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 rounded-full border-2 border-amber-500/30"
                />
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-2 rounded-full border-2 border-amber-400/20"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldCheck className="w-12 h-12 text-amber-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="glass-btn rounded-xl p-3 text-center">
              <p className="text-[10px] text-white/40 tracking-wider">LOCKED</p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <Lock className="w-4 h-4 text-amber-400" />
                <span className="text-xl font-bold text-amber-400">{lockedCount}</span>
              </div>
            </div>
            <div className="glass-btn rounded-xl p-3 text-center">
              <p className="text-[10px] text-white/40 tracking-wider">FLEXIBLE</p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <Unlock className="w-4 h-4 text-emerald-400" />
                <span className="text-xl font-bold text-emerald-400">{unlockedCount}</span>
              </div>
            </div>
            <div className="glass-btn rounded-xl p-3 text-center">
              <p className="text-[10px] text-white/40 tracking-wider">AVG RATE</p>
              <span className="text-xl font-bold text-white mt-1 block">
                {(vaults.reduce((s, v) => s + v.rate, 0) / vaults.length).toFixed(1)}%
              </span>
            </div>
            <div className="glass-btn rounded-xl p-3 text-center">
              <p className="text-[10px] text-white/40 tracking-wider">GOAL</p>
              <span className="text-xl font-bold text-amber-300 mt-1 block">
                {Math.round((totalSaved / totalTarget) * 100)}%
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-3 gap-3">
        <motion.button
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreate(true)}
          className="glass glass-hover p-4 rounded-2xl text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
              <Plus className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Create Vault</p>
              <p className="text-xs text-white/40">Start a new goal</p>
            </div>
          </div>
        </motion.button>
        <motion.button
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setAction('deposit'); setAmount('500'); }}
          className="glass glass-hover p-4 rounded-2xl text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
              <ArrowDownRight className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Quick Deposit</p>
              <p className="text-xs text-white/40">Add funds now</p>
            </div>
          </div>
        </motion.button>
        <motion.button
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setAction('withdraw'); setAmount('100'); }}
          className="glass glass-hover p-4 rounded-2xl text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/20 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-rose-300" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Withdraw</p>
              <p className="text-xs text-white/40">From flexible vault</p>
            </div>
          </div>
        </motion.button>
      </div>

      {/* Vaults Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {vaults.map((vault, i) => {
          const pct = Math.round((vault.current / vault.amount) * 100);
          const remaining = vault.amount - vault.current;
          return (
            <motion.div
              key={vault.id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              whileHover={{ y: -6, scale: 1.01 }}
              onClick={() => setSelectedVault(selectedVault === vault.id ? null : vault.id)}
              className={`glass-panel rounded-3xl p-6 relative overflow-hidden cursor-pointer transition-all ${
                selectedVault === vault.id ? 'ring-2 ring-amber-500/40' : ''
              } ${vault.locked ? 'opacity-95' : ''}`}
            >
              {/* Locked overlay */}
              <AnimatePresence>
                {vault.locked && selectedVault !== vault.id && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-gradient-to-br from-slate-900/40 via-slate-800/30 to-amber-900/20 backdrop-blur-[1px] rounded-3xl z-10 flex flex-col items-center justify-center gap-2 pointer-events-none"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Lock className="w-8 h-8 text-amber-400" />
                    </motion.div>
                    <p className="text-xs font-bold text-amber-200">Locked Vault</p>
                    <p className="text-[10px] text-white/40">Unlock on {vault.unlockDate}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: `${vault.color}20`, border: `1px solid ${vault.color}40` }}>
                    {vault.icon}
                  </div>
                  <div>
                    <p className="font-bold text-white text-lg">{vault.name}</p>
                    <p className="text-xs text-white/40">{vault.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {vault.locked ? (
                    <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-bold text-amber-300">
                      <Lock className="w-3 h-3" /> LOCKED
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
                      <Unlock className="w-3 h-3" /> FLEXIBLE
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-baseline justify-between mb-3">
                <span className="text-3xl font-display text-white">${vault.current.toLocaleString()}</span>
                <span className="text-sm text-white/40">/ ${vault.amount.toLocaleString()}</span>
              </div>

              <div className="h-3 rounded-full bg-white/5 overflow-hidden glass">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 1.2, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${vault.color}, ${vault.color}dd)`,
                    boxShadow: `0 0 12px ${vault.color}60`
                  }}
                />
              </div>

              {/* Mini stats */}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div>
                  <p className="text-[9px] text-white/40 tracking-wider">PROGRESS</p>
                  <p className="text-sm font-bold text-white mt-0.5">{pct}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-white/40 tracking-wider">APY</p>
                  <p className="text-sm font-bold text-emerald-400 mt-0.5">{vault.rate}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-white/40 tracking-wider">REMAINING</p>
                  <p className="text-sm font-bold text-white/80 mt-0.5">${remaining.toLocaleString()}</p>
                </div>
              </div>

              {/* Expand hint */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                <span className="text-[10px] text-white/40">Click for activity & controls</span>
                <motion.div
                  animate={{ rotate: selectedVault === vault.id ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight className="w-3.5 h-3.5 text-white/40" />
                </motion.div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Expanded Vault Details */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 20, height: 0 }}
            className="glass-panel rounded-3xl p-6 overflow-hidden"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: `${selected.color}25`, border: `1px solid ${selected.color}50` }}>
                  {selected.icon}
                </div>
                <div>
                  <h3 className="font-display text-2xl text-white">{selected.name}</h3>
                  <p className="text-sm text-white/40">{selected.desc} · {selected.rate}% APY</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedVault(null)}
                className="rounded-xl p-2 glass-btn hover:bg-white/10"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Activity History */}
              <div>
                <h4 className="text-xs tracking-wider text-white/40 font-semibold mb-3 flex items-center gap-2">
                  <History className="w-3.5 h-3.5" /> RECENT ACTIVITY
                </h4>
                <div className="space-y-2">
                  {selected.activity.map((a, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5"
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        a.amount > 0 ? 'bg-emerald-500/15 border border-emerald-500/20' : 'bg-rose-500/15 border border-rose-500/20'
                      }`}>
                        {a.amount > 0 ? (
                          <ArrowDownRight className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 text-rose-400" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">{a.desc}</p>
                        <p className="text-[11px] text-white/40">{a.date}</p>
                      </div>
                      <span className={`font-bold text-sm ${a.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {a.amount > 0 ? '+' : ''}${Math.abs(a.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Vault Controls */}
              <div className="space-y-3">
                <h4 className="text-xs tracking-wider text-white/40 font-semibold mb-3 flex items-center gap-2">
                  <Settings2 className="w-3.5 h-3.5" /> CONTROLS
                </h4>

                {selected.locked ? (
                  <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center">
                    <Lock className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                    <p className="text-sm font-bold text-amber-200">Locked Until {selected.unlockDate}</p>
                    <p className="text-xs text-white/40 mt-1 mb-4">Early unlock requires penalty fee</p>
                    <button
                      onClick={() => setUnlockAttempt(selected.id)}
                      className="w-full py-2.5 rounded-xl bg-amber-500 text-amber-950 font-bold text-sm flex items-center justify-center gap-2"
                    >
                      <Key className="w-4 h-4" /> Early Unlock
                    </button>
                    {unlockAttempt === selected.id && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-3 space-y-2"
                      >
                        <input
                          type="password"
                          placeholder="Enter 4-digit PIN"
                          maxLength={4}
                          value={pin}
                          onChange={(e) => setPin(e.target.value)}
                          className="w-full glass-input rounded-xl px-4 py-2.5 text-center text-lg tracking-widest text-white"
                        />
                        <button
                          onClick={() => { setUnlockAttempt(null); setPin(''); }}
                          className="w-full py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold"
                        >
                          Confirm Unlock (2% penalty)
                        </button>
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => { setAction('deposit'); setAmount('500'); }}
                        className="py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2"
                      >
                        <ArrowDownRight className="w-4 h-4" /> Deposit
                      </button>
                      <button
                        onClick={() => { setAction('withdraw'); setAmount('100'); }}
                        className="py-3 rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-300 font-bold text-sm flex items-center justify-center gap-2"
                      >
                        <ArrowUpRight className="w-4 h-4" /> Withdraw
                      </button>
                    </div>
                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                      <p className="text-xs text-white/40 mb-2">QUICK AMOUNTS</p>
                      <div className="grid grid-cols-4 gap-2">
                        {['$50', '$100', '$500', '$1000'].map(v => (
                          <button
                            key={v}
                            onClick={() => setAmount(v.replace('$', ''))}
                            className="py-2 rounded-lg bg-white/5 border border-white/5 text-xs font-semibold text-white/70 hover:text-white hover:border-amber-500/30 transition-colors"
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-emerald-300/60 tracking-wider">PROJECTED EARNINGS</p>
                          <p className="text-2xl font-display text-emerald-300 mt-0.5">
                            +${((selected.current * selected.rate) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-white/40 mt-0.5">per year at {selected.rate}% APY</p>
                        </div>
                        <Sparkles className="w-10 h-10 text-emerald-400/40" />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Modal */}
      <AnimatePresence>
        {action && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setAction(null)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  action === 'deposit' ? 'bg-emerald-500/15 border border-emerald-500/20' : 'bg-rose-500/15 border border-rose-500/20'
                }`}>
                  {action === 'deposit' ? (
                    <ArrowDownRight className="w-5 h-5 text-emerald-300" />
                  ) : (
                    <ArrowUpRight className="w-5 h-5 text-rose-300" />
                  )}
                </div>
                <div>
                  <h3 className="font-display text-xl text-white">
                    {action === 'deposit' ? 'Deposit to Vault' : 'Withdraw from Vault'}
                  </h3>
                  <p className="text-xs text-white/40">
                    {action === 'deposit' ? 'Add funds to your secure vault' : 'Withdraw from flexible vault'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">VAULT</label>
                  <select className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white">
                    {vaults.filter(v => !v.locked).map(v => (
                      <option key={v.id} value={v.id} className="bg-[#0d0d14]">{v.icon} {v.name} (${v.current.toLocaleString()})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT</label>
                  <div className="relative">
                    <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl ${
                      action === 'deposit' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>$</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className={`w-full glass-input rounded-xl p-4 pl-10 text-2xl font-display text-white`}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {['$50', '$100', '$500', '$1000'].map(v => (
                    <button
                      key={v}
                      onClick={() => setAmount(v.replace('$', ''))}
                      className="py-2 rounded-lg glass-btn text-xs text-white/70 hover:text-white"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setAction(null)}
                  className={`w-full py-4 mt-3 rounded-xl font-bold flex items-center justify-center gap-2 ${
                    action === 'deposit'
                      ? 'bg-gradient-to-r from-emerald-400 to-teal-400 text-emerald-950 glow-emerald'
                      : 'bg-gradient-to-r from-rose-400 to-orange-400 text-rose-950 glow-rose'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  Confirm {action === 'deposit' ? 'Deposit' : 'Withdrawal'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Vault Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCreate(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-emerald-300" />
                </div>
                <div>
                  <h3 className="font-display text-xl text-white">Create New Vault</h3>
                  <p className="text-xs text-white/40">Start a new savings goal</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">VAULT NAME</label>
                  <input
                    value={newVault.name}
                    onChange={(e) => setNewVault({...newVault, name: e.target.value})}
                    placeholder="e.g. Wedding Fund"
                    className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">TARGET AMOUNT</label>
                  <input
                    type="number"
                    value={newVault.target}
                    onChange={(e) => setNewVault({...newVault, target: e.target.value})}
                    placeholder="$ 50,000"
                    className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">TYPE</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setNewVault({...newVault, locked: false})}
                      className={`p-3 rounded-xl border text-sm font-semibold ${
                        !newVault.locked ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-white/5 border-white/10 text-white/60'
                      }`}
                    >
                      <Unlock className="w-4 h-4 mx-auto mb-1" /> Flexible
                    </button>
                    <button
                      onClick={() => setNewVault({...newVault, locked: true})}
                      className={`p-3 rounded-xl border text-sm font-semibold ${
                        newVault.locked ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-white/5 border-white/10 text-white/60'
                      }`}
                    >
                      <Lock className="w-4 h-4 mx-auto mb-1" /> Locked
                    </button>
                  </div>
                </div>
                {newVault.locked && (
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">UNLOCK PERIOD</label>
                    <select
                      value={newVault.unlockMonths}
                      onChange={(e) => setNewVault({...newVault, unlockMonths: e.target.value})}
                      className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                    >
                      {['3', '6', '12', '24', '36'].map(m => (
                        <option key={m} value={m} className="bg-[#0d0d14]">{m} months</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => setShowCreate(false)}
                  className="w-full py-4 mt-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 text-emerald-950 font-bold glow-emerald flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" /> Create Vault
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Settings2(props: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}