import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CheckCircle2, CreditCard, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type CardType = 'debit' | 'credit';
type Currency = 'INR' | 'USD';

interface CardRequest {
  id: string;
  cardType: CardType;
  currency: Currency;
  status: string;
  reviewNote?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

function makeKey(): string {
  try { return crypto.randomUUID(); }
  catch { return `vb-card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

const statusLabel: Record<string, string> = {
  needs_verification: 'Verification needed',
  received: 'Received',
  under_review: 'Under review',
  waiting_for_issuer: 'Waiting for issuer connection',
  closed: 'Closed',
};

export default function CardProgramSection({ defaultCardType = 'debit' }: { defaultCardType?: CardType }) {
  const [cardType, setCardType] = useState<CardType>(defaultCardType);
  const [currency, setCurrency] = useState<Currency>('INR');
  const [requests, setRequests] = useState<CardRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const result = await api.getCardProgramRequests();
      if (!result.success || !Array.isArray(result.requests)) {
        throw new Error(result.message || 'Could not load card requests.');
      }
      setRequests(result.requests as CardRequest[]);
    } catch (e: any) {
      setError(e?.message || 'Could not load card requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fingerprint = `${cardType}|${currency}`;
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: makeKey() };
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.requestCardProgram({ cardType, currency }, attempt.current.key);
      if (!result.success || !result.request) throw new Error(result.message || 'Card request could not be saved.');
      attempt.current = null;
      setMessage(result.message || 'Your request was saved.');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Card request could not be saved. Retry with the same selection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <p className="text-[10px] font-bold tracking-[0.28em] text-sky-300/70">VAULTBANK · CARD PROGRAM</p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-white">Debit &amp; Credit Cards</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
          Submit a tracked request for a VaultBank debit or credit card. Your request and review status are saved to VaultBank's database.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <CreditCard className="text-sky-200" size={19} />
          <h3 className="mt-3 text-sm font-semibold text-white">Debit card request</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">Intended to spend verified available funds from an eligible VaultBank account.</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <CreditCard className="text-amber-200" size={19} />
          <h3 className="mt-3 text-sm font-semibold text-white">Credit card request</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">Requires a funded credit facility and issuer program; submitting a request does not create credit.</p>
        </div>
        <div className="glass-panel rounded-2xl border border-amber-400/15 p-4">
          <ShieldCheck className="text-amber-200" size={19} />
          <h3 className="mt-3 text-sm font-semibold text-white">Honest status</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">No PAN, CVV, card number, or fake issued-card record is created here.</p>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      <form onSubmit={(event) => void submit(event)} className="glass-panel rounded-3xl border border-white/10 p-5 md:p-7">
        <h3 className="font-display text-xl text-white">Request a card</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="card-program-type" className="mb-2 block text-xs font-semibold text-white/60">Card type</label>
            <select id="card-program-type" value={cardType} onChange={(event) => { setCardType(event.target.value as CardType); attempt.current = null; }} className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-3 text-sm text-white">
              <option value="debit">Debit card</option>
              <option value="credit">Credit card</option>
            </select>
          </div>
          <div>
            <label htmlFor="card-program-currency" className="mb-2 block text-xs font-semibold text-white/60">Account currency</label>
            <select id="card-program-currency" value={currency} onChange={(event) => { setCurrency(event.target.value as Currency); attempt.current = null; }} className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-3 text-sm text-white">
              <option value="INR">INR · Indian rupee</option>
              <option value="USD">USD · US dollar</option>
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-300 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {busy ? 'Saving request…' : 'Submit card request'}
            </button>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-white/35">
          Important: external card-network issuing is not active in production. This action records your request; it does not issue a physical or virtual card and cannot yet be used at outside merchants.
        </p>
      </form>

      <div className="glass-panel rounded-2xl border border-white/10 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl text-white">Your requests</h3>
          <button type="button" onClick={() => void refresh()} disabled={loading || busy} aria-label="Refresh card requests" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-white/45"><Loader2 size={15} className="animate-spin" />Loading requests…</p>
        ) : requests.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">No card-program requests yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {requests.map((request) => (
              <div key={request.id} className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold capitalize text-white">{request.cardType} card · {request.currency}</p>
                  <p className="mt-1 text-[11px] text-white/35">Request #{request.id}{request.createdAt ? ` · ${new Date(request.createdAt).toLocaleDateString()}` : ''}</p>
                  {request.reviewNote && <p className="mt-2 text-xs text-white/50">{request.reviewNote}</p>}
                </div>
                <span className="w-fit rounded-full border border-amber-400/20 bg-amber-400/5 px-3 py-1.5 text-[10px] font-bold text-amber-100">{statusLabel[request.status] || request.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
