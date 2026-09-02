import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Globe, Plus, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';
import { api } from '../api';
import { TransferModal } from './Modals';
import Avatar from './Avatar';

interface Recipient {
  name: string;
  email?: string;
}

export default function TransferSection() {
  const [showModal, setShowModal] = useState(false);
  const store = useAppStore();
  const [recents, setRecents] = useState<Recipient[]>([]);
  const [stats, setStats] = useState({ sentThisMonth: 0, completed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);

  // REAL data — derived from the user's actual transfer history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getTransfers();
        if (cancelled || !res.success || !Array.isArray(res.transfers)) return;
        const transfers = res.transfers;

        // REAL frequent recipients
        const seen = new Set<string>();
        const rec: Recipient[] = [];
        for (const t of transfers) {
          const name = t.to_user_name || t.toUserName;
          if (name && !seen.has(name)) {
            seen.add(name);
            rec.push({ name, email: t.to_user_email || t.toUserEmail });
          }
          if (rec.length >= 5) break;
        }
        setRecents(rec);

        // REAL stats
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let sentThisMonth = 0, completed = 0, failed = 0;
        for (const t of transfers) {
          const amt = Math.abs(parseFloat(t.amount) || 0);
          const when = new Date(t.created_at || t.createdAt || Date.now());
          if ((t.from_user_id || t.fromUserId) && when >= monthStart) sentThisMonth += amt;
          const st = (t.status || '').toLowerCase();
          if (st === 'completed') completed++;
          if (st === 'failed') failed++;
        }
        setStats({ sentThisMonth, completed, failed });
      } catch { /* best effort */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSend = async (recipient: string, amount: number, note?: string) => {
    await store.sendMoney(recipient, amount, note);
    setShowModal(false);
  };

  return (
    <div className="space-y-5">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-3xl p-6 lg:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-cyan-500/15 rounded-full blur-3xl" />
        <div className="relative z-10">
          <p className="text-xs tracking-widest text-white/40 font-semibold">QUICK TRANSFER</p>
          <p className="font-display text-5xl lg:text-6xl text-white mt-2">
            Send Money<span className="text-cyan-400">.</span>
          </p>
          <p className="text-sm text-white/40 mt-2">Instant, free, and secure transfers to anyone.</p>

          <div className="flex flex-wrap gap-3 mt-6">
            <motion.button
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-linear-to-r from-cyan-400 via-blue-500 to-indigo-500 text-white font-bold shadow-lg glow-blue"
            >
              <Send className="w-4 h-4" /> New Transfer
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="flex items-center gap-2 px-5 py-3 rounded-xl glass-btn text-sm font-semibold text-white/80">
              <Globe className="w-4 h-4" /> International Wire
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="flex items-center gap-2 px-5 py-3 rounded-xl glass-btn text-sm font-semibold text-white/80">
              <Plus className="w-4 h-4" /> Schedule Payment
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* REAL frequent contacts */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-1">Frequent Contacts</h3>
        <p className="text-[10px] tracking-widest text-white/30 mb-5">REAL RECIPIENTS FROM YOUR TRANSFER HISTORY</p>
        {loading ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your real transfers…
          </div>
        ) : recents.length === 0 ? (
          <div className="py-4 text-sm text-white/40">
            No transfers yet — send your first real transfer and your recipients will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {recents.map((c, i) => (
              <motion.button
                key={c.email || c.name}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + i * 0.06 }}
                whileHover={{ y: -4, scale: 1.03 }}
                onClick={() => setShowModal(true)}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/3 border border-white/5 hover:border-cyan-500/30 hover:bg-white/6 transition-all"
              >
                <Avatar name={c.name} size="lg" />
                <div className="text-center">
                  <p className="text-xs font-medium text-white truncate max-w-24">{c.name}</p>
                  <p className="text-[10px] text-white/40 truncate max-w-24">{c.email}</p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </motion.div>

      {/* REAL stats */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-3 gap-5">
        <div className="glass-panel rounded-3xl p-6 text-center">
          <p className="text-3xl font-display text-white">{store.formatMoney(stats.sentThisMonth)}</p>
          <p className="text-xs text-white/40 mt-1">Sent this month</p>
        </div>
        <div className="glass-panel rounded-3xl p-6 text-center">
          <p className="text-3xl font-display text-emerald-400">{stats.completed}</p>
          <p className="text-xs text-white/40 mt-1">Completed transfers</p>
        </div>
        <div className="glass-panel rounded-3xl p-6 text-center">
          <p className="text-3xl font-display text-amber-400">{stats.failed}</p>
          <p className="text-xs text-white/40 mt-1">Failed transfers</p>
        </div>
      </motion.div>

      <TransferModal isOpen={showModal} onClose={() => setShowModal(false)} onSend={handleSend} />
    </div>
  );
}