import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  BadgeCheck,
  Clock3,
  FileText,
  Loader2,
  MailCheck,
  MailWarning,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { api } from '../api';

type KycStatus = 'pending' | 'submitted' | 'verified' | 'rejected' | string;

interface KycDocument {
  id: string;
  documentType: string;
  documentName?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
}

interface KycState {
  emailVerified: boolean;
  kycStatus: KycStatus;
  documents: KycDocument[];
  pendingDocument: KycDocument | null;
  canSubmit: boolean;
  nextStep: string;
}

const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'national_id', label: 'National identity card' },
  { value: 'proof_of_address', label: 'Proof of address' },
  { value: 'selfie', label: 'Photo of yourself' },
  { value: 'other', label: 'Other identity document' },
];

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: 'Not started', className: 'border-white/15 bg-white/5 text-white/60' },
  submitted: { label: 'Under review', className: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  verified: { label: 'Verified', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  rejected: { label: 'Rejected', className: 'border-rose-400/30 bg-rose-400/10 text-rose-200' },
};

function statusMeta(status: string) {
  return STATUS_META[status] || { label: status.replace(/_/g, ' '), className: 'border-white/15 bg-white/5 text-white/60' };
}

function documentLabel(type: string): string {
  return DOCUMENT_TYPES.find((item) => item.value === type)?.label || type.replace(/_/g, ' ');
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function VerificationSection() {
  const [state, setState] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [documentType, setDocumentType] = useState('passport');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const result = await api.getKycStatus();
      if (!result.success) {
        throw new Error(result.message || 'Could not load your verification status.');
      }
      setState({
        emailVerified: result.emailVerified === true,
        kycStatus: String(result.kycStatus || 'pending'),
        documents: Array.isArray(result.data) ? (result.data as KycDocument[]) : [],
        pendingDocument: (result.pendingDocument as KycDocument | null) || null,
        canSubmit: result.canSubmit === true,
        nextStep: String(result.nextStep || ''),
      });
    } catch (e: any) {
      setError(e?.message || 'Could not load your verification status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const status = state?.kycStatus || 'pending';
  const meta = statusMeta(status);
  const approvedDocument = useMemo(
    () => state?.documents.find((doc) => doc.status === 'approved') || null,
    [state],
  );
  const rejectedDocument = useMemo(
    () => state?.documents.find((doc) => doc.status === 'rejected') || null,
    [state],
  );

  const requestEmailVerification = async () => {
    setResendBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.requestEmailVerification();
      if (!result.success) throw new Error(result.message || 'Could not request a verification email.');
      setMessage(result.message || 'A verification link was sent to your account email.');
    } catch (e: any) {
      setError(e?.message || 'Could not request a verification email right now.');
    } finally {
      setResendBusy(false);
    }
  };

  const submitDocument = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!file) {
      setError('Choose a JPEG, PNG, or PDF identity document first.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('The identity document must be 5 MB or smaller.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Only JPEG, PNG, or PDF identity documents are accepted.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.uploadKycDocument(file, documentType);
      if (!result.success) throw new Error(result.message || 'The identity document could not be submitted.');
      setMessage(result.message || 'Identity document received. A reviewer must approve it before it counts as verification.');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'The identity document could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-3xl p-8 text-sm text-white/50" role="status">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading verification status…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-white/10 bg-linear-to-br from-emerald-500/10 via-transparent to-cyan-500/10 p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-emerald-200/70">IDENTITY &amp; ACCOUNT SECURITY</p>
            <h2 className="mt-2 font-display text-2xl text-white lg:text-3xl">Verification center</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
              Email verification and identity review are performed by VaultBank. A submitted document is not
              verification: a human reviewer must approve it before it unlocks verification-gated products.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh status
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="glass-panel rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {state?.emailVerified ? (
                <MailCheck className="h-5 w-5 text-emerald-300" />
              ) : (
                <MailWarning className="h-5 w-5 text-amber-300" />
              )}
              <div>
                <h3 className="font-display text-lg text-white">Email address</h3>
                <p className="text-xs text-white/40">One-time link verification</p>
              </div>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              state?.emailVerified
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
            }`}>
              {state?.emailVerified ? 'Verified' : 'Not verified'}
            </span>
          </div>
          {state?.emailVerified ? (
            <p className="mt-4 text-sm leading-relaxed text-white/50">
              Your email is verified. VaultBank can send security and account notices to this address.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-relaxed text-white/50">
                Verify your email before submitting identity documents or using customer fiat rails. A submitted
                KYC document cannot be accepted while the email is unverified.
              </p>
              <button
                type="button"
                onClick={() => void requestEmailVerification()}
                disabled={resendBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
              >
                {resendBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />}
                Send verification link
              </button>
              <p className="text-[11px] leading-relaxed text-white/35">
                If delivery is not configured, VaultBank will say so instead of claiming an email was sent.
              </p>
            </div>
          )}
        </section>

        <section className="glass-panel rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-cyan-300" />
              <div>
                <h3 className="font-display text-lg text-white">Identity verification</h3>
                <p className="text-xs text-white/40">Human-reviewed KYC</p>
              </div>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${meta.className}`}>
              {meta.label}
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-white/50">{state?.nextStep}</p>
          {status === 'verified' && (
            <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-200">
              <BadgeCheck className="h-4 w-4" />
              Approved {approvedDocument ? formatDate(approvedDocument.reviewedAt) : ''}
            </p>
          )}
          {state?.pendingDocument && (
            <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-amber-200">
              <Clock3 className="h-4 w-4" />
              {documentLabel(state.pendingDocument.documentType)} submitted {formatDate(state.pendingDocument.submittedAt)}
            </p>
          )}
          {status === 'rejected' && rejectedDocument?.reviewNotes && (
            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-rose-200/80">Reviewer note</p>
              <p className="mt-1 text-xs leading-relaxed text-white/60">{rejectedDocument.reviewNotes}</p>
            </div>
          )}
        </section>
      </div>

      {state?.canSubmit && (
        <section className="glass-panel rounded-3xl p-6">
          <h3 className="font-display text-lg text-white">Submit an identity document</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/40">
            One document at a time. JPEG, PNG, or PDF up to 5 MB. Document bytes are stored in VaultBank&apos;s
            PostgreSQL database and are visible only to you and authorized reviewers.
          </p>
          <form onSubmit={submitDocument} className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="kyc-document-type" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Document type
              </label>
              <select
                id="kyc-document-type"
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
              >
                {DOCUMENT_TYPES.map((item) => (
                  <option key={item.value} value={item.value} className="bg-[#0d0d14]">{item.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="kyc-document-file" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Identity document
              </label>
              <input
                ref={fileInput}
                id="kyc-document-file"
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="w-full cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
              {file && <p className="mt-2 truncate text-[11px] text-white/40">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={busy || !file}
                className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 px-5 py-3 text-sm font-bold text-emerald-950 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Submit for review
              </button>
            </div>
          </form>
        </section>
      )}

      {status === 'pending' && state?.emailVerified && !state?.canSubmit && !state?.pendingDocument && (
        <section className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/50">
          Identity verification is not available for this account right now. Contact VaultBank support; no
          verification was assumed.
        </section>
      )}

      <section className="glass-panel rounded-3xl p-6">
        <h3 className="flex items-center gap-2 font-display text-lg text-white">
          <FileText className="h-4 w-4 text-white/50" /> Document history
        </h3>
        {state && state.documents.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/35">
                  <th className="pb-2 pr-3 font-semibold">Document</th>
                  <th className="pb-2 pr-3 font-semibold">Submitted</th>
                  <th className="pb-2 pr-3 font-semibold">Status</th>
                  <th className="pb-2 font-semibold">Reviewer note</th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((doc) => {
                  const docMeta = statusMeta(doc.status === 'approved' ? 'verified' : doc.status);
                  return (
                    <tr key={doc.id} className="border-b border-white/5 last:border-0">
                      <td className="py-3 pr-3 text-white/75">{documentLabel(doc.documentType)}</td>
                      <td className="py-3 pr-3 text-white/45">{formatDate(doc.submittedAt)}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${docMeta.className}`}>
                          {doc.status === 'approved' ? <BadgeCheck className="h-3 w-3" /> : null}
                          {doc.status === 'rejected' ? <XCircle className="h-3 w-3" /> : null}
                          {docMeta.label}
                        </span>
                      </td>
                      <td className="py-3 text-white/45">{doc.reviewNotes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-white/40">No identity documents have been submitted.</p>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] leading-relaxed text-white/35">
        Verification does not issue a card, create credit, approve a loan, or move money by itself. Device
        management, two-factor authentication controls, and recovery-key tools shown in development builds are not
        connected to the live account service.
      </section>
    </div>
  );
}
