import { memo } from 'react';
import { Landmark } from 'lucide-react';
import NotificationsPanel from './NotificationsPanel';

function getInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0].toUpperCase()).join('') || 'U';
}

const Header = memo(function Header({ user }: { user?: any }) {
  const displayName = user?.full_name || user?.fullName || (user?.email ? user.email.split('@')[0] : 'Account holder');
  const initials = getInitials(displayName);
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date());

  return (
    <header className="bank-topbar">
      <div className="bank-topbar__brand sm:hidden">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-teal-300/20 bg-teal-400/10 text-teal-200">
          <Landmark size={16} />
        </span>
        <span>VaultBank</span>
      </div>
      <div className="hidden min-w-0 sm:block">
        <p className="text-[10px] font-bold tracking-[0.16em] text-teal-200">PERSONAL BANKING</p>
        <p className="mt-1 text-xs text-slate-500">{dateLabel}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <NotificationsPanel />
        <div className="h-7 w-px bg-white/10" />
        <div className="bank-topbar__profile">
          <div className="bank-topbar__avatar" aria-hidden="true">{initials}</div>
          <div className="hidden min-w-0 sm:block">
            <p className="bank-topbar__name max-w-40 truncate">{displayName}</p>
            <p className="bank-topbar__meta">Personal account</p>
          </div>
        </div>
      </div>
    </header>
  );
});

export default Header;
