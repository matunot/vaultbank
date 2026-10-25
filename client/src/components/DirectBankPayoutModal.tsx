import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import { api } from '../api';

interface Availability {
  available: boolean;
  enabled?: boolean;
  provider?: string;
  mode?: string;
  autoTransfer?: boolean;
  reason?: string;
  minAmount?: number;
  maxAmount?: number;
}
interface PayoutRequest {
  id: string;
  requestReference: string;
  amount: number;
  currency: string;
  beneficiaryName: string;
  destinationAccountMasked: string;
  destinationIfsc: string;
  status: string;
  bankUtr?: string | null;
  createdAt: string;
  completedAt?: string | null;
}
interface Response {
  success: boolean;
  message?: string;
  availability?: Availability;
  requests?: PayoutRequest[];
  request?: PayoutRequest;
  [key: string]: any;
}
interface Props {
  isOpen: boolean;
  onClose: () => void;
  accountState: 'idle' | 'loading' | 'none' | 'ready' | 'error';
  onOpenInrAccount: () => Promise<void>;
}

export function DirectBankPayoutModal({ isOpen, onClose, accountState, onOpenInrAccount }: Props) {
  const profile = api.getUser();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [amount, setAmount] = useState('100.00');
  const [beneficiaryName, setBeneficiaryName] = useState(String(profile?.full_name || profile?.fullName || '').trim());
  const [bankAccount, setBankAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingAccount, setOpeningAccount] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const idempotencyKeyRef = useRef<string | null>(null);

  const refresh = async () => {
    setError('');
    try {
      const [a, r] = await Promise.all([
        api.directBankPayoutAvailability() as Promise<Response>,
        api.directBankPayoutRequests() as Promise<Response>,
      ]);
      setAvailability({
        available: Boolean(a.available),
        enabled: Boolean(a.enabled ?? a.available),
        provider: a.provider,
        mode: a.mode,
        autoTransfer: a.autoTransfer,
        reason: a.reason,
        minAmount: a.minAmount,
        maxAmount: a.maxAmount,
      });
      setRequests(Array.isArray(r.requests) ? r.requests : []);
    } catch (err: any) {
      setError(err?.message || 'Could not load VaultBank manual payout status.');
    }
  };

  useEffect(() => {
    if (isOpen) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = Number(amount);
    const normalizedIfsc = ifsc.trim().toUpperCase();
    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 10000 || Math.round(parsed * 100) !== parsed * 100) {
      setError('Enter an amount from ₹10 to ₹10,000 with at most two decimals.');
      return;
    }
    if (beneficiaryName.trim().length < 2 || !/^\d{6,20}$/.test(bankAccount.trim()) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      setError('Enter your profile name, a 6–20 digit bank account number and a valid IFSC.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = 'vb-payout-' + Date.now() + '-' + Math.random().toString(36).slice(2, 14);
      }
      const result = await api.createDirectBankPayoutRequest({
        amount: parsed,
        beneficiaryName: beneficiaryName.trim(),
        bankAccount: bankAccount.trim(),
        ifsc: normalizedIfsc,
      }, idempotencyKeyRef.current) as Response;
      if (!result.success || !result.request) throw new Error(result.message || 'Could not create payout request.');
      idempotencyKeyRef.current = null;
      setNotice('Request recorded. Funds are reserved; the bank transfer has NOT been sent automatically.');
      setBankAccount('');
      setIfsc('');
      await refresh();
    } catch (err: any) {
      // Keep the same key for ambiguous network/5xx failures so retrying cannot reserve twice.
      // Definitive validation/conflict responses let the user correct the form.
      if (err?.status >= 400 && err.status < 500 && err.status !== 503) idempotencyKeyRef.current = null;
      setError(err?.message || 'Payout request failed. Check the request status before retrying.');
    } finally {
      setBusy(false);
    }
  };

  const openAccount = async () => {
    setOpeningAccount(true);
    setError('');
    try {
      await onOpenInrAccount();
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not open an INR VaultBank account.');
    } finally {
      setOpeningAccount(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="VaultBank manual bank payout">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-amber-300"><Banknote className="h-5 w-5" /><span className="text-[10px] font-bold tracking-[0.22em]">VAULTBANK-OWNED RAIL</span></div>
            <h2 className="text-xl font-bold text-white">Manual Bank Payout</h2>
            <p className="mt-1 text-xs text-white/50">No Cashfree/Stripe/PayPal payout API. A VaultBank operator initiates the transfer through the bank.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
          {notice && <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
            <AlertTriangle className="mr-1 inline h-4 w-4" /> Submitting reserves your INR balance but does not send money by itself. An authorized operator must send the bank transfer and confirm the real bank-statement UTR. Refunds are allowed only after verifying that no transfer was sent.
          </div>

          {accountState === 'none' ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-white">Open your INR account first.</p>
              <button type="button" onClick={() => void openAccount()} disabled={openingAccount} className="mt-3 flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {openingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Open INR account
              </button>
            </div>
          ) : accountState === 'idle' || accountState === 'loading' ? (
            <div className="flex items-center gap-2 rounded-xl bg-white/5 p-4 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Checking INR account…</div>
          ) : accountState === 'error' ? (
            <div className="rounded-xl bg-rose-500/5 p-4 text-sm text-rose-200">INR account status could not be confirmed; refresh your account before requesting a payout.</div>
          ) : !availability?.available ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-white">Manual payout is disabled or missing its encryption key.</p>
              <p className="mt-2 text-xs leading-relaxed text-white/50">Operator configuration: VB_DIRECT_BANK_PAYOUTS_ENABLED=true and a 64-character hex key in VB_DIRECT_PAYOUT_ENCRYPTION_KEY. No payout can be requested until both are configured.</p>
              <button type="button" onClick={() => void refresh()} className="mt-3 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white">Refresh configuration</button>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="space-y-3">
                <label className="block text-[10px] font-bold tracking-wider text-white/45">PAYOUT AMOUNT (INR)
                  <input type="number" value={amount} min="10" max="10000" step="0.01" onChange={(e) => setAmount(e.target.value)} className="mt-1 block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-lg text-white outline-none focus:border-cyan-400" />
                </label>
                <label className="block text-[10px] font-bold tracking-wider text-white/45">BENEFICIARY NAME — MUST MATCH YOUR PROFILE
                  <input value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} autoComplete="name" className="mt-1 block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                </label>
                <label className="block text-[10px] font-bold tracking-wider text-white/45">BANK ACCOUNT NUMBER
                  <input inputMode="numeric" autoComplete="off" value={bankAccount} onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, '').slice(0, 20))} className="mt-1 block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
                </label>
                <label className="block text-[10px] font-bold tracking-wider text-white/45">IFSC
                  <input autoComplete="off" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 11))} maxLength={11} className="mt-1 block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm uppercase text-white outline-none focus:border-cyan-400" />
                </label>
                <p className="text-[10px] text-white/35">Bank account number is encrypted at rest with AES-256-GCM. The app stores only a masked account number for user-facing history; only authorized admins can view the full destination for manual payout.</p>
                <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{busy ? 'Reserving funds…' : 'Reserve funds & request bank transfer'}
                </button>
              </form>
            </>
          )}

          {requests.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold tracking-wider text-white/40">MY MANUAL PAYOUT REQUESTS</p>
              {requests.slice(0, 10).map((request) => (
                <div key={request.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-white">{request.requestReference}</p>
                    <p className="mt-0.5 text-[10px] text-white/40">{request.destinationAccountMasked} · {request.destinationIfsc} · {new Date(request.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">₹{Number(request.amount).toFixed(2)}</p>
                    <p className={'text-[9px] font-bold uppercase ' + (request.status === 'succeeded' ? 'text-emerald-300' : request.status === 'failed_refunded' ? 'text-rose-300' : 'text-amber-300')}>{request.status.replace('_', ' ')}</p>
                    {request.bankUtr && <p className="font-mono text-[9px] text-white/40">UTR {request.bankUtr}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
