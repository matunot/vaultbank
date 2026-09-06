import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Wifi, Lock, Unlock, Eye, EyeOff, Copy } from 'lucide-react';
import RichIcon from './RichIcon';

interface Card {
  id: number;
  type: string;
  network: string;
  last4: string;
  balance: number;
  limit: number;
  color: string;
  gradient: string;
  accent: string;
  expiry: string;
  holder: string;
  locked?: boolean;
}

interface CardsPanelProps {
  cards: Card[];
  onLockCard: (id: number) => void;
  formatMoney: (amount: number) => string;
}

const glowMap: Record<string, string> = {
  gold:     'glow-amber',
  emerald:  'glow-emerald',
  sapphire: 'glow-blue',
};

export default function CardsPanel({ cards, onLockCard, formatMoney }: CardsPanelProps) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showNumber, setShowNumber] = useState(false);
  const card = cards[idx];

  const copyCardNumber = () => {
    navigator.clipboard.writeText(`4521 8901 2345 ${card.last4}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="glass-panel rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">My Cards</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">{cards.filter(c => !c.locked).length} ACTIVE</p>
        </div>
        <div className="flex items-center gap-1">
          <motion.button
            onClick={() => { setIdx((idx - 1 + cards.length) % cards.length); setFlipped(false); }}
            whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}
            className="w-8 h-8 rounded-lg glass-btn flex items-center justify-center"
          >
            <ChevronLeft className="w-4 h-4 text-white/60" />
          </motion.button>
          <span className="text-xs text-white/40 px-1">{idx + 1}/{cards.length}</span>
          <motion.button
            onClick={() => { setIdx((idx + 1) % cards.length); setFlipped(false); }}
            whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}
            className="w-8 h-8 rounded-lg glass-btn flex items-center justify-center"
          >
            <ChevronRight className="w-4 h-4 text-white/60" />
          </motion.button>
        </div>
      </div>

      {/* Card */}
      <div className="relative z-10 mb-5" style={{ perspective: 1400 }} onClick={() => setFlipped(!flipped)}>
        <motion.div
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.8, type: 'spring', stiffness: 80, damping: 20 }}
          style={{ transformStyle: 'preserve-3d', position: 'relative' }}
          className="w-full aspect-[1.586/1]"
        >
          {/* Front */}
          <div
            className={`absolute inset-0 rounded-2xl overflow-hidden ${glowMap[card.color] ?? ''} holo-card`}
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
          >
            <div className="absolute inset-0 glass opacity-60" />
            <div className="absolute inset-0 shimmer" />
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/5 rounded-full" />
            <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-white/5 rounded-full" />

            <div className="relative z-10 h-full p-6 flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-7 rounded-md bg-linear-to-br from-amber-300 to-amber-600 relative overflow-hidden">
                    <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/40 to-transparent" />
                    <div className="absolute inset-1 border border-amber-800/40 rounded-sm" />
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] tracking-[0.2em] text-amber-200/60 font-semibold">VAULT</div>
                    <div className="text-[10px] text-amber-200/80 font-bold">{card.type.toUpperCase()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-amber-200/60 rotate-90" />
                  <span className="text-[10px] text-amber-200/60 font-bold tracking-wider">{card.network}</span>
                </div>
              </div>

              <div>
                <div className="font-mono text-lg tracking-[0.25em] text-amber-100/90 mb-4">
                  {showNumber ? `4521 8901 2345 ${card.last4}` : `•••• •••• •••• ${card.last4}`}
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[9px] text-amber-200/40 tracking-widest">CARDHOLDER</div>
                    <div className="text-sm font-bold text-amber-100 tracking-wide">{card.holder}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-amber-200/40 tracking-widest">VALID THRU</div>
                    <div className="text-sm font-bold text-amber-100">{card.expiry}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Back */}
          <div
            className={`absolute inset-0 rounded-2xl overflow-hidden glass ${glowMap[card.color] ?? ''}`}
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div className="w-full h-12 bg-black/60 mt-10" />
            <div className="px-6 mt-4">
              <div className="glass rounded h-9 flex items-center px-4">
                <div className="ml-auto font-mono text-sm text-amber-100 tracking-widest">•••</div>
              </div>
              <p className="text-[9px] text-amber-200/40 mt-2 text-center tracking-widest">CVV</p>
            </div>
          </div>

          {/* Lock overlay */}
          <AnimatePresence>
            {card.locked && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 rounded-2xl frosted-overlay flex items-center justify-center z-20"
                style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center">
                  <Lock className="w-12 h-12 text-amber-400 mx-auto mb-2" />
                  <p className="text-lg font-bold text-white">Card Locked</p>
                  <p className="text-xs text-white/50">Tap unlock to enable</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <p className="text-[10px] text-white/30 text-center -mt-3 mb-4">Click card to flip</p>

      {/* Indicators */}
      <div className="flex justify-center gap-2 mb-5">
        {cards.map((c, i) => (
          <motion.button
            key={c.id}
            onClick={() => { setIdx(i); setFlipped(false); }}
            animate={{ width: i === idx ? 28 : 8, backgroundColor: i === idx ? c.accent : 'rgba(255,255,255,0.1)' }}
            className="h-1.5 rounded-full cursor-pointer transition-colors"
          />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowNumber(!showNumber)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl glass-btn text-xs font-semibold text-white/70 hover:text-white transition-colors"
        >
          <RichIcon icon={showNumber ? <EyeOff size={14} /> : <Eye size={14} />} variant="sapphire" size="sm" />
          {showNumber ? 'Hide' : 'Show'}
        </button>
        <button
          onClick={copyCardNumber}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl glass-btn text-xs font-semibold text-white/70 hover:text-white transition-colors"
        >
          <RichIcon icon={<Copy size={14} />} variant="amethyst" size="sm" /> Copy
        </button>
        <button
          onClick={() => onLockCard(card.id)}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl glass-btn text-xs font-semibold transition-colors ${
            card.locked
              ? 'border border-emerald-500/20 text-emerald-400'
              : 'border border-rose-500/20 text-rose-400'
          }`}
        >
          <RichIcon
            icon={card.locked ? <Unlock size={14} /> : <Lock size={14} />}
            variant={card.locked ? 'emerald' : 'ruby'}
            size="sm"
            pulse={card.locked}
          />
          {card.locked ? 'Unlock' : 'Lock'}
        </button>
      </div>

      {/* Card info */}
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y:  0 }}
          exit  ={{ opacity: 0, y: -10 }}
          className="glass flex items-center justify-between p-4 rounded-2xl"
        >
          <div>
            <p className="text-[10px] text-white/40 tracking-wider">{card.type.toUpperCase()}</p>
            <p className="text-xl font-display text-white">{formatMoney(card.balance)}</p>
            <p className="text-[10px] text-white/40 mt-0.5">of {formatMoney(card.limit)} limit</p>
          </div>
          <div className="w-24 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(card.balance / card.limit) * 100}%` }}
              transition={{ delay: 0.3, duration: 1 }}
              className="h-full rounded-full"
              style={{ background: card.accent, boxShadow: `0 0 10px ${card.accent}` }}
            />
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
