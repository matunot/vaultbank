import { motion } from 'framer-motion';
import { Send, Globe, Plus } from 'lucide-react';
import { useAppStore } from '../store';
import { TransferModal } from './Modals';
import { useState } from 'react';

export default function TransferSection() {
  const [showModal, setShowModal] = useState(false);
  const store = useAppStore();

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
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 text-white font-bold shadow-lg glow-blue"
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

      {/* Quick Contacts */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-3xl p-6">
        <h3 className="font-display text-xl text-white mb-5">Frequent Contacts</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {store.contacts.map((c, i) => (
            <motion.button
              key={c.name}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 + i * 0.06 }}
              whileHover={{ y: -4, scale: 1.03 }}
              onClick={() => setShowModal(true)}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/30 hover:bg-white/[0.06] transition-all"
            >
              <div className="relative">
                <img src={c.img} alt={c.name} className="w-14 h-14 rounded-full object-cover ring-2 ring-white/10" />
                {c.recent && (
                  <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#08080c]" />
                )}
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-white truncate max-w-[80px]">{c.name}</p>
                <p className="text-[10px] text-white/40">{c.handle}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-3 gap-5">
        <div className="glass-panel rounded-3xl p-6 text-center">
          <p className="text-3xl font-display text-white">$2,915</p>
          <p className="text-xs text-white/40 mt-1">Sent this month</p>
        </div>
        <div className="glass-panel rounded-3xl p-6 text-center">
          <p className="text-3xl font-display text-emerald-400">12</p>
          <p className="text-xs text-white/40 mt-1">Active transfers</p>
        </div>
        <div className="glass-panel rounded-3xl p-6 text-center">
          <p className="text-3xl font-display text-amber-400">0</p>
          <p className="text-xs text-white/40 mt-1">Failed transfers</p>
        </div>
      </motion.div>

      <TransferModal isOpen={showModal} onClose={() => setShowModal(false)} onSend={handleSend} contacts={store.contacts} />
    </div>
  );
}