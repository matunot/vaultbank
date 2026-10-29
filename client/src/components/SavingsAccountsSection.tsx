import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus, RefreshCw, ShieldCheck, Wallet, X } from 'lucide-react';
import { api } from '../api';

type Currency = 'USD' | 'INR';
type Direction = 'save' | 'withdraw';

interface Account {
  id: string;
  accountNumber: string;
  accountType: string;
  accountName: string;
  balance: number;
  availableBalance: number;
  heldBalance?: number;
  currency: Currency;
  status?: string;
}

function money(value: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function makeIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `vb-savings-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export default function SavingsAccountsSection() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('save');
  const [otherAccountId, setOtherAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const moveAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const result = await api.getAccounts();
      if (!result.success || !Array.isArray(result.accounts)) {
        throw new Error(result.message || 'Could not load your VaultBank accounts.');
      }
      setAccounts(result.accounts as Account[]);
    } catch (e: any) {
      setError(e?.message || 'Could not load your VaultBank accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const currencyAccounts = useMemo(
    () => accounts.filter((account) => account.status !== 'closed' && account.currency === currency),
    [accounts, currency],
  );
  const vaults = useMemo(
    () => currencyAccounts.filter((account) => account.accountType?.toLowerCase() === 'savings'),
    [currencyAccounts],
  );
  const selectedVault = selectedVaultId ? vaults.find((account) => account.id === selectedVaultId) || null : null;
  const otherAccounts = useMemo(
    () => currencyAccounts.filter((account) => account.id !== selectedVaultId),
    [currencyAccounts, selectedVaultId],
  );

  useEffect(() => {
    if (!selectedVaultId) return;
    setOtherAccountId((current) => otherAccounts.some((account) => account.id === current)
      ? current
      : (otherAccounts[0]?.id || ''));
  }, [selectedVaultId, otherAccounts]);

  const openVault = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.openSavingsAccount({ currency });
      if (!result.success || !result.account) {
        throw new Error(result.message || 'Could not open a savings vault.');
      }
      setMessage(`${currency} savings vault opened with a zero balance. No funds or interest were added.`);
      setSelectedVaultId(result.account.id);
      setDirection('save');
      setAmount('');
      moveAttempt.current = null;
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not open a savings vault.');
    } finally {
      setBusy(false);
    }
  };

  const openMove = (vault: Account, nextDirection: Direction) => {
    setError('');
    setMessage('');
    setSelectedVaultId(vault.id);
    setDirection(nextDirection);
    setAmount('');
    moveAttempt.current = null;
  };

  const submitMove = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedVault || !otherAccountId) {
      setError(`Open another active ${currency} account before moving funds to or from this vault.`);
      return;
    }
    const fromAccountId = direction === 'save' ? otherAccountId : selectedVault.id;
    const toAccountId = direction === 'save' ? selectedVault.id : otherAccountId;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) {
      setError('Enter a positive amount with at most two decimal places.');
      return;
    }

    const fingerprint = `${fromAccountId}|${toAccountId}|${numericAmount.toFixed(2)}|${currency}`;
    if (!moveAttempt.current || moveAttempt.current.fingerprint !== fingerprint) {
      moveAttempt.current = { fingerprint, key: makeIdempotencyKey() };
    }
    const key = moveAttempt.current.key;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.moveSavings({
        fromAccountId,
        toAccountId,
        amount: numericAmount,
      }, key);
      if (!result.success) throw new Error(result.message || 'Savings move could not be confirmed.');
      moveAttempt.current = null;
      setMessage(result.message || `Moved ${money(numericAmount, currency)} successfully.`);
      setAmount('');
      await refresh();
    } catch (e: any) {
      // Keep the key for an identical retry: the server may be resolving a
      // committed transaction whose response was lost.
      setError(e?.message || 'Savings move could not be confirmed. Retry with the same details.');
    } finally {
      setBusy(false);
    }
  };

  const totalSaved = vaults.reduce((sum, vault) => sum + Number(vault.balance || 0), 0);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.28em] text-emerald-300/70">VAULTBANK · NATIVE LEDGER</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-white">Savings Vaults</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
            Keep money in separate VaultBank savings accounts and move verified available funds between your own accounts.
            Currency stays separate; no automatic FX or interest is applied.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
            {(['USD', 'INR'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setCurrency(value);
                  setSelectedVaultId(null);
                  setAmount('');
                  setError('');
                  setMessage('');
                  moveAttempt.current = null;
                }}
                className={`rounded-lg px-4 py-2 text-xs font-bold transition ${currency === value ? 'bg-emerald-400/20 text-emerald-200' : 'text-white/45 hover:text-white'}`}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || busy}
            aria-label="Refresh account balances"
            className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-white/60 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void openVault()}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-emerald-950 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Open {currency} vault
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <div className="flex items-center gap-2 text-white/45"><Wallet size={15} /><span className="text-[10px] font-bold tracking-wider">TOTAL IN VAULTS</span></div>
          <p className="mt-3 font-display text-2xl text-white">{money(totalSaved, currency)}</p>
          <p className="mt-1 text-xs text-white/35">{vaults.length} active {currency} savings account{vaults.length === 1 ? '' : 's'}</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <div className="flex items-center gap-2 text-white/45"><ShieldCheck size={15} /><span className="text-[10px] font-bold tracking-wider">FUNDING RULE</span></div>
          <p className="mt-3 text-sm font-semibold text-white">Verified funds only</p>
          <p className="mt-1 text-xs leading-relaxed text-white/35">Unverified opening balances cannot be moved into or out of a vault.</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/10 p-4">
          <div className="flex items-center gap-2 text-white/45"><Wallet size={15} /><span className="text-[10px] font-bold tracking-wider">INTEREST</span></div>
          <p className="mt-3 text-sm font-semibold text-white">Not enabled</p>
          <p className="mt-1 text-xs leading-relaxed text-white/35">No APY or interest is advertised until a funded product exists.</p>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      {loading ? (
        <div className="glass-panel flex items-center gap-3 rounded-2xl p-6 text-sm text-white/50"><Loader2 size={17} className="animate-spin" />Loading your accounts…</div>
      ) : vaults.length === 0 ? (
        <div className="glass-panel rounded-3xl border border-dashed border-white/15 p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-200"><Wallet size={24} /></div>
          <h3 className="mt-4 font-display text-xl text-white">Start your first savings vault</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-white/45">
            Open a separate zero-balance {currency} account. You can move funds into it only from another active account you own in the same currency.
          </p>
          <button type="button" onClick={() => void openVault()} disabled={busy} className="mt-5 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-emerald-950 disabled:opacity-50">
            Open {currency} savings vault
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vaults.map((vault) => (
            <article key={vault.id} className="glass-panel rounded-2xl border border-emerald-400/15 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-200"><Wallet size={20} /></div>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1 text-[10px] font-bold tracking-wider text-emerald-200">ACTIVE</span>
              </div>
              <h3 className="mt-4 font-semibold text-white">{vault.accountName || 'Savings Account'}</h3>
              <p className="mt-1 font-mono text-[11px] text-white/30">{vault.accountNumber || 'Account number unavailable'}</p>
              <p className="mt-4 font-display text-3xl text-white">{money(vault.balance, currency)}</p>
              <p className="mt-1 text-xs text-white/35">Available: {money(vault.availableBalance, currency)}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => openMove(vault, 'save')} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-400/15">
                  <ArrowDownLeft size={15} /> Add funds
                </button>
                <button type="button" onClick={() => openMove(vault, 'withdraw')} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-bold text-white/70 hover:bg-white/10">
                  <ArrowUpRight size={15} /> Move out
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedVault && (
        <section className="glass-panel rounded-2xl border border-emerald-400/20 p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.2em] text-emerald-300/70">{direction === 'save' ? 'ADD TO SAVINGS' : 'MOVE OUT OF SAVINGS'}</p>
              <h3 className="mt-2 font-display text-xl text-white">{selectedVault.accountName || 'Savings Account'}</h3>
              <p className="mt-1 text-xs text-white/40">Current balance: {money(selectedVault.balance, currency)}</p>
            </div>
            <button type="button" onClick={() => setSelectedVaultId(null)} aria-label="Close savings transfer form" className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"><X size={16} /></button>
          </div>

          {otherAccounts.length === 0 ? (
            <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100/80">
              No other active {currency} account is available to move money with. Open or receive funds into another account in this same currency first.
            </p>
          ) : (
            <form onSubmit={(event) => void submitMove(event)} className="mt-5 grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
              <div>
                <label htmlFor="savings-counter-account" className="mb-2 block text-xs font-semibold text-white/60">
                  {direction === 'save' ? 'Move from' : 'Move to'}
                </label>
                <select
                  id="savings-counter-account"
                  value={otherAccountId}
                  onChange={(event) => { setOtherAccountId(event.target.value); moveAttempt.current = null; }}
                  className="w-full rounded-xl border border-white/10 bg-[#111521] px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40"
                >
                  {otherAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountName || account.accountType} · {account.accountNumber} · {money(account.balance, currency)}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] text-white/35">
                  {direction === 'save' ? 'Funds move from this account into the vault.' : 'Funds move from the vault into this account.'}
                </p>
              </div>
              <div>
                <label htmlFor="savings-move-amount" className="mb-2 block text-xs font-semibold text-white/60">Amount ({currency})</label>
                <input
                  id="savings-move-amount"
                  inputMode="decimal"
                  type="number"
                  min="0.01"
                  max="100000"
                  step="0.01"
                  value={amount}
                  onChange={(event) => { setAmount(event.target.value); moveAttempt.current = null; }}
                  required
                  placeholder="0.00"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40"
                />
              </div>
              <button type="submit" disabled={busy || !otherAccountId || !amount} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-emerald-950 disabled:opacity-50">
                {busy ? <Loader2 size={16} className="animate-spin" /> : direction === 'save' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                {busy ? 'Processing…' : direction === 'save' ? 'Save money' : 'Move money'}
              </button>
            </form>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-white/35">
            Moves are internal, same-currency ledger transfers. They do not send money to another bank and cannot convert currencies.
            If a request times out, retry the same details so the same idempotency key can safely resolve the outcome.
          </p>
        </section>
      )}
    </section>
  );
}
