import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Check, AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { notifications } from '../data';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap: Record<string, string> = {
  success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

export default function NotificationsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifs, setNotifs] = useState(notifications);
  
  const unreadCount = notifs.filter(n => !n.read).length;
  
  const markAllRead = () => {
    setNotifs(notifs.map(n => ({ ...n, read: true })));
  };

  return (
    <>
      {/* Bell trigger */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(true)}
        className="relative p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
      >
        <Bell className="w-4 h-4 text-white/60" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-amber-950 text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-[#0d0d14] border-l border-white/10 z-50 overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl text-white">Notifications</h3>
                  <p className="text-xs text-white/40 mt-0.5">{unreadCount} unread</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={markAllRead}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setIsOpen(false)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto h-[calc(100vh-80px)] p-4 space-y-2">
                {notifs.map((notif, i) => {
                  const Icon = iconMap[notif.type];
                  return (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        notif.read 
                          ? 'bg-white/[0.02] border-white/5' 
                          : colorMap[notif.type]
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${notif.read ? 'text-white/40' : ''}`} />
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${notif.read ? 'text-white/60' : 'text-white'}`}>
                            {notif.title}
                          </p>
                          <p className="text-xs text-white/40 mt-0.5">{notif.message}</p>
                          <p className="text-[10px] text-white/30 mt-2">{notif.time}</p>
                        </div>
                        {!notif.read && (
                          <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
