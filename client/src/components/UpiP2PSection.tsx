import { useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink,
  IndianRupee, Info, Send, ShieldCheck, Smartphone,
} from 'lucide-react';

type Mode = 'send' | 'receive';

function validVpa(value: string): boolean {
  return /^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(value.trim());
}

function makeUpiLink(vpa: string, payeeName: string, amount: string, note: string): string {
  const params = new URLSearchParams({
    pa: vpa.trim(),
    pn: payeeName.trim(),
    cu: 'INR',
  });
  if (amount.trim()) params.set('am', Number(amount).toFixed(2));
  if (note.trim()) params.set('tn', note.trim().slice(0, 80));
  return `upi://pay?${params.toString()}`;
}

export default function UpiP2PSection() {
  const [mode, setMode] = useState<Mode>('send');
  const [recipientVpa, setRecipientVpa] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [ownVpa, setOwnVpa] = useState('');
  const [ownName, setOwnName] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  const amountNumber = Number(sendAmount);
  const sendValid = validVpa(recipientVpa) && recipientName.trim().length >= 2 && Number.isFinite(amountNumber) && amountNumber >= 1;
  const ownVpaValid = validVpa(ownVpa) && ownName.trim().length >= 2;
  const receiveAmountValid = !receiveAmount.trim() || (Number.isFinite(Number(receiveAmount)) && Number(receiveAmount) >= 1);
  const sendLink = useMemo(
    () => sendValid ? makeUpiLink(recipientVpa, recipientName, sendAmount, sendNote) : '',
    [recipientVpa, recipientName, sendAmount, sendNote, sendValid],
  );
  const receiveLink = useMemo(
    () => ownVpaValid && receiveAmountValid ? makeUpiLink(ownVpa, ownName, receiveAmount, receiveNote) : '',
    [ownVpa, ownName, receiveAmount, receiveNote, ownVpaValid, receiveAmountValid],
  );

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setMessage('Copied. Share it with the other person.');
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setMessage('Copy was blocked by this browser. Select and copy the link manually.');
    }
  }

  async function shareReceiveLink() {
    if (!receiveLink) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Pay me by UPI', text: 'Send money directly to my bank account using UPI.', url: receiveLink });
      } else {
        await copyText(receiveLink);
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        await copyText(receiveLink);
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-[10px] tracking-[0.25em] text-amber-300/60 font-semibold">DIRECT BANK-TO-BANK · INDIA</p>
        <h1 className="mt-2 font-display text-3xl text-white">UPI P2P</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
          Send to another person's UPI ID or share your own. The payment is authorised inside the sender's UPI app and moves directly between bank accounts.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5">
        <button
          type="button"
          onClick={() => { setMode('send'); setMessage(''); }}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${mode === 'send' ? 'bg-amber-400 text-slate-950' : 'text-white/60 hover:bg-white/5'}`}
        >
          <ArrowUpRight className="h-4 w-4" /> Send money
        </button>
        <button
          type="button"
          onClick={() => { setMode('receive'); setMessage(''); }}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${mode === 'receive' ? 'bg-amber-400 text-slate-950' : 'text-white/60 hover:bg-white/5'}`}
        >
          <ArrowDownLeft className="h-4 w-4" /> Receive money
        </button>
      </div>

      {mode === 'send' ? (
        <section className="glass-panel rounded-3xl border border-white/10 p-5 sm:p-7 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10">
              <Send className="h-5 w-5 text-amber-200" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Pay a person</h2>
              <p className="text-xs text-white/45">Use their UPI ID (VPA)</p>
            </div>
          </div>

          <div>
            <label htmlFor="p2p-recipient-vpa" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">RECIPIENT UPI ID</label>
            <input
              id="p2p-recipient-vpa"
              autoComplete="off"
              inputMode="email"
              value={recipientVpa}
              onChange={(event) => setRecipientVpa(event.target.value)}
              placeholder="name@bank"
              className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-base text-white outline-none transition-colors focus:border-amber-400/50"
            />
            {recipientVpa.trim() && !validVpa(recipientVpa) && (
              <p className="mt-2 text-xs text-rose-300">Enter a valid UPI ID, for example name@bank.</p>
            )}
          </div>

          <div>
            <label htmlFor="p2p-recipient-name" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">RECIPIENT NAME (AS THEY SHARE IT)</label>
            <input
              id="p2p-recipient-name"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Name of the person"
              className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-amber-400/50"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="p2p-send-amount" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">AMOUNT (INR)</label>
              <div className="relative">
                <IndianRupee className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-300" />
                <input
                  id="p2p-send-amount"
                  inputMode="decimal"
                  type="number"
                  min="1"
                  step="0.01"
                  value={sendAmount}
                  onChange={(event) => setSendAmount(event.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-white/10 bg-white/5 p-4 pl-11 text-xl text-white outline-none focus:border-amber-400/50"
                />
              </div>
            </div>
            <div>
              <label htmlFor="p2p-send-note" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">NOTE (OPTIONAL)</label>
              <input
                id="p2p-send-note"
                value={sendNote}
                onChange={(event) => setSendNote(event.target.value)}
                maxLength={80}
                placeholder="For dinner, rent..."
                className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/8 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
              <div className="text-xs leading-5 text-white/65">
                The name above is only a prefilled label. Before entering your UPI PIN, verify that the bank-validated beneficiary name and amount shown inside your UPI app match the person you intend to pay. Never share your UPI PIN or OTP with VaultBank or anyone else.
              </div>
            </div>
          </div>

          {sendValid ? (
            <a
              href={sendLink}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-4 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-300"
            >
              <Smartphone className="h-4 w-4" /> Open UPI app <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button type="button" disabled className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-white/10 px-5 py-4 text-sm font-bold text-white/30">
              <Smartphone className="h-4 w-4" /> Enter a valid UPI ID and amount
            </button>
          )}
          {sendValid && (
            <button type="button" onClick={() => void copyText(sendLink)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-xs font-semibold text-white/65 hover:bg-white/5">
              <Copy className="h-4 w-4" /> Copy payment link
            </button>
          )}
        </section>
      ) : (
        <section className="glass-panel rounded-3xl border border-white/10 p-5 sm:p-7 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
              <ArrowDownLeft className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Share your UPI details</h2>
              <p className="text-xs text-white/45">Money goes directly to the bank account linked to this UPI ID</p>
            </div>
          </div>

          <div>
            <label htmlFor="p2p-own-vpa" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">YOUR UPI ID</label>
            <input
              id="p2p-own-vpa"
              autoComplete="off"
              inputMode="email"
              value={ownVpa}
              onChange={(event) => setOwnVpa(event.target.value)}
              placeholder="yourname@bank"
              className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-base text-white outline-none focus:border-emerald-400/50"
            />
            {ownVpa.trim() && !ownVpaValid && (
              <p className="mt-2 text-xs text-rose-300">Enter a valid UPI ID, for example yourname@bank.</p>
            )}
          </div>

          <div>
            <label htmlFor="p2p-own-name" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">YOUR BANK ACCOUNT NAME</label>
            <input
              id="p2p-own-name"
              value={ownName}
              onChange={(event) => setOwnName(event.target.value)}
              placeholder="Your name as shown by your bank"
              className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-emerald-400/50"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="p2p-receive-amount" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">REQUESTED AMOUNT (OPTIONAL)</label>
              <div className="relative">
                <IndianRupee className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-300" />
                <input
                  id="p2p-receive-amount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={receiveAmount}
                  onChange={(event) => setReceiveAmount(event.target.value)}
                  placeholder="Any amount"
                  className="w-full rounded-xl border border-white/10 bg-white/5 p-4 pl-11 text-xl text-white outline-none focus:border-emerald-400/50"
                />
              </div>
              {!receiveAmountValid && <p className="mt-2 text-xs text-rose-300">Amount must be at least ₹1.</p>}
            </div>
            <div>
              <label htmlFor="p2p-receive-note" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">NOTE (OPTIONAL)</label>
              <input
                id="p2p-receive-note"
                value={receiveNote}
                onChange={(event) => setReceiveNote(event.target.value)}
                maxLength={80}
                placeholder="What is it for?"
                className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-emerald-400/50"
              />
            </div>
          </div>

          {receiveLink && (
            <div className="break-all rounded-xl border border-emerald-400/15 bg-emerald-500/5 p-4 text-xs text-emerald-100/75">
              {receiveLink}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!receiveLink}
              onClick={() => void copyText(receiveLink)}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy UPI link
            </button>
            <button
              type="button"
              disabled={!receiveLink}
              onClick={() => void shareReceiveLink()}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3.5 text-sm font-semibold text-white/75 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ExternalLink className="h-4 w-4" /> Share link
            </button>
          </div>
          {ownVpaValid && <p className="text-xs text-white/40">You can also share the UPI ID itself: <span className="font-semibold text-white/70">{ownVpa.trim()}</span></p>}
        </section>
      )}

      {message && <p role="status" className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">{message}</p>}

      <div className="rounded-2xl border border-sky-400/15 bg-sky-500/5 p-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-200" />
          <div>
            <p className="text-sm font-semibold text-white">What this does — and does not do</p>
            <p className="mt-1 text-xs leading-5 text-white/55">
              This opens a UPI payment intent. The payer must review the verified recipient details and approve with their UPI PIN in their bank/UPI app. VaultBank does not hold, route, debit, or credit either bank account, cannot send a formal UPI Collect request here, and does not receive automatic payment confirmation. Opening or returning from the UPI app is not proof of payment. Check the bank/UPI app transaction history.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
