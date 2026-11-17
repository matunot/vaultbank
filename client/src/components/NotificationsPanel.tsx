import { useState, useEffect, useCallback } from 'react';
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
    let disposed = false;
    let inFlight = false;

    const refreshVisibleAlerts = () => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      void fetchAlerts().finally(() => { inFlight = false; });
    };

    refreshVisibleAlerts();
    const unsub = refreshBus.subscribe(refreshVisibleAlerts);
    const poll = window.setInterval(refreshVisibleAlerts, 60000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshVisibleAlerts();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      unsub();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchAlerts]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const unreadCount = alerts.filter(n => !n.read).length;

  const markAllRead = async () => {
    setAlerts(prev => prev.map(n => ({ ...n, read: true })));
    try { await api.markAllAlertsRead(); } catch { /* best effort */ }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        className="relative p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-transform duration-200 hover:scale-105 active:scale-90"
      >
        <Bell className="w-4 h-4 text-white/60" />
        {unreadCount > 0 && (
          <span className="vb-scale-in absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-amber-950 text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            onClick={() => setIsOpen(false)}
            className="vb-fade fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            className="vb-drawer-in fixed top-0 right-0 h-full w-full max-w-md bg-[#0d0d14] border-l border-white/10 z-50 overflow-hidden"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <div>
                <h3 className="font-display text-xl text-white">Notifications</h3>
                <p className="text-xs text-white/40 mt-0.5">{unreadCount} unread · Account updates</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchAlerts}
                  aria-label="Refresh notifications"
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={markAllRead}
                  aria-label="Mark all notifications read"
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close notifications"
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
                  No updates yet. Account activity and service messages will appear here.
                </div>
              ) : (
                alerts.map((alert, i) => {
                  const Icon = iconMap[alert.type] || iconMap[alert.severity ?? "info"] || Info;
                  const colorClass = colorMap[alert.type] || colorMap[alert.severity ?? "info"] || colorMap.info;
                  return (
                    <div
                      key={alert.id}
                      className={`vb-slide-right p-4 rounded-2xl border transition-all cursor-pointer ${
                        alert.read
                          ? 'bg-white/2 border-white/5'
                          : colorClass
                      }`}
                      style={{ '--vb-delay': `${Math.min(i * 50, 300)}ms` } as React.CSSProperties}
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
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
