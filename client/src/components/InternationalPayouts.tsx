import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import RichIcon from './RichIcon';

/**
 * Lightspark Grid international payouts.
 *
 * Everything shown here is returned by the Grid API through the VaultBank
 * backend. When the provider or customer access is disabled this component
 * renders an honest "not available" state — no sample currencies, no simulated
 * quotes and no success messages.
 */

type Currency = { code: string; name?: string; symbol?: string; decimals: number };
type Agreement = { type: string; version: string; url: string };
type Availability = {
  enabled: boolean;
  mode: string;
  customerAccessEnabled: boolean;
  supportedCurrencies: Currency[];
  agreements: Agreement[];
};
type Beneficiary = {
  id: string; currency: string; accountType: string; beneficiaryName: string;
  detailsMasked: string; status: string;
};
type Quote = {
  id: string; providerQuoteId: string; status: string; sendingCurrency: string;
  receivingCurrency: string; sendingAmountMinor: number; receivingAmountMinor: number;
  exchangeRate: string; fees: Record<string, unknown>; expiresAt: string;
};
type Payment = {
  id: string; status: string; providerTransactionId: string | null; currency: string;
  amount: number; reference: string; failureReason?: string | null;
};

const ACCOUNT_TYPES = ['USD_ACCOUNT', 'EUR_ACCOUNT', 'GBP_ACCOUNT', 'INR_ACCOUNT', 'SWIFT_ACCOUNT'] as const;
type AccountType = typeof ACCOUNT_TYPES[number];

function majorToMinor(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function money(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <section className="glass-panel rounded-3xl p-6" aria-label={title}>
      <div className="flex items-start gap-3">
        <RichIcon icon={<span className="text-xs font-bold">i</span>} variant="sapphire" size="md" />
        <div>
          <h2 className="font-display text-xl text-white">{title}</h2>
          <p className="text-sm text-white/60 mt-1 max-w-2xl">{message}</p>
        </div>
      </div>
    </section>
  );
}

