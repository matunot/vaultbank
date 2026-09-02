import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, CheckCircle2, XCircle, UserSearch } from 'lucide-react';
import { useAppStore } from '../store';
import { api } from '../api';
import Avatar from './Avatar';
import RichIcon from './RichIcon';

interface Recipient {
  name: string;
  email?: string;
  accountNumber?: string | null;
}

export default function QuickContacts() {
  const store = useAppStore();
  const [recents, setRecents] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // REAL recent recipients — from the user's actual transfer history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getTransfers();
        if (cancelled || !res.success || !Array.isArray(res.transfers)) return;
        const seen = new Set<string>();
        const rec: Recipient[] = [];
        for (const t of res.transfers) {
          const name = t.to_user_name || t.toUserName;
          if (name && !seen.has(name)) {
            seen.add(name);
            rec.push({ name, email: t.to_user_email || t.toUserEmail });
          }
        }
        setRecents(rec.slice(0, 8));
      } catch { /* best effort */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const send = async () => {
    if (!selected || !amount || parseFloat(amount) <= 0) return;
    setStatus('sending');
    setMessage('');
    try {
      await store.sendMoney(selected.accountNumber || selected.email || selected.name, parseFloat(amount));
      setStatus('success');
      setMessage(`Sent $${parseFloat(amount).toFixed(2)} to ${selected.name}`);
      setAmount('');
      setTimeout(() => { setStatus('idle'); setSelected(null); setMessage(''); }, 2500);
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Transfer failed');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.4 }}
      className="glass rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">Quick Send</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">REAL RECENT RECIPIENTS</p>
        </div>
        <span className="text-xs font-semibold text-blue-400 flex items-center gap-1">
          <UserSearch className="w-3 h-3" /> Real users
        </span>
      </div>

      <div className="relative z-10 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {loading && (
          <div className="flex items-center gap-2 text-white/40 text-xs py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your real transfers…
          </div>
        )}
        {!loading && recents.length === 0 && (
          <div className="text-white/40 text-xs py-4">
            No transfers yet — send money to a real VaultBank user and they'll show up here.
          </div>
        )}
        {recents.map((contact, i) => (
          <motion.button
            key={contact.email || contact.name}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            onClick={() => setSelected(contact)}
            className={`flex flex-col items-center gap-2 p-3 rounded-2xl min-w-[80px] transition-all ${
              selected?.name === contact.name
                ? 'bg-blue-500/10 border border-blue-500/30'
                : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04]'
            }`}
          >
            <Avatar name={contact.name} size="md" />
            <div className="text-center">
              <p className="text-xs font-medium text-white truncate max-w-[70px]">{contact.name.split(' ')[0]}</p>
              <p className="text-[9px] text-white/40 truncate max-w-[70px]">{contact.email}</p>
            </div>
          </motion.button>
        ))}

        {/* Add new */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex flex-col items-center gap-2 p-3 rounded-2xl min-w-[80px] bg-white/[0.02] border border-dashed border-white/10 hover:border-amber-500/30 transition-all"
        >
          <RichIcon icon={<UserSearch size={18} />} variant="gold" size="md" glow />
          <span className="text-xs font-medium text-white/60">Find</span>
        </motion.button>
      </div>

      {/* REAL send box */}
      {selected !== null && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 pt-4 border-t border-white/5"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-white/60">Sending real money to</span>
            <span className="text-sm font-semibold text-white">{selected.name}</span>
            <button onClick={() => setSelected(null)} className="ml-auto text-[10px] text-white/40 hover:text-white">Cancel</button>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
            />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={send}
              disabled={status === 'sending' || !amount}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-semibold text-sm flex items-center gap-2 glow-blue disabled:opacity-50"
            >
              {status === 'sending' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              ) : status === 'success' ? (
                <><CheckCircle2 className="w-4 h-4" /> Sent</>
              ) : (
                <><RichIcon icon={<Send size={14} />} variant="sapphire" size="sm" /> Send</>
              )}
            </motion.button>
          </div>
          {status === 'error' && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-400">
              <XCircle className="w-3.5 h-3.5" /> {message}
            </p>
          )}
          {status === 'success' && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> {message}
            </p>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
