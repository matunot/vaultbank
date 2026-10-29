import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { api } from '../api';

interface Profile {
  id?: string;
  email?: string;
  role?: string;
  emailVerified?: boolean;
  kycStatus?: string;
}

export default function EmailVerificationNotice() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.getProfile()
      .then((response) => {
        if (active && response?.success && response.user) setProfile(response.user as Profile);
      })
      .catch(() => {
        // Do not infer verification from browser state. The API is authoritative.
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const requestVerification = async () => {
    setSending(true);
    setError('');
    setMessage('');
    try {
      const result = await api.requestEmailVerification();
      if (!result.success) throw new Error(result.message || 'Could not send a verification email.');
      setMessage(result.message || 'Check your inbox for a one-time verification link.');
    } catch (e: any) {
      setError(e?.message || 'Email verification could not be requested.');
    } finally {
      setSending(false);
    }
  };

  if (loading || !profile || profile.emailVerified === true ||
      ['admin', 'super_admin'].includes(String(profile.role || '').toLowerCase())) {
    return null;
  }

  return (
    <div className="px-5 lg:px-8 pt-4">
      <section className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4 md:flex md:items-center md:justify-between md:gap-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-amber-400/10 p-2 text-amber-200">
            {error ? <AlertTriangle size={18} /> : message ? <CheckCircle2 size={18} /> : <MailCheck size={18} />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Verify your email to unlock customer fiat rails</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              {profile.email ? `Verification link for ${profile.email}.` : 'Confirm that you control the email on your account.'}
              {' '}This does not approve identity verification or guarantee bank access.
            </p>
            {message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}
            {error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void requestVerification()}
          disabled={sending}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-50 md:mt-0 md:w-auto md:shrink-0"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <MailCheck size={15} />}
          {sending ? 'Sending…' : 'Send verification link'}
        </button>
      </section>
    </div>
  );
}
