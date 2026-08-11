import { motion } from 'framer-motion';
import { Calendar, AlertCircle } from 'lucide-react';
import { calendarEvents } from '../data';
import RichIcon from './RichIcon';

export default function CalendarEvents() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.35 }}
      className="glass rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Upcoming</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">NEXT 14 DAYS</p>
        </div>
        <RichIcon icon={<Calendar size={20} />} variant="amber" size="lg" glow />
      </div>

      <div className="relative z-10 space-y-3">
        {calendarEvents.map((event, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + i * 0.08 }}
            className={`flex items-center gap-4 p-3 rounded-2xl border transition-all cursor-pointer ${
              event.type === 'bill' 
                ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10' 
                : event.type === 'holiday'
                  ? 'bg-purple-500/5 border-purple-500/20 hover:bg-purple-500/10'
                  : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center ${
              event.type === 'bill' 
                ? 'bg-amber-500/10' 
                : event.type === 'holiday'
                  ? 'bg-purple-500/10'
                  : 'bg-white/5'
            }`}>
              <span className="text-lg font-display text-white">{event.day}</span>
              <span className="text-[9px] text-white/40 uppercase">{event.month}</span>
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white text-sm">{event.title}</p>
                {event.type === 'bill' && <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              <p className="text-xs text-white/40 mt-0.5 capitalize">{event.type}</p>
            </div>
            
            {event.amount && (
              <div className="text-right">
                <span className="font-bold text-amber-400">${event.amount.toLocaleString()}</span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Total bills */}
      <div className="relative z-10 mt-5 pt-5 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40 tracking-wider font-semibold">UPCOMING BILLS</span>
          <span className="font-display text-lg text-amber-400">
            ${calendarEvents.filter(e => e.type === 'bill').reduce((s, e) => s + (e.amount || 0), 0).toLocaleString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
