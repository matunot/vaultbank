import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

interface Intent {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  customerName?: string;
  customerEmail?: string;
  bankUtr?: string | null;
}
interface FormState {
  amount: string;
  bankUtr: string;
  evidenceNote: string;
}
const freshForm = (amount: number): FormState => ({
  amount: Number(amount).toFixed(2),
  bankUtr: '',
  evidenceNote: '',
});

export function DirectUpiAdminReview() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.directUpiAdminIntents('pending');
      const next = Array.isArray(result.intents) ? result.intents as Intent[] : [];
      setIntents(next);
      setForms((current) => {
        const updated = { ...current };
        for (const intent of next) {
          if (!updated[intent.id]) updated[intent.id] = freshForm(intent.amount);
        }
        return updated;
      });
    } catch (err: any) {
      setError(err?.message || 'Could not load direct UPI review queue. Admin access is required.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateForm = (id: string, patch: Partial<FormState>) => {
    setForms((current) => ({ ...current, [id]: { ...(current[id] || freshForm(0)), ...patch } }));
  };

  const verify = async (intent: Intent) => {
    if (busyId) return;
    const form = forms[intent.id] || freshForm(intent.amount);
    if (form.bankUtr.trim().length < 6 || form.evidenceNote.trim().length < 10) {
      setError('Enter the official bank UTR and a statement-evidence note (at least 10 characters).');
      return;
    }
    setBusyId(intent.id);
    setError('');
    setNotice('');
    try {
      const result = await api.verifyDirectUpiIntent(intent.id, {
        settlementAmount: form.amount,
        bankUtr: form.bankUtr.trim(),
        evidenceNote: form.evidenceNote.trim(),
      });
      if (!result.success) throw new Error(result.message || 'Verification failed.');
      setNotice('Deposit verified and credited once. Reference: ' + intent.reference);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Verification failed. No credit should be assumed.');
    } finally {
      setBusyId(null);
    }
  };

  if (api.getUser()?.role !== 'admin' && api.getUser()?.role !== 'super_admin') return null;

  return (
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-amber-300">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-[10px] font-bold tracking-[0.2em]">ADMIN ONLY</span>
          </div>
          <h3 className="font-display text-xl text-white">Direct UPI Statement Review</h3>
          <p className="mt-1 text-xs text-white/45">Credit only after verifying the real credit in the receiving bank's official statement.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || !!busyId} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh queue
        </button>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}

      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
        <AlertTriangle className="mr-1 inline h-4 w-4" /> Do not use payment screenshots, browser redirects, or SMS/email alerts alone. Match the incoming amount, unique UTR and intended payment reference in the bank statement. If any detail is unclear, do not credit it here.
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading pending intents…</div>
      ) : intents.length === 0 ? (
        <p className="py-6 text-sm text-white/45">No pending Direct UPI intents.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {intents.map((intent) => {
            const form = forms[intent.id] || freshForm(intent.amount);
            return (
              <div key={intent.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-cyan-200">{intent.reference}</p>
                    <p className="mt-1 text-xl font-bold text-white">₹{Number(intent.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-white/45">{intent.customerName || 'VaultBank user'}{intent.customerEmail ? ' · ' + intent.customerEmail : ''}</p>
                    <p className="mt-1 text-[10px] text-white/30">Created {new Date(intent.createdAt).toLocaleString()} · Expires {new Date(intent.expiresAt).toLocaleString()}</p>
                  </div>
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-200">{intent.status}</span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-[10px] font-bold tracking-wider text-white/45">
                    STATEMENT AMOUNT (INR)
                    <input value={form.amount} onChange={(e) => updateForm(intent.id, { amount: e.target.value })} inputMode="decimal" className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                  </label>
                  <label className="text-[10px] font-bold tracking-wider text-white/45">
                    BANK UTR / TRANSACTION REFERENCE
                    <input value={form.bankUtr} onChange={(e) => updateForm(intent.id, { bankUtr: e.target.value })} placeholder="From official bank statement" className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                  </label>
                  <label className="text-[10px] font-bold tracking-wider text-white/45 sm:col-span-2">
                    STATEMENT EVIDENCE NOTE
                    <textarea value={form.evidenceNote} onChange={(e) => updateForm(intent.id, { evidenceNote: e.target.value })} placeholder="Statement date, incoming credit row, amount and matching reference…" rows={2} className="mt-1 block w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                  </label>
                </div>
                <button type="button" onClick={() => void verify(intent)} disabled={!!busyId} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                  {busyId === intent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {busyId === intent.id ? 'Verifying…' : 'Verify statement and credit once'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
