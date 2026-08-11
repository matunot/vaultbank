import { motion } from 'framer-motion';
import { Trophy, Lock, CheckCircle2 } from 'lucide-react';
import { achievements } from '../data';
import RichIcon from './RichIcon';

export default function AchievementsPanel() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.45 }}
      className="glass rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Achievements</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">4 OF 6 UNLOCKED</p>
        </div>
        <RichIcon icon={<Trophy size={20} />} variant="gold" size="lg" glow pulse />
      </div>

      <div className="relative z-10 grid grid-cols-3 gap-3">
        {achievements.map((ach, i) => (
          <motion.div
            key={ach.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.06 }}
            whileHover={ach.unlocked ? { y: -4, scale: 1.02 } : {}}
            className={`relative p-4 rounded-2xl border transition-all ${
              ach.unlocked 
                ? 'bg-gradient-to-br from-amber-50/10 to-transparent border-amber-500/20 cursor-pointer' 
                : 'bg-white/[0.02] border-white/5'
            }`}
          >
            <div className="text-2xl mb-2">{ach.icon}</div>
            <p className={`text-xs font-semibold ${ach.unlocked ? 'text-white' : 'text-white/40'}`}>
              {ach.name}
            </p>
            
            {ach.unlocked ? (
              <>
                <CheckCircle2 className="absolute top-2 right-2 w-4 h-4 text-emerald-400" />
                <p className="text-[9px] text-white/30 mt-1">{ach.date}</p>
              </>
            ) : (
              <>
                <Lock className="absolute top-2 right-2 w-4 h-4 text-white/20" />
                {ach.progress && (
                  <div className="mt-2">
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-amber-500/50"
                        style={{ width: `${ach.progress}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-amber-400/60 mt-1">{ach.progress}%</p>
                  </div>
                )}
              </>
            )}
          </motion.div>
        ))}
      </div>

      {/* Progress */}
      <div className="relative z-10 mt-5 pt-5 border-t border-white/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/40 tracking-wider font-semibold">Mastery Progress</span>
          <span className="text-xs font-bold text-amber-400">67%</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: '67%' }}
            transition={{ delay: 0.8, duration: 1 }}
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500"
            style={{ boxShadow: '0 0 10px rgba(212,175,55,0.5)' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
