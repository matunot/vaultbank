import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
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

export default function CardProgramSection() {
  const [cardType, setCardType] = useState<CardType>('debit');
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
    <section className="bank-cards" aria-labelledby="cards-page-title">
      <header className="bank-page-intro">
        <div>
          <p className="bank-eyebrow">Card services</p>
          <h1 id="cards-page-title" className="bank-page-title">Cards</h1>
          <p className="bank-page-subtitle">
            Choose the card programme you want to request and track its review status in one place.
          </p>
        </div>
        <div className="bank-cards__header-mark" aria-hidden="true"><CreditCard size={25} /></div>
      </header>

      <div className="bank-cards__notice">
        <ShieldCheck size={18} />
        <p>Requests are tracked here. A submitted request does not mean a card has been approved, issued or activated.</p>
      </div>

      <form onSubmit={(event) => void submit(event)} className="bank-cards__form">
        <div className="bank-cards__form-heading">
          <div>
            <p className="bank-label">Choose your card type</p>
            <h2>What do you need?</h2>
            <p>Select the way you intend to use the card. This does not open or approve a credit facility.</p>
          </div>
          <span className="bank-cards__step">01 <span>/</span> 02</span>
        </div>

        <div className="bank-cards__type-grid" role="group" aria-label="Card type">
          <button
            type="button"
            aria-pressed={cardType === 'debit'}
            onClick={() => { setCardType('debit'); attempt.current = null; }}
            className={`bank-cards__type ${cardType === 'debit' ? 'is-selected' : ''}`}
          >
            <span className="bank-cards__type-icon"><Wallet size={20} /></span>
            <span className="bank-cards__type-copy">
              <strong>Debit card</strong>
              <span>Uses eligible funds held in your account.</span>
            </span>
            <span className="bank-cards__radio" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={cardType === 'credit'}
            onClick={() => { setCardType('credit'); attempt.current = null; }}
            className={`bank-cards__type ${cardType === 'credit' ? 'is-selected' : ''}`}
          >
            <span className="bank-cards__type-icon"><CreditCard size={20} /></span>
            <span className="bank-cards__type-copy">
              <strong>Credit card</strong>
              <span>Requires a separately approved credit facility and issuer.</span>
            </span>
            <span className="bank-cards__radio" aria-hidden="true" />
          </button>
        </div>

        <div className="bank-cards__form-bottom">
          <div className="bank-cards__currency">
            <label className="bank-label" id="card-currency-label">Account currency</label>
            <div className="bank-cards__currency-options" role="group" aria-labelledby="card-currency-label">
              {(['INR', 'USD'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={currency === code}
                  onClick={() => { setCurrency(code); attempt.current = null; }}
                  className={`bank-cards__currency-option ${currency === code ? 'is-selected' : ''}`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={busy} className="bank-cards__submit">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
            {busy ? 'Saving request…' : 'Submit card request'}
          </button>
        </div>
        <p className="bank-cards__disclosure">
          <ShieldCheck size={14} />
          No PAN, CVV or usable card credentials are created. Physical and virtual card issuance is not active in this experience.
        </p>
      </form>

      {error && <div role="alert" className="bank-cards__feedback bank-cards__feedback--error">{error}</div>}
      {message && <div role="status" className="bank-cards__feedback bank-cards__feedback--success"><CheckCircle2 size={16} />{message}</div>}

      <section className="bank-cards__requests" aria-labelledby="card-requests-title">
        <div className="bank-cards__requests-heading">
          <div>
            <p className="bank-label">Request history</p>
            <h2 id="card-requests-title">Your card requests</h2>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || busy}
            aria-label="Refresh card requests"
            className="bank-cards__refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="bank-cards__empty" aria-busy="true">Loading your requests…</div>
        ) : requests.length === 0 ? (
          <div className="bank-cards__empty">
            <span><CreditCard size={21} /></span>
            <strong>No card requests yet</strong>
            <p>When you submit a request, its review status will appear here.</p>
          </div>
        ) : (
          <div className="bank-cards__request-list">
            {requests.map((request) => (
              <article key={request.id} className="bank-cards__request">
                <span className="bank-cards__request-icon">
                  {request.cardType === 'debit' ? <Wallet size={18} /> : <CreditCard size={18} />}
                </span>
                <div className="bank-cards__request-main">
                  <strong>{request.cardType === 'debit' ? 'Debit card' : 'Credit card'} <span>· {request.currency}</span></strong>
                  <p>Request #{request.id}{request.createdAt ? ` · ${new Date(request.createdAt).toLocaleDateString()}` : ''}</p>
                  {request.reviewNote && <p className="bank-cards__review-note">{request.reviewNote}</p>}
                </div>
                <span className={`bank-cards__status ${request.status === 'closed' ? 'is-closed' : ''}`}>
                  {statusLabel[request.status] || request.status.replace(/_/g, ' ')}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
