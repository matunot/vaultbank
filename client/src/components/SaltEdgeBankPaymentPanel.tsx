import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Building2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

interface Provider {
  code: string;
  name: string;
  countryCode: string;
  paymentTemplates: string[];
  logoUrl?: string | null;
}

export function SaltEdgeBankPaymentPanel() {
  const [readiness, setReadiness] = useState<{ available: boolean; currencies?: string[] } | null>(null);
  const [currency, setCurrency] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerCode, setProviderCode] = useState('');
  const [amount, setAmount] = useState('25.00');
  const [loading, setLoading] = useState(true);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.saltEdgePISReadiness()
      .then((result) => {
        if (!active) return;
        const currencies = Array.isArray(result.currencies) ? result.currencies as string[] : [];
        setReadiness({ available: result.available === true, currencies });
        if (currencies.length) setCurrency(currencies[0]);
      })
      .catch(() => {
        if (active) setReadiness({ available: false, currencies: [] });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!readiness?.available || !currency) {
      setProviders([]);
      setProviderCode('');
      return;
    }
    let active = true;
    setLoadingProviders(true);
    setError('');
    api.saltEdgePISProviders(currency)
      .then((result) => {
        if (!active) return;
        const list = Array.isArray(result.providers) ? result.providers as Provider[] : [];
        setProviders(list);
        setProviderCode((current) => list.some((item) => item.code === current) ? current : (list[0]?.code || ''));
      })
      .catch((err: any) => {
        if (!active) return;
        setProviders([]);
        setProviderCode('');
        setError(err?.message || 'Could not load banks available for live payment initiation.');
      })
      .finally(() => { if (active) setLoadingProviders(false); });
    return () => { active = false; };
  }, [readiness?.available, currency]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.code === providerCode) || null,
    [providers, providerCode],
  );

  const startPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !providerCode) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0 || Math.round(parsed * 100) !== parsed * 100) {
      setError('Enter a positive amount with no more than two decimal places.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.createSaltEdgePISDeposit({
        amount: parsed.toFixed(2),
        currency,
        providerCode,
      });
      if (!result.success || !result.connectUrl) {
        throw new Error(result.message || 'The live bank-payment session could not be created.');
      }
      // The customer authorizes the payment directly with their own bank.
      window.location.assign(result.connectUrl);
    } catch (err: any) {
      setError(err?.message || 'Could not start the bank payment.');
      setBusy(false);
    }
  };

  if (loading || !readiness?.available || !readiness.currencies?.length) return null;

  return (
    <section className="glass-panel rounded-3xl border border-cyan-500/20 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-[10px] font-bold tracking-[0.2em]">LIVE OPEN BANKING</span>
          </div>
          <h3 className="font-display text-xl text-white">Add money from your bank</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
            Choose your bank and authorize the transfer securely with that bank. VaultBank will reconcile the actual incoming settlement before making funds spendable.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[10px] font-bold text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> LIVE ENABLED
        </div>
      </div>

      {error && <div role="alert" className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      <form onSubmit={(event) => void startPayment(event)} className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="block text-[10px] font-bold tracking-wider text-white/45">
          CURRENCY
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy} className="mt-1 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400">
            {readiness.currencies?.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className="block text-[10px] font-bold tracking-wider text-white/45">
          BANK
          <select value={providerCode} onChange={(event) => setProviderCode(event.target.value)} disabled={busy || loadingProviders || providers.length === 0} className="mt-1 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400">
            {providers.length === 0 && <option value="">{loadingProviders ? 'Loading banks…' : 'No active banks available'}</option>}
            {providers.map((provider) => <option key={provider.code} value={provider.code}>{provider.name} ({provider.countryCode})</option>)}
          </select>
        </label>
        <label className="block text-[10px] font-bold tracking-wider text-white/45">
          AMOUNT ({currency})
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required disabled={busy} className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400" />
        </label>
        <div className="sm:col-span-3">
          <button type="submit" disabled={busy || loadingProviders || !selectedProvider} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            Continue to your bank <ArrowUpRight className="h-4 w-4" />
          </button>
          {loadingProviders && <p className="mt-2 flex items-center gap-2 text-xs text-white/40"><RefreshCw className="h-3 w-3 animate-spin" /> Loading live payment providers…</p>}
        </div>
      </form>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/75">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Authorizing a bank payment is not the same as final settlement. The wallet is not credited by a browser redirect or a provider callback alone.
      </div>
    </section>
  );
}
