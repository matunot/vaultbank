import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../api';

interface Props {
  token: string;
  onFinish: () => void;
}

export default function EmailVerificationPage({ token, onFinish }: Props) {
  const [status, setStatus] = useState<'verifying' | 'verified' | 'error'>('verifying');
  const [message, setMessage] = useState('Checking the one-time verification link…');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api.confirmEmailVerification(token)
      .then((result) => {
        if (!result.success) throw new Error(result.message || 'This link could not be verified.');
        setStatus('verified');
        setMessage(result.message || 'Your email address has been verified.');
      })
      .catch((error: any) => {
        setStatus('error');
        setMessage(error?.message || 'This link is invalid or expired. Sign in and request a fresh one.');
      });
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#050508] px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-7 text-center shadow-2xl md:p-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-300/10 text-amber-200">
          {status === 'verifying'
            ? <Loader2 size={25} className="animate-spin" />
            : status === 'verified'
              ? <CheckCircle2 size={25} className="text-emerald-200" />
              : <XCircle size={25} className="text-rose-200" />}
        </div>
        <div className="mt-5 flex items-center justify-center gap-2 text-[10px] font-bold tracking-[0.25em] text-amber-200/65">
          <ShieldCheck size={14} /> VAULTBANK ACCOUNT SECURITY
        </div>
        <h1 className="mt-3 font-display text-2xl font-semibold">
          {status === 'verified' ? 'Email verified' : status === 'error' ? 'Verification not completed' : 'Verifying your email'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/55">{message}</p>
        {status !== 'verifying' && (
          <button
            type="button"
            onClick={onFinish}
            className="mt-7 w-full rounded-xl bg-amber-300 px-5 py-3 text-sm font-bold text-slate-950"
          >
            Continue to VaultBank
          </button>
        )}
      </section>
    </main>
  );
}
