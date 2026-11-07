import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2,
  ExternalLink, Landmark, LockKeyhole, RefreshCw, Send, ShieldCheck,
  Unplug, Wallet,
} from 'lucide-react';
import { api } from '../api';

type Rail = Record<string, any>;
type Readiness = {
  nativeOnly?: boolean;
  rails?: {
    usd?: Rail;
    inr?: Rail;
  };
  currencyRails?: Array<{ currency: string; enabled: boolean; verification?: string; reason?: string }>;
};

const RENDER_ENV_URL = 'https://dashboard.render.com/web/srv-d9tg2kajobas73ctduug/env';

function Status({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ready ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-200 border border-amber-500/20'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-300'}`} />
      {children}
    </span>
  );
}

function RailCard({
  icon: Icon,
  title,
  description,
  status,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="glass-panel rounded-2xl p-5 border border-white/8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-amber-200" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs text-white/45">{description}</p>
          </div>
        </div>
        <span className="text-[10px] text-white/45 shrink-0">{status}</span>
      </div>
      <p className="mt-4 text-xs leading-5 text-white/55">{detail}</p>
    </div>
  );
}

export default function BankApiSetupSection() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.paymentsReadiness();
      if (!result?.success || !result?.rails) {
        throw new Error(result?.message || 'Bank rail status is unavailable.');
      }
      setReadiness(result as Readiness);
    } catch (err: any) {
      setReadiness(null);
      setError(err?.message || 'Could not read the live bank integration status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const inr = readiness?.rails?.inr || {};
  const usd = readiness?.rails?.usd || {};
  const inrBank = readiness?.currencyRails?.find((rail) => rail.currency === 'INR');
  const admin = ['admin', 'super_admin'].includes(String(api.getUser()?.role || '').toLowerCase());

  if (!admin) {
    return (
      <div className="glass-panel rounded-3xl p-8 border border-rose-500/20">
        <h2 className="text-lg font-semibold text-white">Admin access required</h2>
        <p className="mt-2 text-sm text-white/55">This setup page is only available to VaultBank administrators.</p>
      </div>
    );
  }

  const bankDepositReady = inrBank?.enabled === true;
  const upiReady = inr.directUpi === true;
  const payoutReady = inr.directBankPayouts === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.25em] text-amber-300/60 font-semibold">ADMIN · CONNECTIVITY</p>
          <h1 className="mt-2 font-display text-3xl text-white">Bank API Setup</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
            Manage the bank-rail configuration status and open the protected environment settings for credentials.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/75 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh status
        </button>
      </div>

      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/8 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-200 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-100">No automatic bank API is active in production</p>
          <p className="mt-1 text-xs leading-5 text-white/60">
            The current production build runs in native-only mode. Adding API keys alone will not activate bank transfers. A bank-specific, server-side adapter and an approved bank/PSP settlement arrangement are still required.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <RailCard
          icon={Send}
          title="VaultBank-to-VaultBank transfers"
          description="Internal customer transfers"
          status={loading ? 'Checking…' : usd.internalTransfers && inr.internalTransfers ? 'Available' : 'Unavailable'}
          detail="This moves funds between VaultBank customer ledger accounts. It is not an external bank transfer."
        />
        <RailCard
          icon={ArrowDownToLine}
          title="Bank deposit instructions (INR)"
          description="Inbound bank transfer"
          status={loading ? 'Checking…' : bankDepositReady ? 'Configured · manual review' : 'Not configured'}
          detail="A customer transfer is credited only after an administrator verifies the real bank statement, exact amount and unique transaction reference."
        />
        <RailCard
          icon={Wallet}
          title="UPI collection"
          description="UPI intent / QR"
          status={loading ? 'Checking…' : upiReady ? 'Configured · manual review' : 'Not configured'}
          detail="The current UPI flow is not an automatic bank API. Funds are reconciled against the official statement before any ledger credit."
        />
        <RailCard
          icon={ArrowUpFromLine}
          title="Bank payout"
          description="Outbound INR request"
          status={loading ? 'Checking…' : payoutReady ? 'Configured · operator transfer' : 'Not configured'}
          detail="A payout request reserves funds. An authorized operator still sends the bank transfer separately and records the bank reference."
        />
      </section>

      <section className="glass-panel rounded-2xl p-5 border border-white/8">
        <div className="flex items-center gap-3">
          <Unplug className="h-5 w-5 text-amber-200" />
          <div>
            <h2 className="text-base font-semibold text-white">External bank API connection</h2>
            <p className="mt-1 text-xs text-white/45">Provider adapter status</p>
          </div>
          <div className="ml-auto"><Status ready={false}>Not connected</Status></div>
        </div>
        <p className="mt-4 text-sm leading-6 text-white/60">
          There is no universal bank API format. VaultBank must implement the selected bank or payment provider's authentication, beneficiary/transfer endpoints, signed callbacks and reconciliation rules. The old generic provider adapters are intentionally blocked in production.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-black/15 border border-white/5 p-3">
            <p className="text-xs font-semibold text-white">Incoming money</p>
            <p className="mt-1 text-xs text-white/45">Collection / virtual account API + verified settlement callback</p>
          </div>
          <div className="rounded-xl bg-black/15 border border-white/5 p-3">
            <p className="text-xs font-semibold text-white">Outgoing money</p>
            <p className="mt-1 text-xs text-white/45">Beneficiary validation + payout API + status / UTR reconciliation</p>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-5 border border-white/8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-emerald-300" />
              <h2 className="text-base font-semibold text-white">Where to add configuration</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-white/50">
              Bank credentials must be saved as server-side secrets in Render. They must never be pasted into the browser, GitHub, or customer-facing forms.
            </p>
          </div>
          <a href={RENDER_ENV_URL} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 shrink-0">
            Open Render Environment <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-xl bg-black/15 p-4 border border-white/5">
            <h3 className="text-xs font-bold text-white">Bank deposit instructions</h3>
            <p className="mt-1 text-[11px] text-white/45">Manual statement verification only</p>
            <code className="block mt-3 text-[10px] leading-5 text-amber-100/80 break-words">VB_BANK_DEPOSIT_ENABLED</code>
            <code className="block text-[10px] leading-5 text-amber-100/80 break-words">VB_BANK_RECEIVING_INR_BANK_NAME</code>
            <code className="block text-[10px] leading-5 text-amber-100/80 break-words">VB_BANK_RECEIVING_INR_HOLDER</code>
            <code className="block text-[10px] leading-5 text-amber-100/80 break-words">VB_BANK_RECEIVING_INR_DETAILS</code>
          </div>
          <div className="rounded-xl bg-black/15 p-4 border border-white/5">
            <h3 className="text-xs font-bold text-white">UPI collection details</h3>
            <p className="mt-1 text-[11px] text-white/45">Manual statement verification only</p>
            <code className="block mt-3 text-[10px] leading-5 text-amber-100/80 break-words">VB_UPI_DEPOSIT_ENABLED</code>
            <code className="block text-[10px] leading-5 text-amber-100/80 break-words">VB_UPI_RECEIVING_VPA</code>
            <code className="block text-[10px] leading-5 text-amber-100/80 break-words">VB_UPI_RECEIVING_NAME</code>
          </div>
          <div className="rounded-xl bg-black/15 p-4 border border-white/5">
            <h3 className="text-xs font-bold text-white">Manual bank payout</h3>
            <p className="mt-1 text-[11px] text-white/45">Operator sends transfer separately</p>
            <code className="block mt-3 text-[10px] leading-5 text-amber-100/80 break-words">VB_DIRECT_BANK_PAYOUTS_ENABLED</code>
            <code className="block text-[10px] leading-5 text-amber-100/80 break-words">VB_DIRECT_PAYOUT_ENCRYPTION_KEY</code>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-white/40">
          The variables above configure receiving instructions/manual operations; they are not bank API credentials. Do not enable a rail until the receiving account belongs to the authorized VaultBank entity and its use is approved.
        </p>
      </section>

      <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4 flex gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-300 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-white">Customer money stays separate</p>
          <p className="mt-1 text-xs leading-5 text-white/50">
            This console does not route customer funds to an administrator's personal bank account. No API connection is marked successful until the provider's signed settlement evidence is independently reconciled.
          </p>
        </div>
      </section>

      {error && <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</p>}
      {loading && <p className="text-[11px] text-white/35">Reading the current server-side rail status…</p>}
      {!loading && !error && readiness && (
        <p className="text-[11px] text-white/35">
          Live status read from VaultBank API · {readiness.nativeOnly ? 'Production native-only policy is active.' : 'Development/provider mode is active.'}
        </p>
      )}
    </div>
  );
}
