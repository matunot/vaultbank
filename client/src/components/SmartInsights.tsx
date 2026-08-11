import { motion } from 'framer-motion';
import { Sparkles, TrendingUp, Lightbulb, AlertTriangle, Wallet } from 'lucide-react';
import RichIcon from './RichIcon';

const insights = [
  { id: 1, type: 'tip',      icon: Lightbulb,   color: 'text-amber-400',  bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'Your dining spend is 18% higher than last month. Consider cooking at home 2 more nights.' },
  { id: 2, type: 'growth',   icon: TrendingUp,  color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'Your investments gained $2,840 this week. AAPL and NVDA are your top performers.' },
  { id: 3, type: 'warning',  icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'Rent ($3,500) is due in 4 days. Available balance covers it comfortably.' },
  { id: 4, type: 'savings',  icon: Wallet,      color: 'text-blue-400',   bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'You\'re on track to hit your Maldives goal by May 2025. Keep it up!' },
];

export default function SmartInsights() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.5 }}
      className="glass rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-5">
        <div>
          <h3 className="font-display text-2xl text-white">AI Insights</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">PERSONALIZED FOR YOU</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-btn border border-purple-500/20">
          <RichIcon icon={<Sparkles size={12} />} variant="amethyst" size="sm" pulse />
          <span className="text-[10px] font-semibold text-purple-400">AI POWERED</span>
        </div>
      </div>

      <div className="relative z-10 space-y-3">
        {insights.map((insight, i) => {
          const Icon = insight.icon;
          return (
            <motion.div
              key={insight.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.08 }}
              whileHover={{ x: 4 }}
              className={`p-4 rounded-2xl ${insight.bg} ${insight.border} border cursor-pointer transition-all`}
            >
              <div className="flex items-start gap-3">
                <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${insight.color}`} />
                <p className={`text-sm leading-relaxed ${insight.color.replace('text-', 'text-').replace('400', '300')}`}>
                  {insight.text}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
