import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Lock, Eye, EyeOff, Copy, Check, ChevronLeft, ChevronRight,
  CreditCard, Unlock, Shield, Clock, TrendingUp,
  Wifi, CheckCircle2, X, Fingerprint, Zap,
  Settings2, Ban,
} from 'lucide-react';
import { cardTransactions, cardSpendingCategories } from '../data';

interface Card {
  id: number; type: string; network: string; last4: string;
  balance: number; limit: number; color: string; accent: string;
  expiry: string; holder: string; locked?: boolean;
}

interface Props {
  cards: Card[];
  onLockCard: (id: number) => void;
  formatMoney: (amount: number) => string;
}

const glowMap: Record<string, string> = {
  gold: 'glow-amber', emerald: 'glow-emerald', sapphire: 'glow-blue', ruby: 'glow-rose',
};

const mockFullNumbers: Record<number, string> = {
  1: '4521 8901 2345 4827',
  2: '5214 8765 4321 9014',
  3: '3789 1245 6300 3156',
  4: '4532 1890 7654 6692',
};

const mockCVV: Record<number, string> = {
  1: '248', 2: '691', 3: '735', 4: '182',
};

export default function CardsSection({ cards, onLockCard, formatMoney }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showNumber, setShowNumber] = useState(false);
  const [showCVV, setShowCVV] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showNewCard, setShowNewCard] = useState(false);
  const [lockedCards, setLockedCards] = useState<number[]>(cards.filter(c => c.locked).map(c => c.id));
  const [allLocked, setAllLocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinAttempt, setPinAttempt] = useState('');
  const [pinSuccess, setPinSuccess] = useState(false);
  const [limitEdit, setLimitEdit] = useState(false);
  const [newLimit, setNewLimit] = useState('');

  const card = cards[selectedIdx];
  const cardTx = cardTransactions[card?.id] || [];
  const cardSpend = cardSpendingCategories[card?.id] || [];
  const totalSpend = cardSpend.reduce((s, c) => s + c.amount, 0);

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleLockCard = useCallback((cardId: number) => {
    onLockCard(cardId);
    setLockedCards(prev =>
      prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]
    );
  }, [onLockCard]);

  const handleLockAll = useCallback(() => {
    const newLocked = allLocked ? [] : cards.map(c => c.id);
    setLockedCards(newLocked);
    cards.forEach(c => {
      if ((allLocked && c.locked) || (!allLocked && !c.locked)) {
        onLockCard(c.id);
      }
    });
    setAllLocked(!allLocked);
  }, [allLocked, cards, onLockCard]);

  const prevCard = useCallback(() => {
    setSelectedIdx(prev => (prev - 1 + cards.length) % cards.length);
    setShowNumber(false);
    setShowCVV(false);
    setFlipped(false);
  }, [cards.length]);

  const nextCard = useCallback(() => {
    setSelectedIdx(prev => (prev + 1) % cards.length);
    setShowNumber(false);
    setShowCVV(false);
    setFlipped(false);
  }, [cards.length]);

  const totalBalance = useMemo(() => cards.reduce((s, c) => s + c.balance, 0), [cards]);
  const totalLimit = useMemo(() => cards.reduce((s, c) => s + c.limit, 0), [cards]);
  const activeCount = cards.filter(c => !lockedCards.includes(c.id)).length;

  const isLocked = lockedCards.includes(card?.id);

  return (
    <div className="space-y-5">
      {/* Hero Stats */}
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="relative z-10">
          <p className="text-xs tracking-widest text-white/40 font-semibold">TOTAL CARD BALANCE</p>
          <div className="flex items-baseline gap-4 mt-2">
            <p className="font-display text-5xl lg:text-6xl text-gold">
              ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <span className="text-white/40">/ ${totalLimit.toLocaleString()} limit</span>
          </div>
          <div className="mt-5 h-2 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(totalBalance / totalLimit) * 100}%` }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500"
              style={{ boxShadow: '0 0 12px rgba(212,175,55,0.5)' }}
            />
          </div>
          <div className="flex items-center justify-between mt-6">
            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowNewCard(true)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm flex items-center gap-2 glow-amber"
              >
                <Plus className="w-4 h-4" /> New Card
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={handleLockAll}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 ${
                  allLocked ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : 'glass-btn text-white/80'
                }`}
              >
                {allLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                {allLocked ? 'Unlock All' : 'Lock All'}
              </motion.button>
            </div>
            <span className="text-sm text-white/40">{cards.length} cards · {activeCount} active</span>
          </div>
        </div>
      </motion.div>

      {/* Featured Card with 3D Flip */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-xl text-white">{card?.type}</h3>
            <p className="text-xs text-white/40">Swipe or tap arrows to switch cards</p>
          </div>
          <div className="flex gap-1">
            {cards.map((_, i) => (
              <button key={i} onClick={() => { setSelectedIdx(i); setFlipped(false); setShowNumber(false); setShowCVV(false); }}
                className={`h-2 rounded-full transition-all ${i === selectedIdx ? 'w-8 bg-amber-400' : 'w-2 bg-white/20 hover:bg-white/40'}`}
              />
            ))}
          </div>
        </div>

        {/* Card with 3D perspective */}
        <div className="relative" style={{ perspective: 1400 }}>
          <motion.div
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ duration: 0.6, type: 'spring', stiffness: 100, damping: 20 }}
            style={{ transformStyle: 'preserve-3d' }}
            className="w-full aspect-[1.586/1] max-h-[320px] mx-auto cursor-pointer"
            onClick={() => setFlipped(!flipped)}
          >
            {/* Front */}
            <div
              className={`absolute inset-0 rounded-2xl overflow-hidden ${glowMap[card?.color] || ''} holo-card`}
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <div className="absolute inset-0 glass opacity-60" />
              <div className="absolute inset-0 shimmer" />
              <div className="absolute -top-12 -right-12 w-56 h-56 bg-white/5 rounded-full" />
              <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/5 rounded-full" />
              <div className="absolute right-8 top-1/2 -translate-y-1/2 w-20 h-20 rounded-full border border-white/5" />

              {/* Lock overlay */}
              <AnimatePresence>
                {isLocked && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 rounded-2xl bg-black/60 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Lock className="w-10 h-10 text-amber-400" />
                    <p className="text-lg font-bold text-white">Card Locked</p>
                    <p className="text-xs text-white/50">Tap unlock in controls below</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative z-10 h-full p-6 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-11 h-8 rounded-md bg-gradient-to-br from-amber-300 to-amber-600 relative overflow-hidden shadow-lg">
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                      <div className="absolute inset-1 border border-amber-800/40 rounded-sm" />
                      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px p-0.5 opacity-40">
                        {Array.from({ length: 9 }).map((_, j) => <div key={j} className="bg-amber-900/30 rounded-[1px]" />)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] tracking-[0.2em] text-amber-200/60 font-semibold">VAULT</div>
                      <div className="text-[11px] text-amber-200/80 font-bold tracking-wide">{card?.type.toUpperCase()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-amber-200/60 rotate-90" />
                    <span className="text-[10px] text-amber-200/60 font-bold tracking-wider">{card?.network}</span>
                  </div>
                </div>

                <div>
                  <div className="font-mono text-xl lg:text-2xl tracking-[0.25em] text-amber-100/90 mb-5">
                    {showNumber ? mockFullNumbers[card?.id] || '•••• •••• •••• ' + card?.last4 : `•••• •••• •••• ${card?.last4}`}
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-[9px] text-amber-200/40 tracking-widest">CARDHOLDER</div>
                      <div className="text-sm font-bold text-amber-100 tracking-wide">{card?.holder}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-amber-200/40 tracking-widest">VALID THRU</div>
                      <div className="text-sm font-bold text-amber-100">{card?.expiry}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Back */}
            <div
              className={`absolute inset-0 rounded-2xl overflow-hidden glass ${glowMap[card?.color] || ''}`}
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="w-full h-12 bg-black/50 mt-10" />
              <div className="px-6 mt-4 space-y-2">
                <div className="flex justify-end">
                  <div className="bg-white/15 rounded-lg h-8 flex items-center px-5">
                    <span className="font-mono text-base text-amber-100 tracking-widest">
                      {showCVV ? mockCVV[card?.id] || '***' : '***'}
                    </span>
                  </div>
                </div>
                <p className="text-[9px] text-amber-200/40 text-right tracking-widest">CVV/CVC</p>
                <div className="pt-4 border-t border-white/10 text-[10px] text-white/30 text-center tracking-wider">
                  This card is issued by Vault Banking AG pursuant to a license from Visa/Mastercard.
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        <p className="text-[10px] text-white/30 text-center mt-2 mb-4">Click card to flip · Swipe arrows to browse</p>

        {/* Card Navigation */}
        <div className="flex items-center justify-between gap-4">
          <motion.button whileHover={{ scale: 1.1, x: -2 }} whileTap={{ scale: 0.9 }}
            onClick={prevCard} className="rounded-xl glass-btn p-2.5 text-white/60 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </motion.button>

          <div className="flex gap-1 flex-1 justify-center">
            {cards.map((c, i) => (
              <button key={c.id} onClick={() => { setSelectedIdx(i); setFlipped(false); setShowNumber(false); }}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${i === selectedIdx ? 'w-10 bg-amber-400' : 'w-2 bg-white/15 hover:bg-white/30'}`}
              />
            ))}
          </div>

          <motion.button whileHover={{ scale: 1.1, x: 2 }} whileTap={{ scale: 0.9 }}
            onClick={nextCard} className="rounded-xl glass-btn p-2.5 text-white/60 hover:text-white"
          >
            <ChevronRight className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Card Action Buttons - ALL WORKING */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
            onClick={() => setShowNumber(!showNumber)}
            className="flex items-center justify-center gap-2 py-3 rounded-xl glass-btn text-xs font-bold text-white/70 hover:text-white"
          >
            {showNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showNumber ? 'Hide Number' : 'Show Number'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
            onClick={() => setShowCVV(!showCVV)}
            className="flex items-center justify-center gap-2 py-3 rounded-xl glass-btn text-xs font-bold text-white/70 hover:text-white"
          >
            <Fingerprint className="w-4 h-4" />
            {showCVV ? 'Hide CVV' : 'Show CVV'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
            onClick={() => copyToClipboard(mockFullNumbers[card?.id] || card?.last4 || '', 'card-number')}
            className="flex items-center justify-center gap-2 py-3 rounded-xl glass-btn text-xs font-bold text-white/70 hover:text-white"
          >
            {copied === 'card-number' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied === 'card-number' ? 'Copied!' : 'Copy Number'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
            onClick={() => handleLockCard(card?.id)}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${
              isLocked ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20'
            }`}
          >
            {isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {isLocked ? 'Unlock' : 'Lock Card'}
          </motion.button>
        </div>

        {/* Card Details Panel */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5 mt-5"
        >
          <div>
            <p className="text-[10px] text-white/40 tracking-wider">{card?.type.toUpperCase()}</p>
            <p className="text-xl font-display text-white">{formatMoney(card?.balance || 0)}</p>
            <p className="text-[10px] text-white/40 mt-0.5">of {formatMoney(card?.limit || 0)} limit</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-32 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${((card?.balance || 0) / (card?.limit || 1)) * 100}%` }}
                transition={{ duration: 1 }}
                className="h-full rounded-full"
                style={{ background: card?.accent, boxShadow: `0 0 10px ${card?.accent}` }}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => { setShowPinModal(true); setPinAttempt(''); setPinSuccess(false); }}
              className="p-2.5 rounded-xl glass-btn hover:bg-white/10"
              title="Manage PIN"
            >
              <Settings2 className="w-4 h-4 text-white/50" />
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* Spending Breakdown */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display text-xl text-white">Monthly Spending</h3>
            <p className="text-xs text-white/40 mt-0.5">${totalSpend.toLocaleString()} total this month</p>
          </div>
          <div className="flex items-center gap-1 text-sm text-emerald-400">
            <TrendingUp className="w-3.5 h-3.5" /> +12.4%
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cardSpend.map((cat, i) => (
            <div key={cat.label} className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">{cat.label}</span>
                <span className="font-bold text-white">${cat.amount.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(cat.amount / totalSpend) * 100}%` }}
                  transition={{ delay: 0.3 + i * 0.08, duration: 0.8 }}
                  className="h-full rounded-full"
                  style={{ background: cat.color, boxShadow: `0 0 8px ${cat.color}80` }}
                />
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Recent Card Transactions */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display text-xl text-white">Card Activity</h3>
            <p className="text-xs text-white/40 mt-0.5">Recent transactions on {card?.type}</p>
          </div>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-white/50">
            <Clock className="w-3 h-3" /> LAST 30 DAYS
          </span>
        </div>
        <div className="space-y-2">
          {cardTx.length === 0 ? (
            <p className="text-center py-6 text-white/30 text-sm">No recent transactions on this card</p>
          ) : cardTx.map((tx, i) => (
            <motion.div
              key={tx.name + i}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.06 }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm ${
                tx.amount > 0 ? 'bg-emerald-500/15 border border-emerald-500/20' : 'bg-rose-500/10 border border-rose-500/15'
              }`}>
                {tx.amount > 0 ? '📥' : '📤'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{tx.name}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-white/40">
                  <span>{tx.category}</span>
                  <span>·</span>
                  <span>{tx.date}</span>
                </div>
              </div>
              <span className={`font-bold text-sm ${tx.amount > 0 ? 'text-emerald-400' : 'text-white'}`}>
                {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toLocaleString()}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Additional Card Controls (Limit, PIN, Freeze) */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <motion.button
          whileHover={{ y: -4, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setLimitEdit(true); setNewLimit(String(card?.limit || '')); }}
          className="glass glass-hover p-5 rounded-2xl text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5 text-blue-300" />
          </div>
          <p className="font-bold text-white text-sm">Adjust Limit</p>
          <p className="text-xs text-white/40 mt-1">Current: {formatMoney(card?.limit || 0)}</p>
        </motion.button>

        <motion.button
          whileHover={{ y: -4, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { setShowPinModal(true); setPinAttempt(''); setPinSuccess(false); }}
          className="glass glass-hover p-5 rounded-2xl text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mb-3">
            <Shield className="w-5 h-5 text-amber-300" />
          </div>
          <p className="font-bold text-white text-sm">Manage PIN</p>
          <p className="text-xs text-white/40 mt-1">Change or reset card PIN</p>
        </motion.button>

        <motion.button
          whileHover={{ y: -4, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => handleLockCard(card?.id)}
          className={`glass glass-hover p-5 rounded-2xl text-left ${isLocked ? 'bg-emerald-500/5' : 'bg-rose-500/5'}`}
        >
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-3 ${
            isLocked ? 'bg-emerald-500/15 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/15'
          }`}>
            {isLocked ? <Ban className="w-5 h-5 text-emerald-400" /> : <Zap className="w-5 h-5 text-rose-400" />}
          </div>
          <p className="font-bold text-white text-sm">{isLocked ? 'Activate Card' : 'Freeze Card'}</p>
          <p className="text-xs text-white/40 mt-1">{isLocked ? 'Card is currently frozen' : 'Temporarily disable card'}</p>
        </motion.button>
      </motion.div>

      {/* Card Benefits */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-4">Card Benefits</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { icon: '🏧', title: 'Zero ATM Fees', desc: 'Unlimited free withdrawals worldwide' },
            { icon: '🔒', title: 'Fraud Protection', desc: '24/7 monitoring & instant card lock' },
            { icon: '✈️', title: 'Travel Insurance', desc: 'Up to $500K coverage on every trip' },
            { icon: '⭐', title: 'Concierge Service', desc: '24/7 premium concierge access' },
          ].map((b, i) => (
            <div key={i} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-amber-500/20 transition-all">
              <div className="text-2xl mb-2">{b.icon}</div>
              <p className="font-bold text-white text-sm">{b.title}</p>
              <p className="text-xs text-white/50 mt-1">{b.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* PIN Change Modal */}
      <AnimatePresence>
        {showPinModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowPinModal(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">Manage PIN</h3>
                    <p className="text-xs text-white/40">Enter current PIN to continue</p>
                  </div>
                </div>
                <button onClick={() => setShowPinModal(false)} className="rounded-xl p-2 glass-btn hover:bg-white/10">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">CURRENT PIN</label>
                  <input
                    type="password" maxLength={4} value={pinAttempt}
                    onChange={(e) => setPinAttempt(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-3 text-center text-2xl tracking-widest text-white"
                    placeholder="• • • •"
                  />
                </div>

                <button
                  onClick={() => { if (pinAttempt === '248' || pinAttempt === '1234') { setPinSuccess(true); } }}
                  className={`w-full py-3 rounded-xl font-bold text-sm ${
                    pinSuccess ? 'bg-emerald-500 text-white glow-emerald' : 'bg-amber-400 text-amber-950'
                  }`}
                >
                  {pinSuccess ? 'PIN Verified ✓' : 'Verify PIN'}
                </button>

                {pinAttempt.length === 4 && pinAttempt !== '248' && pinAttempt !== '1234' && !pinSuccess && (
                  <p className="text-xs text-rose-400 text-center font-bold">Incorrect PIN. Try 1234</p>
                )}

                <AnimatePresence>
                  {pinSuccess && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
                      <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                        <div className="flex items-center gap-2 text-sm text-emerald-300">
                          <CheckCircle2 className="w-4 h-4" /> PIN verified successfully
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">NEW PIN</label>
                        <input type="password" maxLength={4} className="w-full glass-input rounded-xl px-4 py-3 text-center text-2xl tracking-widest text-white" placeholder="• • • •" />
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">CONFIRM NEW PIN</label>
                        <input type="password" maxLength={4} className="w-full glass-input rounded-xl px-4 py-3 text-center text-2xl tracking-widest text-white" placeholder="• • • •" />
                      </div>
                      <button onClick={() => setShowPinModal(false)} className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 text-white font-bold text-sm glow-emerald">
                        Update PIN
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Card Modal */}
      <AnimatePresence>
        {showNewCard && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowNewCard(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-amber-950" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">New Card</h3>
                    <p className="text-xs text-white/40">Order a new premium card</p>
                  </div>
                </div>
                <button onClick={() => setShowNewCard(false)} className="rounded-xl p-2 glass-btn hover:bg-white/10">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: 'Obsidian Black', color: 'bg-slate-900 border-slate-600', key: 'black' },
                    { name: 'Gold Elite', color: 'bg-amber-500 border-amber-300', key: 'gold' },
                    { name: 'Platinum', color: 'bg-slate-300 border-white', key: 'platinum' },
                    { name: 'Carbon Fiber', color: 'bg-zinc-800 border-zinc-600', key: 'carbon' },
                  ].map((c) => (
                    <button key={c.key} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-amber-500/40 text-left transition-all">
                      <div className={`w-10 h-7 rounded mb-2 ${c.color} border`} />
                      <p className="text-sm font-bold text-white">{c.name}</p>
                    </button>
                  ))}
                </div>

                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">DELIVERY</label>
                  <select className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white">
                    <option className="bg-[#0d0d14]">Standard (5-7 days) · Free</option>
                    <option className="bg-[#0d0d14]">Express (2-3 days) · $25</option>
                    <option className="bg-[#0d0d14]">Priority (24h) · $50</option>
                  </select>
                </div>

                <button
                  onClick={() => setShowNewCard(false)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm glow-amber"
                >
                  Confirm Order
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Limit Edit Modal */}
      <AnimatePresence>
        {limitEdit && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLimitEdit(false)}
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
                    <TrendingUp className="w-5 h-5 text-blue-300" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl text-white">Adjust Credit Limit</h3>
                    <p className="text-xs text-white/40">For {card?.type}</p>
                  </div>
                </div>
                <button onClick={() => setLimitEdit(false)} className="rounded-xl p-2 glass-btn hover:bg-white/10">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">NEW LIMIT</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400 font-display text-lg">$</span>
                    <input type="number" value={newLimit} onChange={(e) => setNewLimit(e.target.value)}
                      className="w-full glass-input rounded-xl pl-8 pr-4 py-3 text-lg font-display text-white"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  {['5000', '10000', '15000', '25000'].map(v => (
                    <button key={v} onClick={() => setNewLimit(v)}
                      className="flex-1 py-2 rounded-lg glass-btn text-xs text-white/70 hover:text-white"
                    >${v}</button>
                  ))}
                </div>
                <button onClick={() => setLimitEdit(false)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-400 to-indigo-500 text-white font-bold text-sm glow-blue"
                >Save New Limit</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
