import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Eye, FileWarning, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../api';

interface KycQueueItem {
  id: string;
  documentType: string;
  documentName?: string | null;
  status: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  hasFile?: boolean;
  customer?: {
    id: string;
    email: string;
    fullName?: string | null;
    kycStatus?: string;
    emailVerified?: boolean;
  };
}

type QueueFilter = 'pending' | 'all' | 'approved' | 'rejected';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function documentLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function KycAdminReview() {
  const user = api.getUser() as { role?: string } | null;
  const isAdmin = ['admin', 'super_admin'].includes(String(user?.role || '').toLowerCase());

  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [items, setItems] = useState<KycQueueItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.getAdminKycQueue(filter);
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error(result.message || 'Could not load the KYC review queue.');
      }
      setItems(result.data as KycQueueItem[]);
    } catch (e: any) {
      setError(e?.message || 'Could not load the KYC review queue.');
    } finally {
      setLoading(false);
    }
  }, [filter, isAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const review = async (item: KycQueueItem, decision: 'approve' | 'reject') => {
    const note = (notes[item.id] || '').trim();
    if (decision === 'reject' && note.length < 5) {
      setError('A rejection needs a 5–500 character note explaining what the customer must correct.');
      return;
    }
    if (note.length > 500) {
      setError('Review notes must be 500 characters or fewer.');
      return;
    }
    setBusyId(item.id);
    setError('');
    setMessage('');
    try {
      const result = decision === 'approve'
        ? await api.approveKycDocument(item.id, note)
        : await api.rejectKycDocument(item.id, note);
      if (!result.success) throw new Error(result.message || `Could not ${decision} this document.`);
      setMessage(
        decision === 'approve'
          ? 'Identity approved and the customer is now KYC verified.'
          : 'Document rejected. The customer can read the reason and resubmit.',
      );
      setNotes((current) => ({ ...current, [item.id]: '' }));
      await refresh();
    } catch (e: any) {
      setError(e?.message || `Could not ${decision} this document.`);
    } finally {
      setBusyId(null);
    }
  };

  const viewDocument = async (item: KycQueueItem) => {
    setViewingId(item.id);
    setError('');
    // Open the tab synchronously so the browser does not treat the later blob
    // navigation as a popup.
    const viewer = window.open('', '_blank');
    if (viewer) viewer.opener = null;
    try {
      const blob = await api.downloadKycDocument(item.id);
      const url = URL.createObjectURL(blob);
      if (viewer) viewer.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      viewer?.close();
      setError(e?.message || 'Could not open the stored identity document.');
    } finally {
      setViewingId(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <section className="mt-6 space-y-5 rounded-3xl border border-emerald-400/15 bg-black/10 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-emerald-200/70">ADMIN OPERATIONS</p>
          <h2 className="mt-2 flex items-center gap-2 font-display text-2xl font-semibold text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-300" /> Identity verification queue
          </h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/45">
            Review the stored document, then approve or reject with a customer-visible note. Only approval sets
            the account to KYC verified. The queue never exposes document bytes before an admin opens the file.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as QueueFilter)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80"
            aria-label="KYC queue status filter"
          >
            <option value="pending" className="bg-[#0d0d14]">Pending</option>
            <option value="approved" className="bg-[#0d0d14]">Approved</option>
            <option value="rejected" className="bg-[#0d0d14]">Rejected</option>
            <option value="all" className="bg-[#0d0d14]">All</option>
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || !!busyId}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {message && <div role="status" className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      {loading ? (
        <p className="text-sm text-white/45"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading queue…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center">
          <FileWarning className="mx-auto h-6 w-6 text-white/30" />
          <p className="mt-2 text-sm text-white/50">No KYC documents in this queue.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const customerVerified = item.customer?.emailVerified === true;
            return (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{item.customer?.email || 'Customer email unavailable'}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                        customerVerified
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                          : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                      }`}>
                        {customerVerified ? 'Email verified' : 'Email unverified'}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase text-white/55">
                        KYC {item.customer?.kycStatus || 'pending'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/45">
                      {item.customer?.fullName || 'Name not provided'} · {documentLabel(item.documentType)}
                      {item.documentName ? ` · ${item.documentName}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] text-white/35">
                      Submitted {formatDate(item.submittedAt)} · Status {item.status}
                      {item.reviewedAt ? ` · Reviewed ${formatDate(item.reviewedAt)}` : ''}
                    </p>
                    {item.reviewNotes && (
                      <p className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/55">
                        Previous note: {item.reviewNotes}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void viewDocument(item)}
                      disabled={!item.hasFile || viewingId === item.id}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-40"
                    >
                      {viewingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                      {item.hasFile ? 'View document' : 'No stored file'}
                    </button>
                  </div>
                </div>

                {item.status === 'pending' && (
                  <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <input
                      value={notes[item.id] || ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                      maxLength={500}
                      placeholder="Reviewer note (required to reject, optional to approve)"
                      aria-label={`Reviewer note for ${item.customer?.email || item.id}`}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/25"
                    />
                    <button
                      type="button"
                      onClick={() => void review(item, 'approve')}
                      disabled={busyId === item.id}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-bold text-emerald-950 disabled:opacity-50"
                    >
                      {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                      Approve identity
                    </button>
                    <button
                      type="button"
                      onClick={() => void review(item, 'reject')}
                      disabled={busyId === item.id}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-bold text-rose-200 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Reject
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
