import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Clock, Star } from 'lucide-react';
import { contacts } from '../data';
import RichIcon from './RichIcon';

export default function QuickContacts() {
  const [selected, setSelected] = useState<number | null>(null);

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
          <p className="text-xs text-white/40 mt-1 tracking-wider">RECENT CONTACTS</p>
        </div>
        <button className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1">
          View all <Send className="w-3 h-3" />
        </button>
      </div>

      <div className="relative z-10 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {contacts.map((contact, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            onClick={() => setSelected(i)}
            className={`flex flex-col items-center gap-2 p-3 rounded-2xl min-w-[80px] transition-all ${
              selected === i 
                ? 'bg-blue-500/10 border border-blue-500/30' 
                : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04]'
            }`}
          >
            <div className="relative">
              <img 
                src={contact.img} 
                alt={contact.name}
                className="w-12 h-12 rounded-full object-cover ring-2 ring-white/10"
              />
              {contact.recent && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                  <Clock className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-white truncate max-w-[70px]">{contact.name.split(' ')[0]}</p>
              <p className="text-[9px] text-white/40">{contact.handle}</p>
            </div>
          </motion.button>
        ))}
        
        {/* Add new */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex flex-col items-center gap-2 p-3 rounded-2xl min-w-[80px] bg-white/[0.02] border border-dashed border-white/10 hover:border-amber-500/30 transition-all"
        >
          <RichIcon icon={<Star size={18} />} variant="gold" size="md" glow />
          <span className="text-xs font-medium text-white/60">Add</span>
        </motion.button>
      </div>

      {/* Send button */}
      {selected !== null && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 pt-4 border-t border-white/5"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-white/60">Sending to</span>
            <span className="text-sm font-semibold text-white">{contacts[selected].name}</span>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Amount"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500/40"
            />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-semibold text-sm flex items-center gap-2 glow-blue"
            >
              <RichIcon icon={<Send size={14} />} variant="sapphire" size="sm" /> Send
            </motion.button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
