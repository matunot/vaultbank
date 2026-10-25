import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Undo2 } from 'lucide-react';
import { api } from '../api';

interface RequestRow {
  id: string;
  requestReference: string;
  amount: number;
  currency: string;
  beneficiaryName: string;
  destinationAccountMasked: string;
  destinationAccountNumber: string;
  destinationIfsc: string;
  status: string;
  createdAt: string;
  customerName?: string;
  customerEmail?: string;
}
interface ReviewForm {
  settlementAmount: string;
  bankUtr: string;
  evidenceNote: string;
  refundEvidenceNote: string;
}
const makeForm = (amount: number): ReviewForm => ({
  settlementAmount: Number(amount).toFixed(2),
  bankUtr: '',
  evidenceNote: '',
  refundEvidenceNote: '',
});

export function DirectBankPayoutAdminReview() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [forms, setForms] = useState<Record<string, ReviewForm>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.directBankPayoutAdminRequests('reserved');
      const next = Array.isArray(result.requests) ? result.requests as RequestRow[] : [];
      setRequests(next);
      setForms((existing) => {
        const updated = { ...existing };
        for (const request of next) if (!updated[request.id]) updated[request.id] = makeForm(request.amount);
        return updated;
      });
    } catch (err: any) {
      setError(err?.message || 'Could not load bank payout queue. Admin permissions and encryption key are required.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (api.getUser()?.role !== 'admin' && api.getUser()?.role !== 'super_admin') return null;

  const change = (id: string, patch: Partial<ReviewForm>) => {
    setForms((current) => ({ ...current, [id]: { ...(current[id] || makeForm(0)), ...patch } }));
  };

  const confirmPayout = async (request: RequestRow) => {
    const form = forms[request.id] || makeForm(request.amount);
    if (busyId) return;
    if (form.bankUtr.trim().length < 6 || form.evidenceNote.trim().length < 10) {
      setError('Enter the real bank UTR and a statement evidence note before confirming.');
      return;
    }
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const result = await api.confirmDirectBankPayoutRequest(request.id, {
        settlementAmount: form.settlementAmount,
        bankUtr: form.bankUtr.trim(),
        evidenceNote: form.evidenceNote.trim(),
      });
      if (!result.success) throw new Error(result.message || 'Could not confirm payout.');
      setNotice('Payout marked completed after bank-statement verification: ' + request.requestReference);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Confirmation failed. Verify the bank record before retrying.');
    } finally {
      setBusyId(null);
    }
  };

  const refundPayout = async (request: RequestRow) => {
    const form = forms[request.id] || makeForm(request.amount);
    if (busyId) return;
    if (form.refundEvidenceNote.trim().length < 10) {
      setError('Refund requires evidence from the bank statement proving no transfer was sent.');
      return;
    }
    if (!window.confirm('Return the reserved balance only after confirming from the official bank statement that no transfer was sent?')) return;
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const result = await api.refundDirectBankPayoutRequest(request.id, form.refundEvidenceNote.trim());
      if (!result.success) throw new Error(result.message || 'Could not refund payout.');
      setNotice('Reserved funds were returned after a no-transfer bank-statement review: ' + request.requestReference);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Refund failed. Review the ledger before retrying.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-amber-300"><ShieldCheck className="h-5 w-5" /><span className="text-[10px] font-bold tracking-[0.2em]">ADMIN ONLY</span></div>
          <h3 className="font-display text-xl text-white">Manual Bank Payout Queue</h3>
          <p className="mt-1 text-xs text-white/45">This screen never sends a bank transfer. Use the bank's own interface, then reconcile the official statement here.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || !!busyId} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh queue
        </button>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
        <AlertTriangle className="mr-1 inline h-4 w-4" /> Confirm only after the bank shows the outgoing transfer succeeded and the UTR matches. Refund only after the bank statement proves the transfer was not sent. If the result is ambiguous, do neither—leave funds reserved and investigate.
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading payout queue…</div>
      ) : requests.length === 0 ? (
        <p className="py-6 text-sm text-white/45">No reserved manual payouts.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {requests.map((request) => {
            const form = forms[request.id] || makeForm(request.amount);
            return (
              <div key={request.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-cyan-200">{request.requestReference}</p>
                    <p className="mt-1 text-xl font-bold text-white">₹{Number(request.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-white/45">{request.customerName || request.beneficiaryName}{request.customerEmail ? ' · ' + request.customerEmail : ''}</p>
                    <p className="mt-1 text-[10px] text-white/35">Created {new Date(request.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-200">reserved</span>
                </div>

                <div className="mt-4 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
                  <p className="text-[10px] font-bold tracking-wider text-white/40">SEND TO — COPY INTO YOUR BANK'S OWN TRANSFER SCREEN</p>
                  <p className="mt-2 text-sm font-semibold text-white">{request.beneficiaryName}</p>
                  <p className="mt-1 break-all font-mono text-sm text-cyan-200">{request.destinationAccountNumber}</p>
                  <p className="mt-1 font-mono text-xs text-white/70">IFSC {request.destinationIfsc}</p>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-[10px] font-bold tracking-wider text-white/45">
                    ACTUAL BANK DEBIT AMOUNT (INR)
                    <input value={form.settlementAmount} onChange={(e) => change(request.id, { settlementAmount: e.target.value })} inputMode="decimal" className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                  </label>
                  <label className="text-[10px] font-bold tracking-wider text-white/45">
                    OUTGOING UTR FROM BANK
                    <input value={form.bankUtr} onChange={(e) => change(request.id, { bankUtr: e.target.value })} placeholder="Official bank statement UTR" className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                  </label>
                  <label className="text-[10px] font-bold tracking-wider text-white/45 sm:col-span-2">
                    SUCCESS EVIDENCE NOTE
                    <textarea value={form.evidenceNote} onChange={(e) => change(request.id, { evidenceNote: e.target.value })} rows={2} placeholder="Statement date, debit row, UTR and matching amount…" className="mt-1 block w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                  </label>
                </div>
                <button type="button" onClick={() => void confirmPayout(request)} disabled={!!busyId} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                  {busyId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Confirm bank transfer succeeded
                </button>

                <div className="mt-4 border-t border-white/5 pt-3">
                  <label className="text-[10px] font-bold tracking-wider text-white/45">
                    NO-TRANSFER EVIDENCE — REQUIRED BEFORE REFUND
                    <textarea value={form.refundEvidenceNote} onChange={(e) => change(request.id, { refundEvidenceNote: e.target.value })} rows={2} placeholder="Explain which statement/account check proves no transfer was sent…" className="mt-1 block w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-rose-400" />
                  </label>
                  <button type="button" onClick={() => void refundPayout(request)} disabled={!!busyId} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-2.5 text-xs font-bold text-rose-200 disabled:opacity-50">
                    {busyId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Confirm no transfer was sent & return reserved funds
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
