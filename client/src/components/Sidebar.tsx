import { useState, useCallback } from 'react';
import {
  Home, CreditCard, TrendingUp, Send, History, Gem, Settings, LogOut, Vault, ChevronLeft, Landmark, PieChart, Mountain, Wallet, Zap,
} from 'lucide-react';
import { navItems } from '../data';

const DEV_ONLY_SECTIONS = ['invest', 'rewards'];
const visibleNavItems = import.meta.env.DEV
  ? navItems
  : navItems.filter((item) => !DEV_ONLY_SECTIONS.includes(item.id));

const iconMap: Record<string, React.ComponentType<any>> = {
  Home, Vault, CreditCard, TrendingUp, Send, History, Gem, Landmark, PieChart, Mountain, Wallet, Zap,
};

const groups = [
  { label: 'Overview', ids: ['home'] },
  { label: 'Banking', ids: ['vault', 'cards', 'payments', 'send', 'history'] },
  { label: 'Services', ids: ['swiss', 'invest', 'loans', 'rewards', 'security'] },
];

interface Props {
  active: string;
  setActive: (id: string) => void;
  onSettings?: () => void;
  onLogout?: () => void;
}

export default function Sidebar({ active, setActive, onSettings, onLogout }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((value) => !value), []);

  return (
    <aside
      aria-label="Primary navigation"
      style={{ width: collapsed ? 84 : 264 }}
      className="bank-sidebar hidden lg:flex h-screen sticky top-0 flex-col relative z-20 shrink-0 overflow-hidden transition-[width] duration-200"
    >
      <div className="h-0.5 bg-gradient-to-r from-teal-400 via-emerald-400 to-sky-400" />
      <div className="bank-sidebar__brand flex items-center gap-3 relative">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-teal-300/20 bg-teal-400/10 text-teal-200">
          <Landmark size={21} strokeWidth={1.9} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-display text-xl leading-none text-slate-100">VaultBank</div>
            <div className="mt-1 text-[9px] font-bold tracking-[0.18em] text-slate-500">PERSONAL BANKING</div>
          </div>
        )}
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          className="absolute -right-3 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-[#10283d] text-slate-400 shadow-lg hover:text-white"
        >
          <ChevronLeft className={'h-4 w-4 transition-transform ' + (collapsed ? 'rotate-180' : '')} />
        </button>
      </div>

      <nav className="bank-sidebar__nav" aria-label="Banking sections">
        {groups.map((group) => {
          const items = group.ids
            .map((id) => visibleNavItems.find((item) => item.id === id))
            .filter(Boolean) as typeof navItems;
          if (!items.length) return null;
          return (
            <div key={group.label}>
              {!collapsed && <p className="bank-sidebar__group">{group.label}</p>}
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = iconMap[item.icon] ?? Home;
                  const isActive = active === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActive(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={item.label}
                      title={collapsed ? item.label : undefined}
                      className="bank-sidebar__item"
                      style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.25 : 1.8} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="bank-sidebar__footer space-y-1">
        <button onClick={onSettings} className="flex w-full items-center gap-3 px-3 text-sm font-semibold" aria-label="Settings" title={collapsed ? 'Settings' : undefined} style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <Settings size={18} />
          {!collapsed && <span>Settings</span>}
        </button>
        <button onClick={onLogout} className="flex w-full items-center gap-3 px-3 text-sm font-semibold hover:!text-rose-300" aria-label="Sign out" title={collapsed ? 'Sign out' : undefined} style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <LogOut size={18} />
          {!collapsed && <span>Sign out</span>}
        </button>
        {!collapsed && (
          <div className="px-3 pt-4 text-[10px] leading-relaxed text-slate-600">
            Your accounts and services, in one place.
          </div>
        )}
      </div>
    </aside>
  );
}
