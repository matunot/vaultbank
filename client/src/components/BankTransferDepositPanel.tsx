import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../api';

interface BankDepositConfig {
  enabled: boolean;
  bankName?: string | null;
  holder?: string | null;
  details?: string | null;
  currency?: string | null;
  verification?: string;
  reason?: string;
  minAmount?: number;
  maxAmount?: number;
  maxOpen?: number;
  openCount?: number;
  expiryHours?: number;
  currencies?: string[];
}
interface BankDepositInstruction {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  settledAt?: string | null;
  settlementAmount?: number | null;
}
interface TransferDetails {
  bankName: string;
  holder: string;
  details: string;
  currency: string;
  amount: number;
  reference: string;
  note: string;
}
type ApiErrorLike = Error & { status?: number };

function statusLabel(status: string) {
  switch (status) {
    case 'settled': return 'SETTLED';
    case 'pending': return 'PENDING VERIFICATION';
    case 'settling': return 'UNDER REVIEW';
    case 'cancelled': return 'CANCELLED';
    case 'expired': return 'EXPIRED';
    case 'failed': return 'NOT RECEIVED';
    case 'reversed': return 'REVERSED';
    case 'reversal_required': return 'REVERSAL REVIEW';
    default: return status.replace(/_/g, ' ').toUpperCase();
  }
}

