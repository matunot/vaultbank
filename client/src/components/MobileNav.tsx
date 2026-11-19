import { useCallback, useEffect, useState } from 'react';
import {
  Home, CreditCard, TrendingUp, Send, History, Gem, Settings, LogOut, Vault, Landmark,
  PieChart, Mountain, Wallet, Zap, Shield, X, MoreHorizontal,
} from 'lucide-react';
import { navItems } from '../data';
import RichIcon from './RichIcon';

const DEV_ONLY_SECTIONS = ['invest', 'rewards'];
const visibleNavItems = import.meta.env.DEV
  ? navItems
  : navItems.filter((item) => !DEV_ONLY_SECTIONS.includes(item.id));

const iconMap: Record<string, React.ComponentType<any>> = {
  Home, Vault, CreditCard, TrendingUp, Send, History, Gem, Landmark, PieChart, Mountain, Wallet, Zap, Shield,
};

const variantMap: Record<string, 'gold' | 'emerald' | 'ruby' | 'sapphire' | 'amethyst' | 'amber' | 'cyan'> = {
  Home: 'gold', Vault: 'amethyst', CreditCard: 'sapphire', TrendingUp: 'emerald',
  Send: 'cyan', History: 'amber', Gem: 'ruby', Landmark: 'emerald', PieChart: 'sapphire',
  Mountain: 'ruby', Wallet: 'cyan', Zap: 'amethyst', Shield: 'sapphire',
};

// The four destinations a phone user needs every day. Everything else lives
// behind "More" so the bar never crowds a 360px viewport.
const primaryIds = ['home', 'payments', 'send', 'cards'];

interface Props {
  active: string;
  setActive: (id: string) => void;
  onSettings?: () => void;
  onLogout?: () => void;
}

export default function MobileNav({ active, setActive, onSettings, onLogout }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const close = useCallback(() => setMoreOpen(false), []);
  const select = useCallback((id: string) => {
    setActive(id);
    setMoreOpen(false);
  }, [setActive]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [moreOpen, close]);

  const primary = primaryIds
    .map((id) => visibleNavItems.find((item) => item.id === id))
    .filter(Boolean) as typeof navItems;

  const renderItem = (item: typeof navItems[number], size: 'bar' | 'sheet') => {
    const Icon = iconMap[item.icon] ?? Home;
    const isActive = active === item.id;
    if (size === 'bar') {
      // Keep the accessible name identical to the visible label ("Home", not
      // the internal route id "Dashboard") so voice control and tests agree.
      const label = item.label === 'Dashboard' ? 'Home' : item.label === 'Transfer' ? 'Send' : item.label;
      return (
        <button
          key={item.id}
          onClick={() => select(item.id)}
          aria-current={isActive ? 'page' : undefined}
          aria-label={label}
          className={`mobile-nav-item flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors ${
            isActive ? 'text-amber-300' : 'text-white/45 active:text-white/80'
          }`}
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${isActive ? 'bg-amber-400/15' : ''}`}>
            <Icon size={19} strokeWidth={isActive ? 2.4 : 1.8} />
          </span>
          <span className={`text-[10px] leading-none ${isActive ? 'font-semibold' : 'font-medium'}`}>
            {label}
          </span>
        </button>
      );
    }
    return (
      <button
        key={item.id}
        onClick={() => select(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
          isActive ? 'bg-amber-400/10 text-amber-200' : 'text-white/60 active:bg-white/5'
        }`}
      >
        <RichIcon
          icon={<Icon size={17} strokeWidth={isActive ? 2.4 : 2} />}
          variant={isActive ? (variantMap[item.icon] || 'gold') : 'gold'}
          size="sm"
          glow={isActive}
          className={isActive ? '' : 'opacity-60'}
        />
        <span className="text-sm font-medium">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="mobile-nav fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-0.5 border-t border-white/10 bg-[#08080f]/95 px-2 pt-1.5 backdrop-blur-md lg:hidden"
      >
        {primary.map((item) => renderItem(item, 'bar'))}
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More destinations"
          aria-expanded={moreOpen}
          className={`mobile-nav-item flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors ${
            moreOpen ? 'text-amber-300' : 'text-white/45 active:text-white/80'
          }`}
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${moreOpen ? 'bg-amber-400/15' : ''}`}>
            <MoreHorizontal size={19} strokeWidth={1.8} />
          </span>
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="All destinations">
          <button
            aria-label="Close menu"
            onClick={close}
            className="absolute inset-0 h-full w-full bg-black/60 vb-fade"
          />
          <div className="vb-sheet-in absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#0b0b13] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.25em] text-amber-300/60">VAULTBANK</p>
                <h2 className="font-display text-xl text-white">All destinations</h2>
              </div>
              <button
                onClick={close}
                aria-label="Close menu"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/60 active:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {visibleNavItems.map((item) => renderItem(item, 'sheet'))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
              <button
                onClick={() => { close(); onSettings?.(); }}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/5 px-3 text-sm font-semibold text-white/70 active:bg-white/10"
              >
                <Settings className="h-4 w-4" /> Settings
              </button>
              <button
                onClick={() => { close(); onLogout?.(); }}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-500/10 px-3 text-sm font-semibold text-rose-300 active:bg-rose-500/15"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
