import { useCallback, useEffect, useState } from 'react';
import {
  Home, CreditCard, Send, Settings, LogOut, Vault, Landmark, Wallet, Shield, X, MoreHorizontal, History, Gem, TrendingUp, PieChart, Mountain, Zap, CircleDollarSign,
} from 'lucide-react';
import { navItems } from '../data';

const DEV_ONLY_SECTIONS = ['invest', 'rewards'];
const visibleNavItems = import.meta.env.DEV
  ? navItems
  : navItems.filter((item) => !DEV_ONLY_SECTIONS.includes(item.id));

const iconMap: Record<string, React.ComponentType<any>> = {
  Home, Vault, CreditCard, TrendingUp, Send, History, Gem, Landmark, PieChart, Mountain, Wallet, Zap, Shield, CircleDollarSign,
};
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen, close]);

  const primary = primaryIds
    .map((id) => visibleNavItems.find((item) => item.id === id))
    .filter(Boolean) as typeof navItems;

  const renderSheetItem = (item: typeof navItems[number]) => {
    const Icon = iconMap[item.icon] ?? Home;
    const isActive = active === item.id;
    return (
      <button
        key={item.id}
        onClick={() => select(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={'flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition-colors ' + (isActive ? 'border-teal-300/20 bg-teal-400/10 text-teal-100' : 'border-transparent text-slate-300 hover:bg-white/5')}
      >
        <Icon size={18} className={isActive ? 'text-teal-200' : 'text-slate-400'} />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <>
      <nav aria-label="Mobile navigation" className="mobile-nav fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 px-2 pt-1.5 lg:hidden">
        {primary.map((item) => {
          const Icon = iconMap[item.icon] ?? Home;
          const isActive = active === item.id;
          const label = item.label === 'Dashboard' ? 'Home' : item.label === 'Transfer' ? 'Send' : item.label;
          return (
            <button
              key={item.id}
              onClick={() => select(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
              className={'mobile-nav-item flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold transition-colors ' + (isActive ? 'text-teal-200' : 'text-slate-500')}
            >
              <Icon size={19} strokeWidth={isActive ? 2.3 : 1.8} />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More destinations"
          aria-expanded={moreOpen}
          className={'mobile-nav-item flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold ' + (moreOpen ? 'text-teal-200' : 'text-slate-500')}
        >
          <MoreHorizontal size={20} />
          <span className="leading-none">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="All banking destinations">
          <button aria-label="Close menu" onClick={close} className="absolute inset-0 h-full w-full bg-black/65" />
          <section className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b1c2b] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-teal-200">VAULTBANK</p>
                <h2 className="mt-1 font-display text-xl text-white">All services</h2>
              </div>
              <button onClick={close} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300">
                <X size={19} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {visibleNavItems.map(renderSheetItem)}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
              <button onClick={() => { close(); onSettings?.(); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/5 px-3 text-sm font-semibold text-slate-300">
                <Settings size={16} /> Settings
              </button>
              <button onClick={() => { close(); onLogout?.(); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-400/10 px-3 text-sm font-semibold text-rose-200">
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
