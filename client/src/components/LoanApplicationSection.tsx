import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ClipboardList, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type Currency = 'INR' | 'USD';
interface LoanApplication {
  id: string;
  amount: number;
  currency: Currency;
  termMonths: number;
  purpose: string;
  status: string;
  reviewNote?: string | null;
  createdAt?: string;
}

function makeKey(): string {
  try { return crypto.randomUUID(); }
  catch { return `vb-loan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

const statusLabel: Record<string, string> = {
  needs_verification: 'Verification needed',
  received: 'Received',
  under_review: 'Under review',
  funding_required: 'Awaiting funded lender',
  declined: 'Closed without offer',
  closed: 'Closed',
};

function money(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export default function LoanApplicationSection() {
  const [currency, setCurrency] = useState<Currency>('INR');
  const [amount, setAmount] = useState('10000');
  const [termMonths, setTermMonths] = useState(12);
  const [purpose, setPurpose] = useState('');
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const result = await api.getLoanApplications();
      if (!result.success || !Array.isArray(result.applications)) {
        throw new Error(result.message || 'Could not load loan applications.');
      }
      setApplications(result.applications as LoanApplication[]);
    } catch (e: any) {
      setError(e?.message || 'Could not load loan applications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const changeCurrency = (value: Currency) => {
    setCurrency(value);
    setAmount(value === 'INR' ? '10000' : '1000');
    attempt.current = null;
    setMessage('');
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    const cleanPurpose = purpose.trim();
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || cleanPurpose.length < 8 || cleanPurpose.length > 300) {
      setError('Enter a valid amount and explain the purpose in at least 8 characters.');
      return;
    }

    const fingerprint = `${numericAmount.toFixed(2)}|${currency}|${termMonths}|${cleanPurpose}`;
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: makeKey() };
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const result = await api.submitLoanApplication({
        amount: numericAmount,
        currency,
        termMonths,
        purpose: cleanPurpose,
      }, attempt.current.key);
      if (!result.success || !result.application) {
        throw new Error(result.message || 'Loan application could not be submitted.');
      }
      attempt.current = null;
      setMessage(result.message || 'Application saved. This is not a loan approval.');
      setPurpose('');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Application could not be saved. Retry using the same details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <p className="text-[10px] font-bold tracking-[0.28em] text-violet-300/70">VAULTBANK · LOAN APPLICATIONS</p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-white">Loan requests</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
          Submit an application for review. VaultBank can store the request and track its status, but a funded lending facility is not connected yet.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <ClipboardList size={19} className="text-violet-200" />
          <h3 className="mt-3 text-sm font-semibold text-white">Application tracking</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">Your request is stored in PostgreSQL with a reference and auditable status.</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <ShieldCheck size={19} className="text-emerald-200" />
          <h3 className="mt-3 text-sm font-semibold text-white">Verification first</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">Email and identity verification are required before an application can move to review.</p>
        </div>
        <div className="glass-panel rounded-2xl border border-amber-400/15 p-4">
          <ClipboardList size={19} className="text-amber-200" />
          <h3 className="mt-3 text-sm font-semibold text-white">No fake approval</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">No credit limit, interest quote, repayment, or loan funds are created by applying.</p>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      <form onSubmit={(event) => void submit(event)} className="glass-panel rounded-3xl border border-white/10 p-5 md:p-7">
        <h3 className="font-display text-xl text-white">Start an application</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="loan-currency" className="mb-2 block text-xs font-semibold text-white/60">Requested currency</label>
            <select id="loan-currency" value={currency} onChange={(event) => changeCurrency(event.target.value as Currency)} className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-3 text-sm text-white">
              <option value="INR">INR · Indian rupee</option>
              <option value="USD">USD · US dollar</option>
            </select>
          </div>
          <div>
            <label htmlFor="loan-amount" className="mb-2 block text-xs font-semibold text-white/60">Requested amount</label>
            <input id="loan-amount" type="number" inputMode="decimal" min={currency === 'INR' ? 1000 : 100} max={currency === 'INR' ? 50000000 : 500000} step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); attempt.current = null; }} required className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-violet-300/40" />
            <p className="mt-1 text-[10px] text-white/30">{currency === 'INR' ? 'INR 1,000 to 50,000,000' : 'USD 100 to 500,000'}. Limits are intake validation only, not an offer.</p>
          </div>
          <div>
            <label htmlFor="loan-term" className="mb-2 block text-xs font-semibold text-white/60">Preferred term</label>
            <select id="loan-term" value={termMonths} onChange={(event) => { setTermMonths(Number(event.target.value)); attempt.current = null; }} className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-3 text-sm text-white">
              {[3, 6, 12, 24, 36, 60].map((months) => <option key={months} value={months}>{months} months</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="loan-purpose" className="mb-2 block text-xs font-semibold text-white/60">Purpose of request</label>
            <textarea id="loan-purpose" value={purpose} onChange={(event) => { setPurpose(event.target.value); attempt.current = null; }} required minLength={8} maxLength={300} rows={3} placeholder="Briefly explain what the funds would be used for" className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-violet-300/40" />
          </div>
        </div>
        <button type="submit" disabled={submitting} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50 md:w-auto md:px-6">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />}
          {submitting ? 'Saving application…' : 'Submit application'}
        </button>
        <p className="mt-4 text-[11px] leading-relaxed text-white/35">
          Submitting a request does not create a loan, establish an APR, authorize a credit check, or move money. VaultBank must connect a verified funding facility before any offer or disbursement can be made.
        </p>
      </form>

      <div className="glass-panel rounded-2xl border border-white/10 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl text-white">Application history</h3>
          <button type="button" onClick={() => void refresh()} disabled={loading || submitting} aria-label="Refresh loan applications" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-white/45"><Loader2 size={15} className="animate-spin" />Loading applications…</p>
        ) : applications.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">No applications yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {applications.map((application) => (
              <article key={application.id} className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{money(application.amount, application.currency)} · {application.termMonths} months</p>
                    <p className="mt-1 text-[11px] text-white/35">Application #{application.id}{application.createdAt ? ` · ${new Date(application.createdAt).toLocaleDateString()}` : ''}</p>
                    <p className="mt-2 text-xs leading-relaxed text-white/50">{application.purpose}</p>
                    {application.reviewNote && <p className="mt-2 text-xs text-white/50">{application.reviewNote}</p>}
                  </div>
                  <span className="w-fit rounded-full border border-violet-300/20 bg-violet-300/5 px-3 py-1.5 text-[10px] font-bold text-violet-100">{statusLabel[application.status] || application.status}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
