import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, Plus, ArrowUpRight } from 'lucide-react';
import RichIcon from './RichIcon';

interface Goal {
  id: number;
  name: string;
  target: number;
  current: number;
  emoji: string;
  color: string;
  deadline: string;
}

interface SavingsGoalsProps {
  goals: Goal[];
  onAddToGoal: (goalId: number, amount: number) => void;
}

export default function SavingsGoals({ goals, onAddToGoal }: SavingsGoalsProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [amount, setAmount] = useState('');

  const handleAdd = (goalId: number) => {
    if (!amount) return;
    onAddToGoal(goalId, parseFloat(amount));
    setAmount('');
    setAddingTo(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="glass-panel rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Savings Goals</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">DREAM BIG · SAVE SMART</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl glass-btn border border-emerald-500/20 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/10 transition-colors"
        >
          <RichIcon icon={<Plus size={14} />} variant="emerald" size="sm" /> New Goal
        </motion.button>
      </div>

      <div className="relative z-10 space-y-3">
        {goals.map((goal, i) => {
          const pct = Math.round((goal.current / goal.target) * 100);
          return (
            <motion.div
              key={goal.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="glass glass-hover p-4 rounded-2xl cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl" style={{ background: `${goal.color}20` }}>
                  {goal.emoji}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{goal.name}</p>
                    <span className="text-xs text-white/40">{goal.deadline}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm font-bold" style={{ color: goal.color }}>
                      ${goal.current.toLocaleString()}
                    </span>
                    <span className="text-xs text-white/30">of ${goal.target.toLocaleString()}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-lg font-display" style={{ color: goal.color }}>{pct}%</span>
                </div>
              </div>
              
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.5 + i * 0.1, duration: 1, ease: 'easeOut' }}
                  className="h-full rounded-full relative"
                  style={{ background: goal.color, boxShadow: `0 0 10px ${goal.color}60` }}
                >
                  {hovered === i && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer-sweep_1s_ease-in-out_infinite]" />
                  )}
                </motion.div>
              </div>

              {addingTo === goal.id ? (
                <div className="flex gap-2 mt-3">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Amount"
                    className="flex-1 glass-input rounded-xl px-3 py-2 text-sm text-white"
                    autoFocus
                  />
                  <button
                    onClick={() => handleAdd(goal.id)}
                    className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setAddingTo(null)}
                    className="px-4 py-2 rounded-xl glass-btn text-white/60 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingTo(goal.id)}
                  className="mt-3 text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                >
                  <ArrowUpRight className="w-3 h-3" /> Quick Add
                </button>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="relative z-10 mt-5 pt-5 border-t border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RichIcon icon={<Target size={14} />} variant="emerald" size="sm" glow />
          <span className="text-xs text-white/40 tracking-wider font-semibold">TOTAL SAVED</span>
        </div>
        <span className="font-display text-xl text-gold">
          ${goals.reduce((s, g) => s + g.current, 0).toLocaleString()}
        </span>
      </div>
    </motion.div>
  );
}
