import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Landmark, ShieldCheck } from 'lucide-react';
import { api } from '../api';

interface Props {
  onLogin: () => void;
  onSwitchToSignup: () => void;
}

export default function LoginPage({ onLogin, onSwitchToSignup }: Props) {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.login(email.trim(), password);
      if (result.success) {
        onLogin();
      } else {
        setError(result.message || 'We could not sign you in. Check your details and try again.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'We could not sign you in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bank-auth">
      <div className="bank-auth__shell">
        <section className="bank-auth__brand" aria-label="VaultBank">
          <div>
            <div className="bank-auth__logo">
              <span className="bank-auth__mark"><Landmark size={22} strokeWidth={1.8} /></span>
              <span>VaultBank</span>
            </div>
            <h1 className="bank-auth__headline">Your money.<br />A clearer view.</h1>
            <p className="bank-auth__body">
              A considered place to manage your accounts, review activity and access your banking services.
            </p>
          </div>
          <div className="bank-auth__footnote flex items-center gap-2">
            <ShieldCheck size={15} className="shrink-0 text-teal-200" />
            <span>Sign in to access your personal account securely.</span>
          </div>
        </section>

        <section className="bank-auth__form-wrap">
          <form onSubmit={(event) => void handleLogin(event)} className="bank-auth__form" aria-labelledby="signin-title">
            <p className="!font-bold !tracking-[0.16em] !text-[10px] !text-emerald-700">WELCOME BACK</p>
            <h2 id="signin-title" className="mt-2">Sign in</h2>
            <p className="mt-2">Use your VaultBank account details to continue.</p>

            <label className="bank-auth__label" htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              className="bank-auth__input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              inputMode="email"
              required
              disabled={loading}
            />

            <label className="bank-auth__label" htmlFor="login-password">Password</label>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                className="bank-auth__input pr-12"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPass((value) => !value)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                aria-pressed={showPass}
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              >
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error && <div role="alert" className="bank-auth__error">{error}</div>}

            <button type="submit" disabled={loading} className="bank-auth__submit">
              <span>{loading ? 'Signing in…' : 'Continue to account'}</span>
              {!loading && <ArrowRight size={17} />}
            </button>

            <div className="bank-auth__switch">
              New to VaultBank?{' '}
              <button type="button" onClick={onSwitchToSignup}>Create an account</button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
