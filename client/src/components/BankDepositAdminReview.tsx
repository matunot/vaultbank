import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle, RotateCcw } from 'lucide-react';
import { api } from '../api';

interface InstructionRow {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  settledAt?: string | null;
  settlementAmount?: number | null;
  customerName?: string;
  customerEmail?: string;
}
interface ReviewForm {
  settlementAmount: string;
  externalTxnRef: string;
  note: string;
}
const makeForm = (amount: number): ReviewForm => ({
  settlementAmount: Number(amount).toFixed(2),
  externalTxnRef: '',
  note: '',
});

export function BankDepositAdminReview() {
  const [status, setStatus] = useState('pending');
  const [instructions, setInstructions] = useState<InstructionRow[]>([]);
  const [forms, setForms] = useState<Record<string, ReviewForm>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.bankDepositAdminInstructions(status);
      const next = Array.isArray(result.instructions) ? result.instructions as InstructionRow[] : [];
      setInstructions(next);
      setForms((existing) => {
        const updated = { ...existing };
        for (const item of next) if (!updated[item.id]) updated[item.id] = makeForm(item.amount);
        return updated;
      });
    } catch (err: any) {
      setError(err?.message || 'Could not load native bank-deposit review queue. Admin access is required.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (api.getUser()?.role !== 'admin' && api.getUser()?.role !== 'super_admin') return null;

  const change = (id: string, patch: Partial<ReviewForm>) => {
    setForms((current) => ({ ...current, [id]: { ...(current[id] || makeForm(0)), ...patch } }));
  };

  const verify = async (item: InstructionRow) => {
    const form = forms[item.id] || makeForm(item.amount);
    if (busyId) return;
    if (form.externalTxnRef.trim().length < 8 || form.note.trim().length < 10) {
      setError('Enter the official bank UTR/reference (at least 8 characters) and a statement evidence note (at least 10 characters).');
      return;
    }
    if (!Number.isFinite(Number(form.settlementAmount)) || Number(form.settlementAmount) <= 0) {
      setError('Enter the actual positive settlement amount from the statement.');
      return;
    }
    if (!window.confirm('Confirm only after the actual incoming credit is visible in the receiving bank statement. This will credit the customer's VaultBank account. Continue?')) return;
    setBusyId(item.id);
    setError('');
    setNotice('');
    try {
      const result = await api.verifyBankDepositInstruction(item.id, {
        settlementAmount: form.settlementAmount,
        externalTxnRef: form.externalTxnRef.trim(),
        note: form.note.trim(),
      });
      if (!result.success || !result.credited) throw new Error(result.message || 'Deposit was not credited.');
      setNotice('Bank statement verified and deposit credited once: ' + item.reference);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Verification failed. Do not assume any credit occurred.');
    } finally {
      setBusyId(null);
    }
  };

  const fail = async (item: InstructionRow) => {
    const form = forms[item.id] || makeForm(item.amount);
    if (busyId) return;
    if (form.note.trim().length < 10) {
      setError('Add a note explaining the statement review and why the transfer was not received (at least 10 characters).');
      return;
    }
    if (!window.confirm('Mark this instruction as not received? This closes the instruction without crediting the customer's account.')) return;
    setBusyId(item.id);
    setError('');
    setNotice('');
    try {
      const result = await api.failBankDepositInstruction(item.id, form.note.trim());
      if (!result.success) throw new Error(result.message || 'Could not close the instruction.');
      setNotice('Instruction closed without credit: ' + item.reference);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not close the instruction.');
    } finally {
      setBusyId(null);
    }
  };

  const reverse = async (item: InstructionRow) => {
    const form = forms[item.id] || makeForm(item.amount);
    if (busyId) return;
    if (form.note.trim().length < 10) {
      setError('Add evidence for the bank reversal/recall (at least 10 characters).');
      return;
    }
    if (!window.confirm('Reverse a previously settled deposit only after verifying an official bank recall/reversal. If spendable verified funds are insufficient, the account will be flagged for review. Continue?')) return;
    setBusyId(item.id);
    setError('');
    setNotice('');
    try {
      const result = await api.reverseBankDepositInstruction(item.id, form.note.trim());
      if (!result.success && result.code !== 'BANK_DEPOSIT_REVERSAL_REQUIRED') throw new Error(result.message || 'Could not process the reversal.');
      setNotice(result.needsReview || result.status === 'reversal_required'
        ? 'Reversal needs review; no forced negative balance was created.'
        : 'Deposit reversal processed with a compensating ledger entry: ' + item.reference);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Reversal could not be completed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-amber-300"><ShieldCheck className="h-5 w-5" /><span className="text-[10px] font-bold tracking-[0.2em]">ADMIN ONLY</span></div>
          <h3 className="font-display text-xl text-white">Native Bank-Deposit Review</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">VaultBank does not receive an automatic bank callback here. Match the exact amount, unique UTR and reference against the real receiving-bank statement before crediting.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || !!busyId} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh queue
        </button>
      </div>

      {error && <div role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-[10px] font-bold tracking-wider text-white/45">
          QUEUE STATUS
          <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={loading || !!busyId} className="mt-1 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400">
            <option value="pending">Pending deposits</option>
            <option value="settling">Under verification</option>
            <option value="settled">Settled deposits</option>
            <option value="failed">Closed as not received</option>
            <option value="reversal_required">Reversal needs review</option>
            <option value="reversed">Reversed deposits</option>
          </select>
        </label>
        <span className="text-xs text-white/40">{instructions.length} record(s)</span>
      </div>

      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
        <AlertTriangle className="mr-1 inline h-4 w-4" /> A payment screenshot, customer message, browser redirect or SMS is not bank-settlement proof. If an entry is ambiguous or amounts/references differ, do not credit. Reversal must be supported by official bank recall evidence.
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading statement-review queue…</div>
      ) : instructions.length === 0 ? (
        <p className="py-6 text-sm text-white/45">No bank-deposit records in this status.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {instructions.map((item) => {
            const form = forms[item.id] || makeForm(item.amount);
            const isOpen = item.status === 'pending' || item.status === 'settling';
            const isReversible = item.status === 'settled' || item.status === 'reversal_required';
            return (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-cyan-200">{item.reference}</p>
                    <p className="mt-1 text-xl font-bold text-white">{item.currency} {Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-xs text-white/45">{item.customerName || 'VaultBank user'}{item.customerEmail ? ' · ' + item.customerEmail : ''}</p>
                    <p className="mt-1 text-[10px] text-white/35">Created {new Date(item.createdAt).toLocaleString()} · Expires {new Date(item.expiresAt).toLocaleString()}</p>
                  </div>
                  <span className={'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ' + (item.status === 'settled' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : item.status === 'pending' || item.status === 'settling' ? 'border-amber-500/25 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-white/50')}>{item.status.replace(/_/g, ' ')}</span>
                </div>

                {isOpen && (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="text-[10px] font-bold tracking-wider text-white/45">
                        EXACT BANK-STATEMENT AMOUNT ({item.currency})
                        <input value={form.settlementAmount} onChange={(event) => change(item.id, { settlementAmount: event.target.value })} inputMode="decimal" className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                      </label>
                      <label className="text-[10px] font-bold tracking-wider text-white/45">
                        UNIQUE BANK TRANSACTION REFERENCE / UTR
                        <input value={form.externalTxnRef} onChange={(event) => change(item.id, { externalTxnRef: event.target.value })} placeholder="From official bank statement" className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                      </label>
                      <label className="text-[10px] font-bold tracking-wider text-white/45 sm:col-span-2">
                        STATEMENT EVIDENCE NOTE
                        <textarea value={form.note} onChange={(event) => change(item.id, { note: event.target.value })} rows={2} placeholder="Statement date, incoming credit row, sender/reference and amount…" className="mt-1 block w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                      </label>
                    </div>
                    <button type="button" onClick={() => void verify(item)} disabled={!!busyId} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                      {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify bank statement and credit once
                    </button>
                    <button type="button" onClick={() => void fail(item)} disabled={!!busyId} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/60 disabled:opacity-50">
                      {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Close as not received (no credit)
                    </button>
                  </>
                )}

                {isReversible && (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <label className="text-[10px] font-bold tracking-wider text-white/45">
                      OFFICIAL BANK RECALL / REVERSAL EVIDENCE
                      <textarea value={form.note} onChange={(event) => change(item.id, { note: event.target.value })} rows={2} placeholder="Bank reversal date, recall reference and statement evidence…" className="mt-1 block w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-rose-400" />
                    </label>
                    <button type="button" onClick={() => void reverse(item)} disabled={!!busyId} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-2.5 text-xs font-bold text-rose-200 disabled:opacity-50">
                      {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Process verified bank reversal
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
