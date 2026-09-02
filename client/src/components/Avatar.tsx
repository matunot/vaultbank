/**
 * Real-user avatar: renders the person's actual initials on a
 * deterministic gradient (no fake stock photos).
 */
const GRADIENTS = [
  'from-amber-400 to-orange-600',
  'from-cyan-400 to-blue-600',
  'from-emerald-400 to-teal-600',
  'from-violet-400 to-purple-600',
  'from-rose-400 to-pink-600',
  'from-indigo-400 to-blue-600',
];

const SIZES = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-12 h-12 text-sm',
  lg: 'w-14 h-14 text-base',
};

interface AvatarProps {
  name: string;
  size?: keyof typeof SIZES;
  ring?: boolean;
}

export default function Avatar({ name, size = 'md', ring = true }: AvatarProps) {
  const clean = (name || '?').trim();
  const initials =
    clean
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  const hash = clean.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const gradient = GRADIENTS[hash % GRADIENTS.length];

  return (
    <div
      className={`${SIZES[size]} rounded-full bg-linear-to-br ${gradient} flex items-center justify-center font-bold text-white shrink-0 ${ring ? 'ring-2 ring-white/10' : ''}`}
    >
      {initials}
    </div>
  );
}