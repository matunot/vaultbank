import { motion } from 'framer-motion';
import { Crown, Gem, Sparkles, Award, ArrowRight } from 'lucide-react';
import { rewards, rewardsHistory, rewardTiers } from '../data';

export default function RewardsSection() {
  const progress = (rewards.points / rewards.nextPoints) * 100;

  return (
    <div className="space-y-5">
      {/* Hero - Member Tier Card */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl overflow-hidden iridescent-border"
      >
        <div className="relative rounded-3xl overflow-hidden p-6 lg:p-10 holo-card">
          <div className="absolute inset-0 glass opacity-40" />
          <div className="absolute -top-20 -right-20 w-96 h-96 bg-amber-500/20 rounded-full blur-3xl" />
          <div className="absolute right-12 top-1/2 -translate-y-1/2 w-44 h-44 rounded-full border border-amber-500/15 animate-spin-slow pointer-events-none" />

          <div className="relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Crown className="w-5 h-5 text-amber-300" />
                  <span className="text-xs tracking-[0.3em] text-amber-200/60 font-bold uppercase">{rewards.tier} Member</span>
                </div>
                <p className="font-display text-6xl lg:text-7xl text-gold leading-none">
                  {rewards.points.toLocaleString()}
                </p>
                <p className="text-sm text-white/40 mt-2">reward points available</p>
              </div>

              <div className="md:text-right">
                <p className="text-xs tracking-widest text-white/40 font-semibold">NEXT TIER: {rewards.nextTier}</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {(rewards.nextPoints - rewards.points).toLocaleString()}
                </p>
                <p className="text-xs text-white/40">points to unlock</p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-white/60 font-semibold">{rewards.tier}</span>
                <span className="text-amber-300 font-bold">{progress.toFixed(1)}%</span>
                <span className="text-white/60 font-semibold">{rewards.nextTier}</span>
              </div>
              <div className="h-3 rounded-full bg-white/5 overflow-hidden glass">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500"
                  style={{ boxShadow: '0 0 12px rgba(212,175,55,0.6)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tier Ladder */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-5">Tier Levels</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {rewardTiers.map((tier, i) => {
            const isCurrent = tier.tier === rewards.tier;
            const isUnlocked = rewards.points >= tier.min;
            return (
              <motion.div
                key={tier.tier}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.1 }}
                className={`relative p-5 rounded-2xl border transition-all ${
                  isCurrent 
                    ? 'bg-gradient-to-br from-amber-500/20 to-amber-700/10 border-amber-500/40 shadow-lg shadow-amber-500/10' 
                    : isUnlocked 
                      ? 'bg-white/[0.04] border-white/10' 
                      : 'bg-white/[0.02] border-white/5'
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-2 -right-2 bg-amber-400 text-amber-950 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1">
                    <Crown className="w-2.5 h-2.5" />
                    CURRENT
                  </div>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${tier.color}20`, border: `1px solid ${tier.color}40` }}>
                    {i === 0 && <Sparkles className="w-5 h-5" style={{ color: tier.color }} />}
                    {i === 1 && <Award className="w-5 h-5" style={{ color: tier.color }} />}
                    {i === 2 && <Gem className="w-5 h-5" style={{ color: tier.color }} />}
                    {i === 3 && <Crown className="w-5 h-5" style={{ color: tier.color }} />}
                  </div>
                  <span className="font-bold text-white text-lg">{tier.tier}</span>
                </div>
                <p className="text-xs text-white/40 mb-3">{tier.min.toLocaleString()} points required</p>
                <ul className="space-y-1.5">
                  {tier.benefits.map((b, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-white/70">
                      <span className="text-amber-400 mt-0.5">•</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Your Benefits + History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Benefits */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-3xl p-6">
          <h3 className="font-display text-xl text-white mb-5">Your Benefits</h3>
          <div className="space-y-2">
            {rewards.benefits.map((b, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.06 }}
                whileHover={{ x: 4 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-amber-500/20 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                </div>
                <span className="text-sm text-white flex-1">{b}</span>
                <ArrowRight className="w-4 h-4 text-white/40" />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Points History */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="glass-panel rounded-3xl p-6">
          <h3 className="font-display text-xl text-white mb-5">Points History</h3>
          <div className="space-y-2">
            {rewardsHistory.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.06 }}
                whileHover={{ x: 4 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-amber-500/20 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center text-xl flex-shrink-0">
                  {r.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{r.desc}</p>
                  <p className="text-[11px] text-white/40">{r.date}</p>
                </div>
                <span className="text-amber-300 font-bold text-sm">+{r.points}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}