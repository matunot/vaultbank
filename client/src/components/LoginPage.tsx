import { useState } from 'react';
import { ShieldCheck, Eye, EyeOff, ArrowRight, Lock, User, Zap, Diamond } from 'lucide-react';
import { api } from '../api';

interface Props {
  onLogin: () => void;
  onSwitchToSignup: () => void;
}

const sparkles = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 3 + 0.5,
  delay: Math.random() * 8,
  duration: 4 + Math.random() * 6,
  glow: i % 4 === 0 ? 'rgba(212,175,55,0.9)' : i % 4 === 1 ? 'rgba(255,255,255,0.7)' : i % 4 === 2 ? 'rgba(224,242,254,0.6)' : 'rgba(168,85,247,0.4)',
  driftX: (Math.random() - 0.5) * 40,
}));

export default function LoginPage({ onLogin, onSwitchToSignup }: Props) {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please enter your credentials');
      return;
    }
    setLoading(true);
    try {
      const result = await api.login(email, password);
      if (result.success) {
        onLogin();
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen relative overflow-hidden flex items-center justify-center p-4" style={{ background: '#050508' }}>
      {/* Ultra-luxury layered background with deep gold/diamond fields */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{
          background: `
            radial-gradient(ellipse 70% 55% at 12% 18%, rgba(212,175,55,0.18) 0%, transparent 60%),
            radial-gradient(ellipse 55% 75% at 85% 25%, rgba(224,242,254,0.12) 0%, transparent 55%),
            radial-gradient(ellipse 65% 45% at 75% 82%, rgba(168,85,247,0.08) 0%, transparent 50%),
            radial-gradient(ellipse 45% 65% at 22% 78%, rgba(16,185,129,0.06) 0%, transparent 45%),
            radial-gradient(ellipse 100% 100% at 50% 50%, rgba(20,15,30,0.4), transparent),
            linear-gradient(165deg, #050508 0%, #0b0815 25%, #09090b 55%, #040408 100%)
          `
        }} />

        {/* Diamond sparkle field */}
        <div className="absolute inset-0" style={{
          backgroundImage: `
            radial-gradient(circle at 18% 20%, rgba(255,255,255,0.9) 0 1px, transparent 1.5px),
            radial-gradient(circle at 72% 10%, rgba(212,175,55,0.95) 0 1px, transparent 1.5px),
            radial-gradient(circle at 80% 55%, rgba(224,242,254,0.85) 0 1px, transparent 1.5px),
            radial-gradient(circle at 32% 65%, rgba(255,255,255,0.75) 0 1px, transparent 1.5px),
            radial-gradient(circle at 55% 40%, rgba(212,175,55,0.8) 0 1px, transparent 1.5px),
            radial-gradient(circle at 90% 80%, rgba(168,85,247,0.6) 0 1px, transparent 1.5px),
            radial-gradient(circle at 10% 85%, rgba(255,255,255,0.7) 0 1px, transparent 1.5px)
          `,
          backgroundSize: '240px 240px, 300px 300px, 280px 280px, 340px 340px, 420px 420px, 380px 380px, 500px 500px',
          maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 78%)',
          animation: 'sparkleDrift 35s linear infinite',
        }} />
      </div>

      {/* Floating diamond sparkles - pure CSS, capped on phones by .vb-sparkle rules */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        {sparkles.map((s) => (
          <span
            key={s.id}
            className="vb-sparkle"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              background: s.glow,
              boxShadow: `0 0 8px ${s.glow}`,
              '--drift-x': `${s.driftX}px`,
              '--dur': `${s.duration}s`,
              '--delay': `${s.delay}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Concentric jewel rings */}
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center" aria-hidden="true">
        <div
          className="animate-spin-slow absolute w-155 h-155 rounded-full"
          style={{ border: '1px solid rgba(212,175,55,0.06)', animationDuration: '65s', animationDirection: 'reverse' }}
        />
        <div
          className="animate-spin-slow absolute w-115 h-115 rounded-full"
          style={{ border: '1px solid rgba(255,255,255,0.04)', animationDuration: '50s' }}
        />
        <div
          className="animate-spin-slow absolute w-80 h-80 rounded-full"
          style={{ border: '1px solid rgba(212,175,55,0.04)', animationDuration: '40s', animationDirection: 'reverse' }}
        />
      </div>

      {/* Login Card */}
      <div className="vb-enter relative z-10 w-full max-w-105">
        {/* Brand */}
        <div className="vb-enter text-center mb-12" style={{ '--vb-delay': '150ms' } as React.CSSProperties}>
          <div className="relative inline-flex">
            <div className="relative w-28 h-28 rounded-4xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(145deg, #d4af37 0%, #f4d03f 45%, #c5a26f 100%)',
                boxShadow: '0 20px 60px rgba(212,175,55,0.3), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              <div className="absolute inset-0 rounded-4xl" style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 50%)',
              }} />
              <div className="absolute inset-0 rounded-4xl bg-linear-to-r from-transparent via-white/20 to-transparent animate-scan" />
              <Diamond className="w-14 h-14 text-[#0a0a10] relative z-10" />
            </div>
            <div
              className="absolute inset-0 rounded-4xl blur-2xl -z-10 animate-pulse"
              style={{ background: 'rgba(212,175,55,0.3)' }}
            />
          </div>

          <h1
            className="font-display text-6xl font-bold tracking-tight mt-6"
            style={{
              background: 'linear-gradient(135deg, #f4d03f 0%, #d4af37 45%, #e8d5a3 65%, #b8860b 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            VAULT
          </h1>

          <div className="flex items-center justify-center gap-4 mt-3">
            <span className="h-px w-20" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.5))' }} />
            <span className="text-[9px] tracking-[0.45em] text-white/55 font-bold uppercase">Private Banking</span>
            <span className="h-px w-20" style={{ background: 'linear-gradient(90deg, rgba(212,175,55,0.5), transparent)' }} />
          </div>
        </div>

        {/* Glass Card */}
        <div className="vb-enter login-card relative rounded-[28px] p-8 lg:p-10" style={{ '--vb-delay': '300ms' } as React.CSSProperties}>
          {/* Card reflection overlay */}
          <div className="absolute inset-0 rounded-[28px] pointer-events-none" style={{
            background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.02) 50%, transparent 55%)',
          }} />

          <form className="relative z-10 space-y-5" onSubmit={handleLogin}>
            <div className="text-center mb-6">
              <h2 className="font-display text-3xl font-bold text-white">Welcome Back</h2>
              <p className="text-sm text-white/60 mt-1.5">Access your private vault securely</p>
            </div>

            {/* Account Input */}
            <div className="space-y-1.5">
              <label htmlFor="login-account" className="text-[9px] text-white/60 tracking-[0.3em] font-semibold ml-1 block">ACCOUNT NUMBER</label>
              <div className="relative">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${focused === 'account' ? 'text-amber-400' : 'text-white/30'}`}>
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="login-account"
                  name="account"
                  autoComplete="username"
                  type="text"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  onFocus={() => setFocused('account')}
                  onBlur={() => setFocused(null)}
                  placeholder="CH-8847-2193-042"
                  className="w-full rounded-xl pl-11 pr-4 py-4 text-sm text-white placeholder-white/40 outline-none transition-all duration-300"
                  style={{
                    background: focused === 'account' ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.035)',
                    border: `1px solid ${focused === 'account' ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    boxShadow: focused === 'account' ? '0 0 20px rgba(212,175,55,0.05)' : 'none',
                  }}
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-[9px] text-white/60 tracking-[0.3em] font-semibold ml-1 block">SECURITY CODE</label>
              <div className="relative">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${focused === 'password' ? 'text-amber-400' : 'text-white/30'}`}>
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••••"
                  className="w-full rounded-xl pl-11 pr-12 py-4 text-sm text-white placeholder-white/40 outline-none transition-all duration-300"
                  style={{
                    background: focused === 'password' ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.035)',
                    border: `1px solid ${focused === 'password' ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    boxShadow: focused === 'password' ? '0 0 20px rgba(212,175,55,0.05)' : 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  aria-label={showPass ? 'Hide security code' : 'Show security code'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 text-white/40 hover:text-amber-400/70 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="vb-enter p-3.5 rounded-xl text-xs text-center font-medium"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}
              >
                {error}
              </div>
            )}

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 py-1 text-white/60 cursor-pointer hover:text-white/80 transition-colors">
                <input id="login-remember" name="remember" type="checkbox" className="w-4 h-4 rounded accent-amber-500" defaultChecked />
                Remember this device
              </label>
              <button type="button" className="py-2 px-1 text-amber-400/60 hover:text-amber-300 transition-colors">
                Reset code?
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 relative overflow-hidden transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:hover:scale-100 disabled:active:scale-100"
              style={{
                background: loading
                  ? 'rgba(212,175,55,0.12)'
                  : 'linear-gradient(135deg, #d4af37 0%, #f4d03f 35%, #e8d5a3 65%, #c5a26f 100%)',
                color: loading ? '#d4af37' : '#0a0a10',
                boxShadow: loading ? 'none' : '0 8px 32px rgba(212,175,55,0.35)',
              }}
            >
              {loading ? (
                <><Zap className="w-4 h-4 animate-spin" /> Authenticating...</>
              ) : (
                <><ArrowRight className="w-4 h-4" /> Access Private Account</>
              )}
            </button>

            {/* Switch to Signup */}
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={onSwitchToSignup}
                className="text-xs text-white/60 hover:text-amber-400/70 transition-colors"
              >
                Don't have an account? <span className="text-amber-400/60 font-semibold">Create Account</span>
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="vb-fade text-center mt-10 space-y-5" style={{ '--vb-delay': '700ms' } as React.CSSProperties}>
          <div className="flex items-center justify-center gap-5">
            {[
              { icon: ShieldCheck, text: '256-BIT SSL' },
              { icon: ShieldCheck, text: 'SWISS ACT 1934' },
              { icon: ShieldCheck, text: 'FDIC INSURED' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <item.icon className="w-2.5 h-2.5 text-amber-500/40" />
                <span className="text-[8px] text-white/60 tracking-[0.3em] font-semibold">{item.text}</span>
              </div>
            ))}
          </div>

          <p className="text-[9px] text-white/60 tracking-[0.35em] font-medium">
            VAULT PRIVATE BANKING AG · ZÜRICH · GENEVA
          </p>
        </div>
      </div>
    </main>
  );
}
