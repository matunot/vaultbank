interface RichIconProps {
  icon: React.ReactNode;
  variant?: 'gold' | 'emerald' | 'ruby' | 'sapphire' | 'amethyst' | 'amber' | 'cyan' | 'rose';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  glow?: boolean;
  pulse?: boolean;
  float?: boolean;
  className?: string;
}

const variants: Record<NonNullable<RichIconProps['variant']>, string> = {
  gold: 'bg-teal-400/10 border-teal-300/20 text-teal-200',
  emerald: 'bg-emerald-400/10 border-emerald-300/20 text-emerald-200',
  ruby: 'bg-rose-400/10 border-rose-300/20 text-rose-200',
  sapphire: 'bg-sky-400/10 border-sky-300/20 text-sky-200',
  amethyst: 'bg-slate-400/10 border-slate-300/20 text-slate-200',
  amber: 'bg-cyan-400/10 border-cyan-300/20 text-cyan-200',
  cyan: 'bg-teal-400/10 border-teal-300/20 text-teal-200',
  rose: 'bg-rose-400/10 border-rose-300/20 text-rose-200',
};

const sizes = {
  sm: 'h-9 w-9 [&>svg]:h-4 [&>svg]:w-4',
  md: 'h-11 w-11 [&>svg]:h-5 [&>svg]:w-5',
  lg: 'h-12 w-12 [&>svg]:h-5 [&>svg]:w-5',
  xl: 'h-14 w-14 [&>svg]:h-6 [&>svg]:w-6',
};

export default function RichIcon({ icon, variant = 'gold', size = 'md', className = '' }: RichIconProps) {
  return (
    <span
      aria-hidden="true"
      className={'inline-flex shrink-0 items-center justify-center rounded-xl border ' + variants[variant] + ' ' + sizes[size] + ' ' + className}
    >
      {icon}
    </span>
  );
}

export function RichIconInline({
  icon,
  variant = 'gold',
  className = '',
}: {
  icon: React.ReactNode;
  variant?: keyof typeof variants;
  size?: number;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={'inline-flex items-center justify-center rounded-lg border p-1.5 ' + variants[variant] + ' ' + className}>
      {icon}
    </span>
  );
}
