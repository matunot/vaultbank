import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, QrCode, ShieldCheck, X } from 'lucide-react';
import { api } from '../api';

interface DirectUpiConfig {
  enabled: boolean;
  vpa?: string | null;
  payeeName?: string | null;
  minAmount?: number;
  maxAmount?: number;
  expiryMinutes?: number;
  verification?: string;
  reason?: string;
}
interface DirectUpiIntent {
  id: string;
  reference: string;
  amount: number;
  currency: 'INR';
  status: string;
  createdAt: string;
  expiresAt: string;
  settledAt?: string | null;
}
interface DirectUpiTransfer {
  vpa: string;
  payeeName: string;
  amount: string;
  currency: 'INR';
  reference: string;
  upiUri: string;
  qrDataUrl: string;
  note: string;
  verification: string;
}
interface DirectUpiResponse {
  success: boolean;
  message?: string;
  config?: DirectUpiConfig;
  intent?: DirectUpiIntent;
  transfer?: DirectUpiTransfer;
  intents?: DirectUpiIntent[];
  [key: string]: any;
}
interface Props {
  isOpen: boolean;
  onClose: () => void;
  accountState: 'idle' | 'loading' | 'none' | 'ready' | 'error';
  onOpenInrAccount: () => Promise<void>;
}

export function DirectUpiDepositModal({ isOpen, onClose, accountState, onOpenInrAccount }: Props) {
  const [config, setConfig] = useState<DirectUpiConfig | null>(null);
  const [amount, setAmount] = useState('100.00');
  const [busy, setBusy] = useState(false);
  const [openingAccount, setOpeningAccount] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<{ intent: DirectUpiIntent; transfer: DirectUpiTransfer } | null>(null);
  const [history, setHistory] = useState<DirectUpiIntent[]>([]);
  const [copied, setCopied] = useState('');
  const intentKeyRef = useRef<string | null>(null);

  const refresh = async () => {
    setError('');
    try {
      const results = await Promise.all([
        api.directUpiConfig() as Promise<DirectUpiResponse>,
        api.directUpiIntents() as Promise<DirectUpiResponse>,
      ]);
      setConfig({
        enabled: Boolean(results[0].enabled),
        vpa: results[0].vpa || null,
        payeeName: results[0].payeeName || null,
        minAmount: results[0].minAmount,
        maxAmount: results[0].maxAmount,
        expiryMinutes: results[0].expiryMinutes,
        verification: results[0].verification,
        reason: results[0].reason,
      });
      setHistory(Array.isArray(results[1].intents) ? results[1].intents : []);
    } catch (err: any) {
      setError(err?.message || 'Could not load direct UPI status.');
    }
  };

  useEffect(() => {
    if (isOpen) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const createIntent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10000 || Math.round(parsed * 100) !== parsed * 100) {
      setError('Enter an amount from ₹1 to ₹10,000 with at most two decimals.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!intentKeyRef.current) {
        intentKeyRef.current = `dupi-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
      }
      const response = await api.createDirectUpiIntent({ amount: parsed }, intentKeyRef.current) as DirectUpiResponse;
      if (!response.success || !response.intent || !response.transfer) {
        throw new Error(response.message || 'Could not create a direct UPI request.');
      }
      // A definitive server response consumes this attempt key. Network failures keep
      // the key so a retry can recover the same pending intent without duplicating it.
      intentKeyRef.current = null;
      setCurrent({ intent: response.intent, transfer: response.transfer });
      setHistory((old) => [response.intent!, ...old.filter((item) => item.id !== response.intent!.id)].slice(0, 20));
    } catch (err: any) {
      setError(err?.message || 'Could not create a direct UPI request.');
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('Clipboard permission was denied. Select and copy the value manually.');
    }
  };

  const openAccount = async () => {
    setOpeningAccount(true);
    setError('');
    try {
      await onOpenInrAccount();
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not open the INR account.');
    } finally {
      setOpeningAccount(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="VaultBank Direct UPI deposit">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-emerald-300">
              <QrCode className="h-5 w-5" />
              <span className="text-[10px] font-bold tracking-[0.22em]">VAULTBANK-OWNED RAIL</span>
            </div>
            <h2 className="text-xl font-bold text-white">Direct UPI Deposit</h2>
            <p className="mt-1 text-xs text-white/50">No Cashfree, Stripe, or PayPal API is used for this payment request.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

          {accountState === 'none' ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-white">Open your INR VaultBank account first.</p>
              <p className="mt-1 text-xs text-white/50">No deposit intent or ledger credit can be created until the INR account exists.</p>
              <button type="button" onClick={() => void openAccount()} disabled={openingAccount} className="mt-4 flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {openingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Open INR account
              </button>
            </div>
          ) : accountState === 'idle' || accountState === 'loading' ? (
            <div className="flex items-center gap-2 rounded-xl bg-white/5 p-4 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Checking your INR account…</div>
          ) : accountState === 'error' ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">Your INR account status could not be checked. Refresh the account data before creating a deposit.</div>
          ) : error && !config ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-white">Direct UPI access could not be loaded.</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/60">{error} Customer access may be restricted to verified pilot users. Do not send money unless the verified receiver details are displayed.</p>
                </div>
              </div>
              <button type="button" onClick={() => void refresh()} className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15">Retry configuration</button>
            </div>
          ) : !config?.enabled ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-white">Direct UPI is not configured yet.</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">The operator must configure a real, bank-linked receiving VPA and payee name in Render. No test VPA or invented account details are used.</p>
                  <p className="mt-2 font-mono text-[10px] text-white/30">VB_UPI_DEPOSIT_ENABLED · VB_UPI_RECEIVING_VPA · VB_UPI_RECEIVING_NAME</p>
                </div>
              </div>
              <button type="button" onClick={() => void refresh()} className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15">Refresh configuration</button>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  <p className="text-sm font-semibold text-white">Receiving VPA configured</p>
                </div>
                <p className="mt-2 break-all font-mono text-sm text-emerald-200">{config.payeeName} · {config.vpa}</p>
                <p className="mt-1 text-[11px] text-white/45">The UPI payment goes to this bank-linked VPA. Configure it only if you control the receiving account and your bank permits the intended use.</p>
              </div>

              {!current && (
                <form onSubmit={createIntent} className="space-y-3">
                  <label className="block text-[10px] font-bold tracking-wider text-white/45">DEPOSIT AMOUNT (INR)</label>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-white">₹</span>
                    <input type="number" inputMode="decimal" min="1" max="10000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg text-white outline-none focus:border-cyan-400" />
                  </div>
                  <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                    {busy ? 'Creating secure intent…' : 'Create UPI QR & reference'}
                  </button>
                </form>
              )}

              {current && (
                <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
                    <div className="mx-auto rounded-xl bg-white p-2">
                      <img src={current.transfer.qrDataUrl} alt="UPI QR code for the exact amount and reference" className="h-36 w-36" />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <p className="text-[10px] font-bold tracking-wider text-white/40">PAY EXACTLY</p>
                      <p className="text-3xl font-bold text-white">₹{Number(current.intent.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className="text-xs text-white/50">{current.transfer.payeeName}</p>
                      <button type="button" onClick={() => void copyValue(current.transfer.vpa, 'vpa')} className="flex w-full items-center justify-between gap-2 break-all rounded-lg bg-white/5 p-2 text-left font-mono text-xs text-emerald-200">
                        <span>{current.transfer.vpa}</span><Copy className="h-3.5 w-3.5 shrink-0" />{copied === 'vpa' ? 'Copied' : ''}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-xl bg-black/20 p-3">
                    <p className="text-[10px] font-bold tracking-wider text-white/40">PAYMENT REFERENCE — INCLUDE IT IN THE UPI NOTE IF AVAILABLE</p>
                    <button type="button" onClick={() => void copyValue(current.intent.reference, 'reference')} className="flex w-full items-center justify-between gap-2 break-all text-left font-mono text-sm text-cyan-200">
                      <span>{current.intent.reference}</span><Copy className="h-3.5 w-3.5 shrink-0" />
                    </button>
                    <p className="text-[11px] text-white/40">Expires {new Date(current.intent.expiresAt).toLocaleString()}</p>
                  </div>
                  <a href={current.transfer.upiUri} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 hover:bg-emerald-500/15">
                    Open UPI app <ExternalLink className="h-4 w-4" />
                  </a>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
                    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" /> Awaiting bank-statement verification</p>
                    <p className="mt-1">Sending the payment does not credit your VaultBank balance automatically. An authorized operator must match the actual bank statement amount and unique UTR first. A screenshot or SMS alone is not proof.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setCurrent(null); intentKeyRef.current = null; }} className="flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/15">Create another intent</button>
                    <button type="button" onClick={() => void refresh()} className="rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/15">Refresh status</button>
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold tracking-wider text-white/40">RECENT DIRECT UPI INTENTS</p>
                  {history.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-white">{item.reference}</p>
                        <p className="mt-0.5 text-[10px] text-white/40">{new Date(item.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">₹{Number(item.amount).toFixed(2)}</p>
                        <p className={'text-[9px] font-bold uppercase ' + (item.status === 'settled' ? 'text-emerald-300' : item.status === 'failed' || item.status === 'expired' || item.status === 'cancelled' ? 'text-rose-300' : 'text-amber-300')}>{item.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
