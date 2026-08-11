import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Eye, EyeOff, ArrowRight, Lock, User, Mail, Zap, Diamond } from 'lucide-react';
import { api } from '../api';

interface Props {
  onSignup: () => void;
  onSwitchToLogin: () => void;
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

export default function SignupPage({ onSignup, onSwitchToLogin }: Props) {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password || !fullName) {
      setError('Please fill in all fields');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    setLoading(true);
    try {
      const result = await api.signup(email, password, fullName);
      if (result.success) {
        onSignup();
      } else {
        setError(result.message || 'Signup failed');
      }
    } catch (err: any) {
      setError(err.message || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4" style={{ background: '#050508' }}>
      {/* Ultra-luxury layered background */}
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

      {/* Floating diamond sparkles */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {sparkles.map((s) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{
              opacity: [0, 0.6, 0],
              y: [0, -50],
              x: [0, s.driftX],
            }}
            transition={{
              duration: s.duration,
              delay: s.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute rounded-full"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              background: s.glow,
              boxShadow: `0 0 8px ${s.glow}`,
            }}
          />
        ))}
      </div>

      {/* Concentric jewel rings */}
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center">
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 65, repeat: Infinity, ease: 'linear' }}
          className="absolute w-[620px] h-[620px] rounded-full"
          style={{ border: '1px solid rgba(212,175,55,0.06)' }}
        />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 50, repeat: Infinity, ease: 'linear' }}
          className="absolute w-[460px] h-[460px] rounded-full"
          style={{ border: '1px solid rgba(255,255,255,0.04)' }}
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
          className="absolute w-80 h-80 rounded-full"
          style={{ border: '1px solid rgba(212,175,55,0.04)' }}
        />
      </div>

      {/* Signup Card */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* Brand */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-center mb-12"
        >
          <motion.div
            animate={{ scale: [1, 1.03, 1], rotate: [0, 0.5, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="relative inline-flex"
          >
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
            <motion.div
              animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="absolute inset-0 rounded-4xl blur-2xl -z-10"
              style={{ background: 'rgba(212,175,55,0.3)' }}
            />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="font-display text-6xl font-bold tracking-tight mt-6"
            style={{
              background: 'linear-gradient(135deg, #f4d03f 0%, #d4af37 45%, #e8d5a3 65%, #b8860b 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            VAULT
          </motion.h1>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="flex items-center justify-center gap-4 mt-3"
          >
            <span className="h-px w-20" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.5))' }} />
            <span className="text-[9px] tracking-[0.45em] text-white/35 font-bold uppercase">Private Banking</span>
            <span className="h-px w-20" style={{ background: 'linear-gradient(90deg, rgba(212,175,55,0.5), transparent)' }} />
          </motion.div>
        </motion.div>

        {/* Glass Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative rounded-[28px] p-8 lg:p-10"
          style={{
            background: 'linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          {/* Card reflection overlay */}
          <div className="absolute inset-0 rounded-[28px] pointer-events-none" style={{
            background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.02) 50%, transparent 55%)',
          }} />

          <div className="relative z-10 space-y-5">
            <div className="text-center mb-6">
              <h2 className="font-display text-3xl font-bold text-white">Create Account</h2>
              <p className="text-sm text-white/35 mt-1.5">Join VaultBank private banking</p>
            </div>

            {/* Full Name Input */}
            <div className="space-y-1.5">
              <label className="text-[9px] text-white/35 tracking-[0.3em] font-semibold ml-1 block">FULL NAME</label>
              <div className="relative">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${focused === 'name' ? 'text-amber-400' : 'text-white/30'}`}>
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setError(''); }}
                  onFocus={() => setFocused('name')}
                  onBlur={() => setFocused(null)}
                  placeholder="John Doe"
                  className="w-full rounded-xl pl-11 pr-4 py-4 text-sm text-white placeholder-white/15 outline-none transition-all duration-300"
                  style={{
                    background: focused === 'name' ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.035)',
                    border: `1px solid ${focused === 'name' ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    boxShadow: focused === 'name' ? '0 0 20px rgba(212,175,55,0.05)' : 'none',
                  }}
                />
              </div>
            </div>

            {/* Email Input */}
            <div className="space-y-1.5">
              <label className="text-[9px] text-white/35 tracking-[0.3em] font-semibold ml-1 block">EMAIL</label>
              <div className="relative">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${focused === 'email' ? 'text-amber-400' : 'text-white/30'}`}>
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl pl-11 pr-4 py-4 text-sm text-white placeholder-white/15 outline-none transition-all duration-300"
                  style={{
                    background: focused === 'email' ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.035)',
                    border: `1px solid ${focused === 'email' ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    boxShadow: focused === 'email' ? '0 0 20px rgba(212,175,55,0.05)' : 'none',
                  }}
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label className="text-[9px] text-white/35 tracking-[0.3em] font-semibold ml-1 block">PASSWORD</label>
              <div className="relative">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${focused === 'password' ? 'text-amber-400' : 'text-white/30'}`}>
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder="Min. 8 characters"
                  className="w-full rounded-xl pl-11 pr-12 py-4 text-sm text-white placeholder-white/15 outline-none transition-all duration-300"
                  style={{
                    background: focused === 'password' ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.035)',
                    border: `1px solid ${focused === 'password' ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    boxShadow: focused === 'password' ? '0 0 20px rgba(212,175,55,0.05)' : 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-amber-400/60 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-xl text-xs text-center font-medium"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}
              >
                {error}
              </motion.div>
            )}

            {/* Submit Button */}
            <motion.button
              onClick={handleSignup}
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
              className="w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 relative overflow-hidden transition-all duration-300"
              style={{
                background: loading
                  ? 'rgba(212,175,55,0.12)'
                  : 'linear-gradient(135deg, #d4af37 0%, #f4d03f 35%, #e8d5a3 65%, #c5a26f 100%)',
                color: loading ? '#d4af37' : '#0a0a10',
                boxShadow: loading ? 'none' : '0 8px 32px rgba(212,175,55,0.35)',
              }}
            >
              {loading ? (
                <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Zap className="w-4 h-4" /></motion.div> Creating Account...</>
              ) : (
                <><ArrowRight className="w-4 h-4" /> Create Private Account</>
              )}
            </motion.button>

            {/* Switch to Login */}
            <div className="text-center mt-4">
              <button
                onClick={onSwitchToLogin}
                className="text-xs text-white/40 hover:text-amber-400/60 transition-colors"
              >
                Already have an account? <span className="text-amber-400/60 font-semibold">Sign In</span>
              </button>
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-center mt-10 space-y-5"
        >
          <div className="flex items-center justify-center gap-5">
            {[
              { icon: ShieldCheck, text: '256-BIT SSL' },
              { icon: ShieldCheck, text: 'SWISS ACT 1934' },
              { icon: ShieldCheck, text: 'FDIC INSURED' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <item.icon className="w-2.5 h-2.5 text-amber-500/40" />
                <span className="text-[8px] text-white/15 tracking-[0.3em] font-semibold">{item.text}</span>
              </div>
            ))}
          </div>

          <p className="text-[9px] text-white/12 tracking-[0.35em] font-medium">
            VAULT PRIVATE BANKING AG · ZÜRICH · GENEVA
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}