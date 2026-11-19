import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MailCheck,
  MailWarning,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';

interface EmailProfile {
  email?: string;
  emailVerified?: boolean;
  role?: string;
}

export default function VerificationSection() {
  const [profile, setProfile] = useState<EmailProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getProfile();
      if (!result.success || !result.user) {
        throw new Error(result.message || 'Could not load your account email status.');
      }
      setProfile(result.user as EmailProfile);
    } catch (e: any) {
      setError(e?.message || 'Could not load your account email status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const sendVerificationEmail = async () => {
    setSending(true);
    setError('');
    setMessage('');
    try {
      const result = await api.requestEmailVerification();
      if (!result.success) {
        throw new Error(result.message || 'VaultBank could not send the verification email.');
      }
      setMessage(result.message || 'A one-time verification link has been sent to your account email. Check your inbox and spam folder.');
    } catch (e: any) {
      setError(e?.message || 'VaultBank could not send the verification email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="rounded-3xl border border-amber-400/20 bg-linear-to-br from-amber-400/10 via-transparent to-yellow-500/5 p-6 lg:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-200">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-amber-200/65">ACCOUNT SECURITY</p>
            <h2 className="mt-1 font-display text-2xl text-white lg:text-3xl">Email verification</h2>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/55">
          Confirm that you own the email address on your VaultBank account. We will send a one-time link to your inbox.
        </p>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <section className="glass-panel rounded-3xl p-6 lg:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${profile?.emailVerified ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
              {profile?.emailVerified ? <MailCheck className="h-5 w-5" /> : <MailWarning className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">Your account email</h3>
              {loading ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-white/45">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking verification status…
                </p>
              ) : (
                <>
                  <p className="mt-1 break-all text-sm text-white/60">{profile?.email || 'Email address unavailable'}</p>
                  <span className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${profile?.emailVerified ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
                    {profile?.emailVerified ? 'Email verified' : 'Not verified'}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || sending}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh status
          </button>
        </div>

        {!loading && profile?.emailVerified !== true && (
          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="text-sm leading-relaxed text-white/55">
              Select the button below and VaultBank will email you a secure verification link. Open the message and follow the link to finish.
            </p>
            <button
              type="button"
              onClick={() => void sendVerificationEmail()}
              disabled={sending || !profile?.email}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-amber-300 to-yellow-500 px-5 py-3 text-sm font-bold text-amber-950 shadow-lg shadow-amber-500/10 transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
              {sending ? 'Sending verification email…' : 'Send verification email'}
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              The one-time link expires after 30 minutes. Check your spam or junk folder if it does not arrive.
            </p>
          </div>
        )}

        {!loading && profile?.emailVerified === true && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
            <div>
              <p className="text-sm font-semibold text-emerald-100">Your email is verified</p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-100/60">
                VaultBank has confirmed this email address. No further email verification is needed.
              </p>
            </div>
          </div>
        )}
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-white/35">
        This page currently handles email verification only. Identity checks and other account reviews are separate steps.
      </p>
    </div>
  );
}