export function BankTransferDepositPanel() {
  const [config, setConfig] = useState<BankDepositConfig | null>(null);
  const [instructions, setInstructions] = useState<BankDepositInstruction[]>([]);
  const [amount, setAmount] = useState('100.00');
  const [transfer, setTransfer] = useState<TransferDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyCancel, setBusyCancel] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configResult, historyResult] = await Promise.all([
        api.bankDepositConfig(),
        api.bankDepositInstructions(),
      ]);
      const baseConfig = configResult as unknown as BankDepositConfig;
      const currencies = Array.isArray(baseConfig.currencies)
        ? baseConfig.currencies
        : (baseConfig.enabled && baseConfig.currency ? [baseConfig.currency] : []);
      const nextCurrency = currencies.includes(selectedCurrency)
        ? selectedCurrency
        : (baseConfig.currency || currencies[0] || 'USD');
      const selectedConfig = baseConfig.currency === nextCurrency
        ? baseConfig
        : (await api.bankDepositConfig(nextCurrency)) as unknown as BankDepositConfig;
      setSelectedCurrency(nextCurrency);
      setConfig({ ...selectedConfig, currencies });
      setInstructions(Array.isArray(historyResult.instructions) ? historyResult.instructions : []);
    } catch (err) {
      const apiErr = err as ApiErrorLike;
      if (apiErr.status === 403) {
        setError('Real-money deposit instructions are available only after email and identity verification.');
      } else {
        setError(apiErr.message || 'Could not load bank-transfer deposit status.');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedCurrency]);

  useEffect(() => { void refresh(); }, [refresh]);

  const changeCurrency = (currency: string) => {
    if (busy || !config?.currencies?.includes(currency)) return;
    setSelectedCurrency(currency);
    setTransfer(null);
    setError('');
    setNotice('');
  };

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1400);
    } catch {
      setError('Clipboard access was denied. Select and copy the value manually.');
    }
  };

  const createInstruction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !config?.enabled || !config.currency) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < (config.minAmount ?? 1) || parsed > (config.maxAmount ?? 100000) || Math.round(parsed * 100) !== parsed * 100) {
      setError(`Enter an amount from ${config.currency} ${config.minAmount ?? 1} to ${config.maxAmount ?? 100000}, with at most two decimals.`);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setTransfer(null);
    try {
      const result = await api.createBankDepositInstruction({ amount: parsed, currency: config.currency });
      if (!result.success || !result.instruction || !result.transfer) {
        throw new Error(result.message || 'Could not create a deposit instruction.');
      }
      setTransfer(result.transfer as TransferDetails);
      setInstructions((current) => [result.instruction as BankDepositInstruction, ...current.filter((item) => item.id !== result.instruction.id)].slice(0, 20));
      setNotice('Instruction created. No balance has been credited.');
      setAmount('');
      await refresh();
    } catch (err) {
      const apiErr = err as ApiErrorLike;
      setError(apiErr.message || 'Could not create a deposit instruction.');
      if (apiErr.message?.includes('active') || apiErr.message?.includes('account')) {
        setError((apiErr.message || 'A matching currency account is required.') + (config.currency === 'INR' ? ' Open your INR account in the Payments section, then retry.' : ' Check that your account exists in the configured receiving currency.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelInstruction = async (item: BankDepositInstruction) => {
    if (busyCancel) return;
    setBusyCancel(item.id);
    setError('');
    setNotice('');
    try {
      const result = await api.cancelBankDepositInstruction(item.id);
      if (!result.success) throw new Error(result.message || 'Could not cancel this instruction.');
      setInstructions((current) => current.map((row) => row.id === item.id ? { ...row, status: 'cancelled' } : row));
      if (transfer?.reference === item.reference) setTransfer(null);
      setNotice('Instruction cancelled. Any actual bank arrival must still be investigated against the statement; cancellation does not reverse a transfer.');
      await refresh();
    } catch (err) {
      setError((err as Error).message || 'Could not cancel this instruction.');
    } finally {
      setBusyCancel(null);
    }
  };

  return (
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-cyan-300">
            <Building2 className="h-5 w-5" />
            <span className="text-[10px] font-bold tracking-[0.2em]">VAULTBANK-NATIVE BANK TRANSFER</span>
          </div>
          <h3 className="font-display text-xl text-white">Deposit by Bank Transfer</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">VaultBank creates the reference and ledger record itself. Your balance remains unchanged until an authorized operator matches the real incoming bank-statement entry and unique transaction reference.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || busy} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
        </button>
      </div>

      {error && <div role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Checking native bank-transfer availability…</div>
      ) : config?.enabled ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-white">Create deposit instruction</p>
              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9px] font-bold text-amber-200">MANUAL VERIFICATION</span>
            </div>
            <p className="mt-2 text-xs text-white/45">Limits: {config.currency} {Number(config.minAmount ?? 1).toLocaleString()}–{Number(config.maxAmount ?? 100000).toLocaleString()} · {config.maxOpen ?? 3} open instructions maximum · expires after {config.expiryHours ?? 168} hours.</p>
            {(config.currencies?.length ?? 0) > 1 && (
              <label className="mt-3 block text-[10px] font-bold tracking-wider text-white/45">
                RECEIVE CURRENCY
                <select
                  value={selectedCurrency}
                  disabled={busy || loading}
                  onChange={(event) => changeCurrency(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400"
                >
                  {config.currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
            )}
            <form onSubmit={(event) => void createInstruction(event)} className="mt-4 space-y-3">
              <label className="block text-[10px] font-bold tracking-wider text-white/45">
                AMOUNT ({config.currency})
                <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" placeholder="100.00" />
              </label>
              <button type="submit" disabled={busy || (config.openCount ?? 0) >= (config.maxOpen ?? 3)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />} Create bank-transfer instructions
              </button>
              {(config.openCount ?? 0) >= (config.maxOpen ?? 3) && <p className="text-xs text-amber-200">You have reached the open-instruction limit. Cancel or resolve an existing instruction first.</p>}
            </form>
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
              <AlertTriangle className="mr-1 inline h-4 w-4" /> Do not send money until VaultBank shows real receiving-account details and a unique reference. A created instruction is not proof of payment.
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4">
            <p className="text-sm font-bold text-white">Receiving account</p>
            <p className="mt-1 text-xs text-white/45">These values come only from the operator's configured real receiving account. VaultBank does not invent bank details.</p>
            <div className="mt-4 space-y-3">
              <div><p className="text-[9px] font-bold tracking-wider text-white/35">BANK</p><p className="mt-1 break-words text-sm text-white">{config.bankName}</p></div>
              <div><p className="text-[9px] font-bold tracking-wider text-white/35">ACCOUNT HOLDER</p><p className="mt-1 break-words text-sm text-white">{config.holder}</p></div>
              <div><p className="text-[9px] font-bold tracking-wider text-white/35">TRANSFER DETAILS</p><button type="button" onClick={() => void copy(config.details || '', 'details')} className="mt-1 w-full break-all rounded-xl border border-white/10 bg-black/20 p-3 text-left font-mono text-sm text-cyan-200">{copied === 'details' ? 'Copied' : config.details}</button></div>
            </div>
            {transfer && (
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-4 w-4" /><p className="text-sm font-bold">Your instruction</p></div>
                <p className="mt-3 text-xs text-white/45">Send this exact amount and include the reference in your bank transfer description.</p>
                <p className="mt-2 text-2xl font-bold text-white">{transfer.currency} {Number(transfer.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <button type="button" onClick={() => void copy(transfer.reference, 'reference')} className="mt-2 w-full break-all rounded-lg border border-white/10 bg-black/25 p-3 text-left font-mono text-sm text-emerald-200">{copied === 'reference' ? 'Reference copied' : transfer.reference}</button>
                <p className="mt-2 text-xs leading-relaxed text-white/55">{transfer.note}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <p className="text-sm font-semibold text-white">Native bank deposits are not configured</p>
              <p className="mt-1 text-xs leading-relaxed text-white/55">No receiving details are shown. The operator must configure an actual bank account that VaultBank is authorized to use. This screen will not generate a fake account number, IFSC or payment destination.</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-white/10 pt-5">
        <h4 className="text-sm font-bold text-white">Your deposit instructions</h4>
        {instructions.length === 0 ? (
          <p className="mt-3 text-sm text-white/40">No bank-transfer instructions yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {instructions.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-xs font-bold text-cyan-200">{item.reference}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{item.currency} {Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="mt-1 text-[10px] text-white/40">Created {new Date(item.createdAt).toLocaleString()} · Expires {new Date(item.expiresAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={'rounded-full border px-2 py-1 text-[9px] font-bold ' + (item.status === 'settled' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : item.status === 'pending' || item.status === 'settling' ? 'border-amber-500/25 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-white/50')}>{statusLabel(item.status)}</span>
                  {item.status === 'pending' && <button type="button" onClick={() => void cancelInstruction(item)} disabled={busyCancel === item.id || busy} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-white/70 disabled:opacity-50">{busyCancel === item.id ? 'Cancelling…' : 'Cancel'}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
