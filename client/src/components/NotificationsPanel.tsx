import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Check, AlertTriangle, Info, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { refreshBus } from '../refreshBus';

interface RealAlert {
  id: string;
  type: string;
  message: string;
  severity?: string;
  read: boolean;
  createdAt: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
  error: AlertTriangle,
};

const colorMap: Record<string, string> = {
  success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  error: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
};

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<RealAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await api.getAlerts();
      const list = res.data?.alerts || res.alerts || [];
      if (Array.isArray(list)) setAlerts(list);
    } catch { /* best effort */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const unsub = refreshBus.subscribe(fetchAlerts);
    const poll = setInterval(fetchAlerts, 20000);
    return () => { unsub(); clearInterval(poll); };
  }, [fetchAlerts]);

  const unreadCount = alerts.filter(n => !n.read).length;

  const markAllRead = async () => {
    setAlerts(prev => prev.map(n => ({ ...n, read: true })));
    try { await api.markAllAlertsRead(); } catch { /* best effort */ }
  };

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(true)}
        className="relative p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
      >
        <Bell className="w-4 h-4 text-white/60" />
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-amber-950 text-[10px] font-bold flex items-center justify-center"
          >
            {unreadCount}
          </motion.span>
        )}
      </motion.button>

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
                  <p className="text-xs text-white/40 mt-0.5">{unreadCount} unread · REAL account alerts</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchAlerts}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
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
                {loading ? (
                  <div className="flex items-center gap-2 text-white/40 text-sm py-8 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" /> Loading real alerts…
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="text-sm text-white/40 py-8 text-center">
                    No alerts yet. Money you send or receive will show up here.
                  </div>
                ) : (
                  alerts.map((alert, i) => {
                    const Icon = iconMap[alert.type] || iconMap[alert.severity ?? "info"] || Info;
                    const colorClass = colorMap[alert.type] || colorMap[alert.severity ?? "info"] || colorMap.info;
                    return (
                      <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                          alert.read
                            ? 'bg-white/2 border-white/5'
                            : colorClass
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${alert.read ? 'text-white/40' : ''}`} />
                          <div className="flex-1">
                            <p className={`text-sm font-semibold ${alert.read ? 'text-white/60' : 'text-white'}`}>
                              {alert.type === 'success' ? '💰 Money Received' : alert.type.charAt(0).toUpperCase() + alert.type.slice(1)}
                            </p>
                            <p className="text-xs text-white/40 mt-0.5">{alert.message}</p>
                            <p className="text-[10px] text-white/30 mt-2">{timeAgo(alert.createdAt)}</p>
                          </div>
                          {!alert.read && (
                            <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
