import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, CreditCard, TrendingUp, Send, History, Gem, Settings, LogOut, Vault, ChevronLeft, Landmark, PieChart, Mountain, Wallet,
} from 'lucide-react';
import { navItems } from '../data';
import RichIcon from './RichIcon';

const iconMap: Record<string, React.ComponentType<any>> = {
  Home, Vault, CreditCard, TrendingUp, Send, History, Gem, Landmark, PieChart, Mountain, Wallet,
};

const variantMap: Record<string, 'gold' | 'emerald' | 'ruby' | 'sapphire' | 'amethyst' | 'amber' | 'cyan'> = {
  Home: 'gold', Vault: 'amethyst', CreditCard: 'sapphire', TrendingUp: 'emerald',
  Send: 'cyan', History: 'amber', Gem: 'ruby', Landmark: 'emerald', PieChart: 'sapphire', Mountain: 'ruby',
  Wallet: 'cyan',
};

interface Props {
  active: string;
  setActive: (id: string) => void;
  onSettings?: () => void;
  onLogout?: () => void;
}

export default function Sidebar({ active, setActive, onSettings, onLogout }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const toggle = useCallback(() => setCollapsed(c => !c), []);

  return (
    <motion.aside
      initial={{ x: -80, opacity: 0 }}
      animate={{ x: 0, opacity: 1, width: collapsed ? 88 : 260 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="h-screen glass-sidebar flex flex-col relative z-20 flex-shrink-0"
    >
      <div className="h-[2px] bg-gradient-to-r from-amber-400 via-purple-500 to-cyan-400" />

      {/* Logo */}
      <div className="p-5 lg:p-6 flex items-center gap-3 relative">
        <RichIcon icon={<Gem size={20} strokeWidth={2.5} />} variant="gold" size="lg" glow pulse />
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="font-display text-xl text-gold leading-none">VAULT</div>
              <div className="text-[9px] tracking-[0.3em] text-amber-300/50 mt-1">PRIVATE BANKING</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapse toggle */}
        <motion.button
          onClick={toggle}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#0f1629] border border-white/10 flex items-center justify-center z-50 shadow-xl"
        >
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ type: 'spring', stiffness: 300 }}>
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </motion.div>
        </motion.button>
      </div>

      {/* Nav */}
      <nav className="px-3 flex-1 space-y-1 mt-2 overflow-y-auto">
        {navItems.map((item, i) => {
          const Icon = iconMap[item.icon] ?? Home;
          const isActive = active === item.id;
          return (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 + i * 0.04 }}
              onClick={() => setActive(item.id)}
              whileHover={{ x: 4 }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all relative group ${
                isActive ? 'text-amber-200' : 'text-white/40 hover:text-white/80'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="active-nav-bg"
                  className="absolute inset-0 rounded-xl glass-btn border-amber-500/20"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div className="relative z-10 flex-shrink-0">
                <RichIcon
                  icon={<Icon size={17} strokeWidth={isActive ? 2.5 : 2} />}
                  variant={isActive ? (variantMap[item.icon] || 'gold') : 'gold'}
                  size="sm"
                  glow={isActive}
                  pulse={isActive}
                  className={isActive ? '' : 'opacity-40 group-hover:opacity-70'}
                />
              </div>
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`relative z-10 text-sm whitespace-nowrap overflow-hidden ${isActive ? 'font-semibold' : 'font-medium'}`}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {isActive && (
                <motion.div
                  layoutId="active-dot"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-gradient-to-b from-amber-300 to-amber-600"
                  style={{ boxShadow: '0 0 12px rgba(212,175,55,0.6)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-white/5 space-y-1">
        <button onClick={onSettings} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/5 transition-all">
          <RichIcon icon={<Settings size={17} />} variant="sapphire" size="sm" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm font-medium whitespace-nowrap">
                Settings
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-white/40 hover:text-rose-400 hover:bg-rose-500/5 transition-all">
          <RichIcon icon={<LogOut size={17} />} variant="ruby" size="sm" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm font-medium whitespace-nowrap">
                Sign out
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
