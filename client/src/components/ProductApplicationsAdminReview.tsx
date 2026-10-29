import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type Currency = 'INR' | 'USD';

interface Customer {
  userId: string;
  fullName?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  kycStatus?: string;
}

interface CardRequest {
  id: string;
  cardType: 'debit' | 'credit';
  currency: Currency;
  status: string;
  reviewNote?: string | null;
  createdAt?: string;
  customer?: Customer;
}

interface LoanApplication {
  id: string;
  amount: number;
  currency: Currency;
  termMonths: number;
  purpose: string;
  status: string;
  reviewNote?: string | null;
  createdAt?: string;
  customer?: Customer;
}

const cardStatuses = [
  { value: 'needs_verification', label: 'Needs verification' },
  { value: 'under_review', label: 'Under review' },
  { value: 'waiting_for_issuer', label: 'Waiting for issuer' },
  { value: 'closed', label: 'Close request' },
];

const loanStatuses = [
  { value: 'needs_verification', label: 'Needs verification' },
  { value: 'under_review', label: 'Under review' },
  { value: 'funding_required', label: 'Awaiting funded lender' },
  { value: 'declined', label: 'Decline application' },
  { value: 'closed', label: 'Close application' },
];

function money(amount: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function verificationLabel(customer?: Customer): string {
  if (!customer) return 'Customer verification unavailable';
  const email = customer.emailVerified ? 'email verified' : 'email not verified';
  const kyc = customer.kycStatus === 'verified' ? 'identity verified' : 'identity not verified';
  return `${email} · ${kyc}`;
}

export default function ProductApplicationsAdminReview() {
  const user = api.getUser() as { role?: string } | null;
  const isAdmin = ['admin', 'super_admin'].includes(String(user?.role || '').toLowerCase());

  const [cards, setCards] = useState<CardRequest[]>([]);
  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [cardResult, loanResult] = await Promise.all([
        api.getAdminCardProgramRequests(),
        api.getAdminLoanApplications(),
      ]);
      if (!cardResult.success || !Array.isArray(cardResult.requests)) {
        throw new Error(cardResult.message || 'Could not load card requests.');
      }
      if (!loanResult.success || !Array.isArray(loanResult.applications)) {
        throw new Error(loanResult.message || 'Could not load loan applications.');
      }
      setCards(cardResult.requests as CardRequest[]);
      setLoans(loanResult.applications as LoanApplication[]);
    } catch (e: any) {
      setError(e?.message || 'Could not load product application queues.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateCard = async (request: CardRequest) => {
    const status = selectedStatus[`card:${request.id}`] || '';
    const note = (notes[`card:${request.id}`] || '').trim();
    if (!status) {
      setError('Choose a new status before saving.');
      return;
    }
    if (note.length < 10 || note.length > 500) {
      setError('Review notes must be 10–500 characters.');
      return;
    }
    setBusyId(`card:${request.id}`);
    setError('');
    setMessage('');
    try {
      const result = await api.updateAdminCardProgramRequest(request.id, { status, note });
      if (!result.success) throw new Error(result.message || 'Could not update this card request.');
      setMessage(`Card request #${request.id} updated to ${status.replace(/_/g, ' ')}.`);
      setSelectedStatus((old) => ({ ...old, [`card:${request.id}`]: '' }));
      setNotes((old) => ({ ...old, [`card:${request.id}`]: '' }));
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Card request update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const updateLoan = async (application: LoanApplication) => {
    const status = selectedStatus[`loan:${application.id}`] || '';
    const note = (notes[`loan:${application.id}`] || '').trim();
    if (!status) {
      setError('Choose a new status before saving.');
      return;
    }
    if (note.length < 10 || note.length > 500) {
      setError('Review notes must be 10–500 characters.');
      return;
    }
    setBusyId(`loan:${application.id}`);
    setError('');
    setMessage('');
    try {
      const result = await api.updateAdminLoanApplication(application.id, { status, note });
      if (!result.success) throw new Error(result.message || 'Could not update this loan application.');
      setMessage(`Loan application #${application.id} updated to ${status.replace(/_/g, ' ')}.`);
      setSelectedStatus((old) => ({ ...old, [`loan:${application.id}`]: '' }));
      setNotes((old) => ({ ...old, [`loan:${application.id}`]: '' }));
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Loan application update failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <section className="mt-6 space-y-5 rounded-3xl border border-cyan-400/15 bg-black/10 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-cyan-200/70">ADMIN OPERATIONS</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Card &amp; loan application queues</h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/45">
            Review requests and record notes. Verification is checked by the server before review. This pilot cannot issue a network card, approve credit, or disburse a loan.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || !!busyId} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh queues
        </button>
      </header>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-xs text-rose-200"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</div>}
      {message && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><CheckCircle2 size={15} className="mt-0.5 shrink-0" />{message}</div>}

      {loading ? (
        <p className="flex items-center gap-2 py-3 text-sm text-white/45"><Loader2 size={16} className="animate-spin" />Loading application queues…</p>
      ) : (
        <>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><ClipboardList size={16} className="text-cyan-200" /> Card requests <span className="text-[10px] text-white/35">({cards.length})</span></h3>
            {cards.length === 0 ? (
              <p className="mt-3 rounded-xl border border-white/8 bg-white/[0.025] p-4 text-xs text-white/40">No open card requests.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {cards.map((request) => {
                  const key = `card:${request.id}`;
                  const verified = request.customer?.emailVerified === true && request.customer?.kycStatus === 'verified';
                  return (
                    <article key={key} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-semibold capitalize text-white">{request.cardType} card · {request.currency}</p>
                          <p className="mt-1 text-[11px] text-white/35">Request #{request.id}{request.createdAt ? ` · ${new Date(request.createdAt).toLocaleString()}` : ''}</p>
                          <p className="mt-2 text-xs text-white/55">{request.customer?.fullName || 'Unknown customer'} · {request.customer?.email || 'Email unavailable'}</p>
                          <p className={`mt-1 text-[10px] ${verified ? 'text-emerald-200' : 'text-amber-200'}`}><ShieldCheck size={12} className="mr-1 inline" />{verificationLabel(request.customer)}</p>
                          {request.reviewNote && <p className="mt-2 text-[11px] text-white/45">Last note: {request.reviewNote}</p>}
                        </div>
                        <span className="w-fit rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1.5 text-[10px] font-bold capitalize text-cyan-100">{request.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-[200px_1fr_auto] md:items-end">
                        <div>
                          <label htmlFor={`card-status-${request.id}`} className="mb-1.5 block text-[10px] font-semibold text-white/45">Next status</label>
                          <select id={`card-status-${request.id}`} value={selectedStatus[key] || ''} onChange={(event) => setSelectedStatus((old) => ({ ...old, [key]: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-2.5 text-xs text-white">
                            <option value="">Choose status…</option>
                            {cardStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`card-note-${request.id}`} className="mb-1.5 block text-[10px] font-semibold text-white/45">Required review note</label>
                          <input id={`card-note-${request.id}`} value={notes[key] || ''} maxLength={500} onChange={(event) => setNotes((old) => ({ ...old, [key]: event.target.value }))} placeholder="Reason for the status change (10–500 characters)" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white" />
                        </div>
                        <button type="button" disabled={busyId === key} onClick={() => void updateCard(request)} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-50">
                          {busyId === key ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><ClipboardList size={16} className="text-violet-200" /> Loan applications <span className="text-[10px] text-white/35">({loans.length})</span></h3>
            {loans.length === 0 ? (
              <p className="mt-3 rounded-xl border border-white/8 bg-white/[0.025] p-4 text-xs text-white/40">No open loan applications.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {loans.map((application) => {
                  const key = `loan:${application.id}`;
                  const verified = application.customer?.emailVerified === true && application.customer?.kycStatus === 'verified';
                  return (
                    <article key={key} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{money(application.amount, application.currency)} · {application.termMonths} months</p>
                          <p className="mt-1 text-[11px] text-white/35">Application #{application.id}{application.createdAt ? ` · ${new Date(application.createdAt).toLocaleString()}` : ''}</p>
                          <p className="mt-2 text-xs text-white/55">{application.customer?.fullName || 'Unknown customer'} · {application.customer?.email || 'Email unavailable'}</p>
                          <p className={`mt-1 text-[10px] ${verified ? 'text-emerald-200' : 'text-amber-200'}`}><ShieldCheck size={12} className="mr-1 inline" />{verificationLabel(application.customer)}</p>
                          <p className="mt-2 text-xs leading-relaxed text-white/50">Purpose: {application.purpose}</p>
                          {application.reviewNote && <p className="mt-2 text-[11px] text-white/45">Last note: {application.reviewNote}</p>}
                        </div>
                        <span className="w-fit rounded-full border border-violet-300/20 bg-violet-300/5 px-3 py-1.5 text-[10px] font-bold capitalize text-violet-100">{application.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-[200px_1fr_auto] md:items-end">
                        <div>
                          <label htmlFor={`loan-status-${application.id}`} className="mb-1.5 block text-[10px] font-semibold text-white/45">Next status</label>
                          <select id={`loan-status-${application.id}`} value={selectedStatus[key] || ''} onChange={(event) => setSelectedStatus((old) => ({ ...old, [key]: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-2.5 text-xs text-white">
                            <option value="">Choose status…</option>
                            {loanStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`loan-note-${application.id}`} className="mb-1.5 block text-[10px] font-semibold text-white/45">Required review note</label>
                          <input id={`loan-note-${application.id}`} value={notes[key] || ''} maxLength={500} onChange={(event) => setNotes((old) => ({ ...old, [key]: event.target.value }))} placeholder="Reason for the status change (10–500 characters)" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white" />
                        </div>
                        <button type="button" disabled={busyId === key} onClick={() => void updateLoan(application)} className="flex items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-50">
                          {busyId === key ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          <p className="flex items-start gap-2 border-t border-white/8 pt-4 text-[10px] leading-relaxed text-white/35">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Server-side checks prevent unverified customers from entering issuer/lender review. No status action here can mark a card issued, create a credit limit, approve a loan, or claim a disbursement.
          </p>
        </>
      )}
    </section>
  );
}
