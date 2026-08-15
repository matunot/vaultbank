import { memo } from 'react';
import { motion } from 'framer-motion';
import { Search, Crown, Globe, Moon, Sparkles } from 'lucide-react';
import NotificationsPanel from './NotificationsPanel';
import RichIcon from './RichIcon';

type ThemeName = 'obsidian' | 'royal' | 'diamond';

const themeOrder: ThemeName[] = ['obsidian', 'royal', 'diamond'];

/** Derive initials from a full name, e.g. "Sofia" → "S", "Diana Prince" → "DP" */
function getInitials(name?: string): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

const Header = memo(function Header({ theme, onThemeChange, user }: { theme: ThemeName; onThemeChange: (theme: ThemeName) => void; user?: any }) {
  const cycleTheme = () => {
    const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
    onThemeChange(next);
  };

  const themeLabel = theme === 'obsidian' ? 'Obsidian' : theme === 'royal' ? 'Royal' : 'Diamond';

  // Real authenticated user's display name (fallback to email prefix if name missing)
  const displayName = user?.fullName || (user?.email ? user.email.split('@')[0] : '');
  const initials = getInitials(displayName);

  return (
    <motion.header
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-30 px-5 lg:px-8 py-4"
    >
      <div className="glass-panel rounded-2xl px-4 lg:px-5 py-2.5 flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            placeholder="Search transactions, cards, contacts…"
            className="w-full glass-input pl-10 pr-4 py-2 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={cycleTheme}
            className="p-2 rounded-xl glass-btn"
            title={`Theme: ${themeLabel}`}
          >
            {theme === 'obsidian' && <Moon className="w-4 h-4 text-amber-300" />}
            {theme === 'royal' && <Sparkles className="w-4 h-4 text-sky-300" />}
            {theme === 'diamond' && <Crown className="w-4 h-4 text-cyan-100" />}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            className="px-2.5 py-2 rounded-xl glass-btn text-xs font-bold text-white/60 flex items-center gap-1.5"
          >
            <RichIcon icon={<Globe size={12} />} variant="cyan" size="sm" />
            <span className="hidden sm:inline">EN</span>
          </motion.button>

          <NotificationsPanel />

          <div className="w-px h-6 bg-white/10 mx-1" />

          <motion.div whileHover={{ scale: 1.03 }} className="flex items-center gap-2.5 cursor-pointer pl-1">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl overflow-hidden ring-2 ring-amber-500/40 glow-amber bg-linear-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                {initials ? (
                  <span className="text-xs font-bold text-amber-950">{initials}</span>
                ) : (
                  <img src="/avatar.jpg" alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5">
                <RichIcon icon={<Crown size={7} strokeWidth={3} />} variant="gold" size="sm" glow />
              </div>
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-bold text-white leading-tight">{displayName}</p>
              <p className="text-[10px] text-amber-400 font-semibold tracking-wider">OBSIDIAN MEMBER</p>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.header>
  );
});

export default Header;