function AdminPanel() {
  const [exceptions, setExceptions] = useState<Payment[]>([]);
  const [deliveries, setDeliveries] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [exceptionResult, webhookResult] = await Promise.all([
        api.gridExceptions(), api.gridWebhookDeliveries(),
      ]);
      setExceptions(Array.isArray(exceptionResult.exceptions) ? exceptionResult.exceptions : []);
      setDeliveries(Array.isArray(webhookResult.deliveries) ? webhookResult.deliveries : []);
    } catch (error: any) {
      setMessage(error?.message || 'Could not load reconciliation records.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reconcile = async (id: string) => {
    setMessage('');
    try {
      const result = await api.gridReconcilePayout(id);
      setMessage(`Reconciled ${id}: ${result.outcome || 'updated'}.`);
      await load();
    } catch (error: any) {
      setMessage(error?.message || 'Reconciliation failed.');
    }
  };

  const isAdmin = ['admin', 'super_admin'].includes(String(api.getUser()?.role || ''));
  if (!isAdmin) return null;

  return (
    <section className="glass-panel rounded-3xl p-6 space-y-4" aria-label="Grid reconciliation">
      <h2 className="font-display text-xl text-white">International payment exceptions</h2>
      {message && <p className="text-xs text-amber-200" role="status">{message}</p>}
      {exceptions.length === 0 ? (
        <p className="text-sm text-white/50">No payments are waiting for reconciliation.</p>
      ) : exceptions.map((payment) => (
        <div key={payment.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
          <div className="min-w-0">
            <p className="text-sm text-white font-semibold truncate">{payment.currency} {(Number(payment.amount) || 0).toFixed(2)}</p>
            <p className="text-[10px] text-white/40 font-mono truncate">{payment.reference}</p>
          </div>
          <button type="button" onClick={() => reconcile(payment.id)}
            className="rounded-lg border border-amber-400/30 px-3 py-2 text-xs text-amber-200 hover:bg-amber-400/10">
            Reconcile with Grid
          </button>
        </div>
      ))}
      <div className="border-t border-white/10 pt-3">
        <h3 className="text-xs text-white/50 tracking-widest mb-2">RECENT WEBHOOK DELIVERIES</h3>
        {deliveries.length === 0 && <p className="text-xs text-white/40">No deliveries recorded.</p>}
        {deliveries.map((delivery) => (
          <p key={String(delivery.provider_event_id)} className="text-[10px] font-mono text-white/50 truncate">
            {String(delivery.event_type)} · {String(delivery.status)}
          </p>
        ))}
      </div>
    </section>
  );
}

export default function InternationalPayouts() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState('');
  const [customer, setCustomer] = useState<Record<string, unknown> | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [accounts, setAccounts] = useState<Array<Record<string, unknown>>>([]);
  const [corridors, setCorridors] = useState<Array<Record<string, unknown>>>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [accountType, setAccountType] = useState<AccountType>('USD_ACCOUNT');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [iban, setIban] = useState('');
  const [sortCode, setSortCode] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [vpa, setVpa] = useState('');
  const [swiftCode, setSwiftCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [country, setCountry] = useState('');
  const [bankAccountType, setBankAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');

  const [sourceCurrency, setSourceCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [disclosureConfirmed, setDisclosureConfirmed] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const currencies = useMemo(() => availability?.supportedCurrencies || [], [availability]);

  const refresh = useCallback(async () => {
    try {
      const [availabilityResult, customerResult, beneficiaryResult, accountResult, paymentResult] = await Promise.all([
        api.gridAvailability(), api.gridCustomer(), api.gridBeneficiaries(),
        api.gridAccounts(), api.gridPayouts(),
      ]);
      setAvailability(availabilityResult as unknown as Availability);
      setCustomer(customerResult.customer || null);
      setBeneficiaries(Array.isArray(beneficiaryResult.beneficiaries) ? beneficiaryResult.beneficiaries : []);
      setAccounts(Array.isArray(accountResult.accounts) ? accountResult.accounts : []);
      setPayments(Array.isArray(paymentResult.payments) ? paymentResult.payments : []);
      const firstCurrency = availabilityResult.supportedCurrencies?.[0]?.code;
      if (firstCurrency) setSourceCurrency(firstCurrency);
    } catch (error: any) {
      setLoadError(error?.message || 'International payment status could not be loaded.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!availability?.enabled || !availability.customerAccessEnabled) return;
    api.gridCorridors(sourceCurrency).then((result) => {
      setCorridors(Array.isArray(result.corridors) ? result.corridors : []);
    }).catch(() => setCorridors([]));
  }, [availability, sourceCurrency]);

  if (loadError) return <Notice title="International payments unavailable" message={loadError} />;
  if (!availability) return <Notice title="Checking international payment availability" message="Contacting the payment provider for supported corridors." />;
  if (!availability.enabled || !availability.customerAccessEnabled) {
    return (
      <Notice
        title="International payments are not enabled"
        message="Cross-border payouts require verified Grid production access, approved consents and completed reconciliation checks. No sample currencies or simulated transfers are shown here."
      />
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setStatus('');
    try { await action(); } catch (error: any) { setStatus(error?.message || 'The request could not be completed.'); }
    finally { setBusy(false); }
  };

  const onboard = () => run(async () => {
    const consents = (availability.agreements || []).map((agreement) => ({
      type: agreement.type,
      termsVersion: agreement.version,
      acceptedAt: new Date().toISOString(),
      acceptanceMethod: 'CHECKBOX' as const,
    })).filter((consent) => accepted[consent.type] === true);
    if (!consents.length) { setStatus('Accept each agreement before continuing.'); return; }
    await api.gridCreateCustomer(consents);
    await refresh();
    setStatus('Grid customer created. Complete identity verification before sending money.');
  });

  const createBeneficiary = () => run(async () => {
    const beneficiary: Record<string, unknown> = {
      beneficiaryType: 'INDIVIDUAL',
      fullName: beneficiaryName.trim(),
    };
    if (country.trim()) beneficiary.countryOfResidence = country.trim().toUpperCase();
    const accountInfo: Record<string, unknown> = { accountType, beneficiary };
    if (accountType === 'USD_ACCOUNT') {
      accountInfo.accountNumber = accountNumber.trim();
      accountInfo.routingNumber = routingNumber.trim();
      accountInfo.bankAccountType = bankAccountType;
      if (bankName.trim()) accountInfo.bankName = bankName.trim();
    } else if (accountType === 'EUR_ACCOUNT') {
      accountInfo.iban = iban.trim();
    } else if (accountType === 'GBP_ACCOUNT') {
      accountInfo.sortCode = sortCode.trim();
      accountInfo.accountNumber = accountNumber.trim();
    } else if (accountType === 'INR_ACCOUNT') {
      if (vpa.trim()) accountInfo.vpa = vpa.trim();
      else { accountInfo.accountNumber = accountNumber.trim(); accountInfo.ifsc = ifsc.trim(); }
    } else if (accountType === 'SWIFT_ACCOUNT') {
      accountInfo.swiftCode = swiftCode.trim();
      accountInfo.bankName = bankName.trim();
      accountInfo.country = country.trim().toUpperCase();
      accountInfo.accountNumber = accountNumber.trim();
    }
    await api.gridCreateBeneficiary({ currency: sourceCurrency, accountInfo });
    await refresh();
    setStatus('Beneficiary registered with Grid. Receiver validation is required before quoting.');
  });

  const createQuote = () => run(async () => {
    const minor = majorToMinor(amount);
    if (minor === null) { setStatus('Enter a positive amount with at most two decimals.'); return; }
    if (!beneficiaries.length) { setStatus('Register a beneficiary first.'); return; }
    const result = await api.gridCreateQuote({
      beneficiaryId: beneficiaries[0].id,
      sendingCurrency: sourceCurrency,
      sendingAmountMinor: minor,
      lockedCurrencySide: 'SENDING',
    });
    setQuote(result.quote || null);
    setIdempotencyKey(crypto.randomUUID());
    setDisclosureConfirmed(false);
    setStatus('');
  });

  const execute = () => run(async () => {
    if (!quote || !disclosureConfirmed) { setStatus('Review the disclosure and confirm before sending.'); return; }
    const result = await api.gridCreatePayout(quote.id, idempotencyKey);
    setStatus(result.payment?.status === 'reconciliation_required'
      ? 'The provider outcome is unknown. Funds remain reserved and the payment requires reconciliation.'
      : `Payment submitted: ${result.payment?.status || 'processing'}. Settlement is not yet confirmed.`);
    await refresh();
  });

  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-3xl p-6" aria-label="International payouts">
        <div className="vb-enter flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="font-display text-2xl text-white">International payments</h1>
            <p className="text-xs text-white/50 mt-1">Powered by Lightspark Grid · {availability.mode} mode</p>
          </div>
          {customer ? (
            <button type="button" onClick={() => run(() => api.gridKycLink().then((result) => {
              if (result.kycLink?.kycUrl) window.open(result.kycLink.kycUrl, '_blank', 'noopener,noreferrer');
            }))}
              disabled={busy} className="rounded-xl border border-amber-400/30 px-4 py-2 text-xs text-amber-200">
              Continue identity verification
            </button>
          ) : null}
        </div>

        {status && <p className="vb-enter rounded-xl bg-amber-400/10 border border-amber-400/20 px-4 py-3 text-xs text-amber-100" role="status">{status}</p>}

        {!customer ? (
          <div className="space-y-3" aria-label="Grid agreement consent">
            <h2 className="text-sm text-white/80 font-semibold">Review and accept the provider agreements</h2>
            {availability.agreements.map((agreement) => (
              <label key={agreement.type} className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs text-white/70">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-amber-500"
                  checked={accepted[agreement.type] === true}
                  onChange={(event) => setAccepted((previous) => ({ ...previous, [agreement.type]: event.target.checked }))} />
                <span>
                  I agree to <a className="text-amber-300 underline" href={agreement.url} target="_blank" rel="noopener noreferrer">{agreement.type}</a>
                  {' '}(version {agreement.version}).
                </span>
              </label>
            ))}
            <button type="button" onClick={onboard} disabled={busy} className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-[#0a0a10]">
              Continue onboarding
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div aria-label="Supported corridors">
              <h2 className="text-sm text-white/80 font-semibold mb-2">Supported currencies (from Grid)</h2>
              <div className="flex flex-wrap gap-2">
                {currencies.map((currency) => (
                  <span key={currency.code} className="rounded-full border border-amber-400/20 px-3 py-1 text-[11px] text-amber-100">
                    {currency.code} · {currency.name || currency.code}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-white/40 mt-2">
                Corridors are priced live by Grid; {corridors.length} route(s) available from {sourceCurrency}.
                {' '}{accounts.length} funded Grid internal account(s) linked to this customer.
              </p>
            </div>

            <div aria-label="Beneficiary registration" className="border-t border-white/10 pt-5 space-y-3">
              <h2 className="text-sm text-white/80 font-semibold">Register a beneficiary</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs text-white/60">Account type
                  <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}
                    className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white">
                    {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{type.replace('_ACCOUNT', '')}</option>)}
                  </select>
                </label>
                <label className="text-xs text-white/60">Beneficiary full name
                  <input value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                </label>
                {(accountType === 'USD_ACCOUNT' || accountType === 'GBP_ACCOUNT' || accountType === 'INR_ACCOUNT' || accountType === 'SWIFT_ACCOUNT') && (
                  <label className="text-xs text-white/60">Account number
                    <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)}
                      className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                  </label>
                )}
                {accountType === 'USD_ACCOUNT' && (
                  <>
                    <label className="text-xs text-white/60">Routing number
                      <input value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)}
                        className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                    </label>
                    <label className="text-xs text-white/60">Account kind
                      <select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value as 'CHECKING' | 'SAVINGS')}
                        className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white">
                        <option value="CHECKING">Checking</option>
                        <option value="SAVINGS">Savings</option>
                      </select>
                    </label>
                  </>
                )}
                {accountType === 'EUR_ACCOUNT' && (
                  <label className="text-xs text-white/60">IBAN
                    <input value={iban} onChange={(e) => setIban(e.target.value)}
                      className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                  </label>
                )}
                {accountType === 'GBP_ACCOUNT' && (
                  <label className="text-xs text-white/60">Sort code
                    <input value={sortCode} onChange={(e) => setSortCode(e.target.value)}
                      className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                  </label>
                )}
                {accountType === 'INR_ACCOUNT' && (
                  <>
                    <label className="text-xs text-white/60">UPI VPA (optional)
                      <input value={vpa} onChange={(e) => setVpa(e.target.value)}
                        className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                    </label>
                    <label className="text-xs text-white/60">IFSC
                      <input value={ifsc} onChange={(e) => setIfsc(e.target.value)}
                        className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                    </label>
                  </>
                )}
                {accountType === 'SWIFT_ACCOUNT' && (
                  <>
                    <label className="text-xs text-white/60">SWIFT/BIC
                      <input value={swiftCode} onChange={(e) => setSwiftCode(e.target.value)}
                        className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                    </label>
                    <label className="text-xs text-white/60">Bank name
                      <input value={bankName} onChange={(e) => setBankName(e.target.value)}
                        className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                    </label>
                  </>
                )}
                <label className="text-xs text-white/60">Country of residence
                  <input value={country} maxLength={2} onChange={(e) => setCountry(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                </label>
              </div>
              <button type="button" onClick={createBeneficiary} disabled={busy}
                className="rounded-xl border border-amber-400/30 px-4 py-2 text-xs text-amber-200">
                Register beneficiary
              </button>
              {beneficiaries.length > 0 && (
                <ul className="space-y-1">
                  {beneficiaries.map((beneficiary) => (
                    <li key={beneficiary.id} className="text-xs text-white/60 rounded-lg bg-white/5 px-3 py-2">
                      {beneficiary.beneficiaryName} · {beneficiary.currency} · {beneficiary.detailsMasked} · {beneficiary.status}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div aria-label="Quote and send" className="border-t border-white/10 pt-5 space-y-3">
              <h2 className="text-sm text-white/80 font-semibold">Price and send a payment</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs text-white/60">Send from currency
                  <select value={sourceCurrency} onChange={(e) => setSourceCurrency(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white">
                    {currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
                  </select>
                </label>
                <label className="text-xs text-white/60">Amount ({sourceCurrency})
                  <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00" className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white" />
                </label>
              </div>
              <button type="button" onClick={createQuote} disabled={busy}
                className="rounded-xl border border-amber-400/30 px-4 py-2 text-xs text-amber-200">
                Get exact quote
              </button>

              {quote && (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 space-y-2" aria-live="polite">
                  <p className="text-xs text-white/60">Provider quote · expires {new Date(quote.expiresAt).toLocaleString()}</p>
                  <p className="text-lg font-bold text-white">
                    {money(quote.sendingAmountMinor, quote.sendingCurrency)} → {money(quote.receivingAmountMinor, quote.receivingCurrency)}
                  </p>
                  <p className="text-xs text-white/60">Exchange rate: {quote.exchangeRate} · Fees: {JSON.stringify(quote.fees)}</p>
                  <label className="flex items-start gap-3 text-xs text-white/70">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 accent-amber-500"
                      checked={disclosureConfirmed}
                      onChange={(e) => setDisclosureConfirmed(e.target.checked)} />
                    <span>I have reviewed the exchange rate, total fees and amount the recipient will receive before sending this international remittance.</span>
                  </label>
                  <button type="button" onClick={execute} disabled={busy || !disclosureConfirmed}
                    className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-[#0a0a10] disabled:opacity-40">
                    Execute transfer
                  </button>
                </div>
              )}
            </div>

            <div aria-label="Payment status" className="border-t border-white/10 pt-5">
              <h2 className="text-sm text-white/80 font-semibold mb-2">Payment status</h2>
              {payments.length === 0 && <p className="text-xs text-white/40">No Grid payments yet.</p>}
              {payments.map((payment) => (
                <div key={payment.id} className="flex justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-xs">
                  <span className="text-white/60 truncate">{payment.currency} {(Number(payment.amount) || 0).toFixed(2)}</span>
                  <span className="text-amber-200">{payment.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <AdminPanel />
    </div>
  );
}
