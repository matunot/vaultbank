import { motion } from 'framer-motion';

interface RichIconProps {
  icon: React.ReactNode;
  variant?: 'gold' | 'emerald' | 'ruby' | 'sapphire' | 'amethyst' | 'amber' | 'cyan' | 'rose';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  glow?: boolean;
  pulse?: boolean;
  float?: boolean;
  className?: string;
}

const variants = {
  gold: {
    bg: 'from-amber-400/30 via-yellow-500/20 to-amber-600/30',
    border: 'border-amber-500/30',
    glow: '0 0 24px rgba(212,175,55,0.35), 0 0 48px rgba(212,175,55,0.15)',
    text: 'text-amber-300',
    shimmer: 'from-amber-300/50 via-yellow-200/40 to-transparent',
    ring: 'ring-amber-500/20',
  },
  emerald: {
    bg: 'from-emerald-400/30 via-green-500/20 to-emerald-600/30',
    border: 'border-emerald-500/30',
    glow: '0 0 24px rgba(16,185,129,0.35), 0 0 48px rgba(16,185,129,0.15)',
    text: 'text-emerald-300',
    shimmer: 'from-emerald-300/50 via-green-200/40 to-transparent',
    ring: 'ring-emerald-500/20',
  },
  ruby: {
    bg: 'from-rose-400/30 via-red-500/20 to-rose-600/30',
    border: 'border-rose-500/30',
    glow: '0 0 24px rgba(239,68,68,0.35), 0 0 48px rgba(239,68,68,0.15)',
    text: 'text-rose-300',
    shimmer: 'from-rose-300/50 via-red-200/40 to-transparent',
    ring: 'ring-rose-500/20',
  },
  sapphire: {
    bg: 'from-blue-400/30 via-indigo-500/20 to-blue-600/30',
    border: 'border-blue-500/30',
    glow: '0 0 24px rgba(59,130,246,0.35), 0 0 48px rgba(59,130,246,0.15)',
    text: 'text-blue-300',
    shimmer: 'from-blue-300/50 via-indigo-200/40 to-transparent',
    ring: 'ring-blue-500/20',
  },
  amethyst: {
    bg: 'from-purple-400/30 via-violet-500/20 to-purple-600/30',
    border: 'border-purple-500/30',
    glow: '0 0 24px rgba(168,85,247,0.35), 0 0 48px rgba(168,85,247,0.15)',
    text: 'text-purple-300',
    shimmer: 'from-purple-300/50 via-violet-200/40 to-transparent',
    ring: 'ring-purple-500/20',
  },
  amber: {
    bg: 'from-orange-400/30 via-amber-500/20 to-orange-600/30',
    border: 'border-orange-500/30',
    glow: '0 0 24px rgba(245,158,11,0.35), 0 0 48px rgba(245,158,11,0.15)',
    text: 'text-orange-300',
    shimmer: 'from-orange-300/50 via-amber-200/40 to-transparent',
    ring: 'ring-orange-500/20',
  },
  cyan: {
    bg: 'from-cyan-400/30 via-teal-500/20 to-cyan-600/30',
    border: 'border-cyan-500/30',
    glow: '0 0 24px rgba(34,211,238,0.35), 0 0 48px rgba(34,211,238,0.15)',
    text: 'text-cyan-300',
    shimmer: 'from-cyan-300/50 via-teal-200/40 to-transparent',
    ring: 'ring-cyan-500/20',
  },
  rose: {
    bg: 'from-pink-400/30 via-rose-500/20 to-pink-600/30',
    border: 'border-pink-500/30',
    glow: '0 0 24px rgba(236,72,153,0.35), 0 0 48px rgba(236,72,153,0.15)',
    text: 'text-pink-300',
    shimmer: 'from-pink-300/50 via-rose-200/40 to-transparent',
    ring: 'ring-pink-500/20',
  },
};

const sizes = {
  sm: { wrapper: 'w-9 h-9', icon: 15, blur: 'w-12 h-12' },
  md: { wrapper: 'w-12 h-12', icon: 19, blur: 'w-16 h-16' },
  lg: { wrapper: 'w-14 h-14', icon: 22, blur: 'w-20 h-20' },
  xl: { wrapper: 'w-16 h-16', icon: 26, blur: 'w-24 h-24' },
};

export default function RichIcon({
  icon,
  variant = 'gold',
  size = 'md',
  glow = false,
  pulse = false,
  float = false,
  className = '',
}: RichIconProps) {
  const v = variants[variant];
  const s = sizes[size];

  return (
    <motion.div
      whileHover={{ scale: 1.08, rotate: 3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
      className={`relative ${s.wrapper} flex items-center justify-center shrink-0 ${className}`}
    >
      {/* Ambient glow behind */}
      {glow && (
        <div
          className={`absolute ${s.blur} rounded-full opacity-50 -z-10`}
          style={{
            background: v.glow.replace('0 0 24px', '').replace('0 0 48px', '').split(',')[0].replace('rgba', 'radial-gradient(circle, rgba').replace(')', '))'),
            filter: 'blur(12px)',
          }}
        />
      )}

      {/* Soft blurred glow orb */}
      {glow && (
        <div
          className={`absolute ${s.blur} rounded-full -z-10`}
          style={{ boxShadow: v.glow, opacity: 0.6 }}
        />
      )}

      {/* Main icon container */}
      <div
        className={`
          ${s.wrapper} rounded-xl
          bg-gradient-to-br ${v.bg}
          border ${v.border}
          flex items-center justify-center
          relative overflow-hidden
          ring-1 ${v.ring}
          backdrop-blur-sm
        `}
        style={{
          boxShadow: glow
            ? `${v.glow}, inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.1)`
            : 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.1)',
        }}
      >
        {/* Glass reflection */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent opacity-50" />

        {/* Shimmer sweep */}
        <motion.div
          animate={{ x: ['-150%', '150%'] }}
          transition={{ duration: 3, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' }}
          className={`absolute inset-0 bg-gradient-to-r ${v.shimmer}`}
          style={{ width: '40%', transform: 'skewX(-15deg)' }}
        />

        {/* Icon */}
        <div className={`relative z-10 ${v.text}`}>
          {icon}
        </div>
      </div>

      {/* Pulse ring */}
      {pulse && (
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          className={`absolute ${s.wrapper} rounded-xl border ${v.border} -z-10`}
        />
      )}

      {/* Float animation */}
      {float && (
        <motion.div
          animate={{ y: [-2, 2, -2] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className={`absolute ${s.wrapper} ${v.text} flex items-center justify-center`}
        >
          {icon}
        </motion.div>
      )}
    </motion.div>
  );
}

// Mini version for inline/text usage
export function RichIconInline({
  icon,
  variant = 'gold',
  size,
  className = '',
}: {
  icon: React.ReactNode;
  variant?: keyof typeof variants;
  size?: number;
  className?: string;
}) {
  const v = variants[variant];
  void size;
  return (
    <div
      className={`inline-flex items-center justify-center rounded-lg bg-gradient-to-br ${v.bg} border ${v.border} ${v.text} p-1.5 ${className}`}
      style={{
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15)`,
      }}
    >
      {icon}
    </div>
  );
}
