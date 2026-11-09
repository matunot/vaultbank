import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink, IndianRupee,
  Info, Loader2, Search, Send, ShieldCheck, Smartphone,
} from 'lucide-react';
import { api } from '../api';

type Mode = 'send' | 'receive';
type Profile = {
  handle: string;
  vpa: string;
  payeeName: string;
  isListed?: boolean;
  verification?: string;
};

function validVpa(value: string): boolean {
  return /^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$/.test(value.trim());
}

function makeReference(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 28).toUpperCase()
    : `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 16).toUpperCase()}`;
  return `VB${random}`;
}

function makeUpiLink(profile: Profile, amount: string, note: string): string {
  const params = new URLSearchParams({
    pa: profile.vpa.trim(),
    pn: profile.payeeName.trim(),
    cu: 'INR',
    tr: makeReference(),
    tn: (note.trim() || 'VaultBank P2P payment').slice(0, 80),
  });
  if (amount.trim()) params.set('am', Number(amount).toFixed(2));
  return `upi://pay?${params.toString()}`;
}

function validAmount(value: string): boolean {
  return /^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 100000;
}

export default function UpiP2PSection() {
  const [mode, setMode] = useState<Mode>('send');

  // Send flow: a VaultTag is an internal directory alias; a VPA is a real UPI ID.
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [resolvedRecipient, setResolvedRecipient] = useState<Profile | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [sendMessage, setSendMessage] = useState('');

  // Receive flow: users optionally publish a VaultTag that points to their own VPA.
  const [ownHandle, setOwnHandle] = useState('');
  const [ownVpa, setOwnVpa] = useState('');
  const [ownName, setOwnName] = useState('');
  const [isListed, setIsListed] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setProfileLoading(true);
    api.getUpiP2PProfile()
      .then((result) => {
        if (!active) return;
        if (result?.profile) {
          const saved = result.profile as Profile;
          setProfile(saved);
          setOwnHandle(saved.handle || '');
          setOwnVpa(saved.vpa || '');
          setOwnName(saved.payeeName || '');
          setIsListed(saved.isListed !== false);
        }
      })
      .catch((error: any) => {
        if (active) setProfileError(error?.message || 'VaultTag profile service is not available yet.');
      })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, []);

  const receiveProfile = useMemo<Profile | null>(() => {
    if (!validVpa(ownVpa) || ownName.trim().length < 2) return null;
    return {
      handle: ownHandle.trim().replace(/^@/, '').toLowerCase(),
      vpa: ownVpa.trim(),
      payeeName: ownName.trim(),
      isListed,
    };
  }, [ownHandle, ownVpa, ownName, isListed]);

  const receiveLink = useMemo(
    () => receiveProfile && (!receiveAmount.trim() || validAmount(receiveAmount))
      ? makeUpiLink(receiveProfile, receiveAmount, receiveNote)
      : '',
    [receiveProfile, receiveAmount, receiveNote],
  );

  async function resolveRecipient() {
    setResolveError('');
    setSendMessage('');
    setResolvedRecipient(null);
    const value = recipientInput.trim();
    if (!value) {
      setResolveError('Enter a VaultTag or a real UPI ID.');
      return;
    }

    if (validVpa(value)) {
      if (recipientName.trim().length < 2) {
        setResolveError('Enter the payee name as supplied by the recipient. Confirm the actual bank-validated name in your UPI app.');
        return;
      }
      setResolvedRecipient({
        handle: '',
        vpa: value,
        payeeName: recipientName.trim(),
        verification: 'recipient-supplied-not-bank-verified',
      });
      return;
    }

    const handle = value.replace(/^@/, '').toLowerCase();
    setResolving(true);
    try {
      const result = await api.resolveVaultTag(handle);
      if (!result?.success || !result?.profile) {
        throw new Error(result?.message || 'VaultTag was not found.');
      }
      setResolvedRecipient(result.profile as Profile);
      setRecipientName(String(result.profile.payeeName || ''));
      setSendMessage('VaultTag resolved. The VPA and name are user-submitted; confirm the bank-validated beneficiary name in your UPI app.');
    } catch (error: any) {
      setResolveError(error?.message || 'Could not resolve that VaultTag.');
    } finally {
      setResolving(false);
    }
  }

  async function saveProfile() {
    setProfileError('');
    setProfileMessage('');
    const handle = ownHandle.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(handle)) {
      setProfileError('VaultTag must be 3-24 characters: lowercase letters, numbers, dot, underscore or hyphen.');
      return;
    }
    if (!validVpa(ownVpa)) {
      setProfileError('Enter your real UPI ID, for example name@bank.');
      return;
    }
    if (ownName.trim().length < 2 || ownName.trim().length > 70) {
      setProfileError('Enter your bank-linked payee name (2-70 characters).');
      return;
    }

    setProfileSaving(true);
    try {
      const result = await api.saveUpiP2PProfile({
        handle,
        vpa: ownVpa.trim(),
        payeeName: ownName.trim(),
        isListed,
      });
      if (!result?.success || !result?.profile) throw new Error(result?.message || 'Could not save VaultTag.');
      setProfile(result.profile as Profile);
      setOwnHandle(result.profile.handle);
      setProfileMessage(isListed
        ? `Saved. Other signed-in VaultBank users can find you as @${result.profile.handle}.`
        : 'Saved privately. Your VaultTag is not discoverable by other users.');
    } catch (error: any) {
      setProfileError(error?.message || 'Could not save your VaultTag profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setProfileMessage(message);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setProfileMessage('Clipboard access was blocked. Select and copy the text manually.');
    }
  }

  async function shareReceive() {
    const text = [
      profile?.isListed !== false && profile?.handle ? `Find my VaultTag in VaultBank: @${profile.handle}` : '',
      `My UPI ID: ${ownVpa.trim()}`,
      `Payee name: ${ownName.trim()}`,
      receiveAmount.trim() ? `Amount: INR ${Number(receiveAmount).toFixed(2)}` : '',
      receiveNote.trim() ? `Note: ${receiveNote.trim()}` : '',
    ].filter(Boolean).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'My VaultBank UPI details', text });
      else await copyText(text, 'UPI details copied.');
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) await copyText(text, 'UPI details copied.');
    }
  }

  const paymentLink = resolvedRecipient && validAmount(sendAmount)
    ? makeUpiLink(resolvedRecipient, sendAmount, sendNote)
    : '';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-[10px] tracking-[0.25em] text-amber-300/60 font-semibold">DIRECT BANK-TO-BANK · INDIA</p>
        <h1 className="mt-2 font-display text-3xl text-white">UPI P2P + VaultTag</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
          Find a VaultBank user by a short VaultTag, resolve it to their real UPI ID, then open the payer's own UPI app. Or share your own UPI details.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5">
        <button type="button" onClick={() => setMode('send')} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${mode === 'send' ? 'bg-amber-400 text-slate-950' : 'text-white/60 hover:bg-white/5'}`}>
          <ArrowUpRight className="h-4 w-4" /> Send money
        </button>
        <button type="button" onClick={() => setMode('receive')} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${mode === 'receive' ? 'bg-amber-400 text-slate-950' : 'text-white/60 hover:bg-white/5'}`}>
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
              <p className="text-xs text-white/45">Use a VaultTag (e.g. @rahul) or a real UPI ID</p>
            </div>
          </div>

          <div>
            <label htmlFor="p2p-recipient" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">VAULTTAG OR UPI ID</label>
            <input
              id="p2p-recipient"
              autoComplete="off"
              value={recipientInput}
              onChange={(event) => { setRecipientInput(event.target.value); setResolvedRecipient(null); setResolveError(''); setSendMessage(''); }}
              placeholder="@rahul or rahul123@okicici"
              className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-base text-white outline-none transition-colors focus:border-amber-400/50"
            />
          </div>

          {!recipientInput.includes('@') && (
            <p className="text-[11px] text-white/40">VaultTag is a VaultBank-only directory name, not a UPI ID or a bank-issued handle.</p>
          )}

          {recipientInput.includes('@') && !validVpa(recipientInput.trim()) && (
            <div>
              <label htmlFor="p2p-recipient-name" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">PAYEE NAME (AS SHARED BY RECIPIENT)</label>
              <input id="p2p-recipient-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Name shown by their bank" className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-amber-400/50" />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="p2p-send-amount" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">AMOUNT (INR)</label>
              <div className="relative">
                <IndianRupee className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-300" />
                <input id="p2p-send-amount" inputMode="decimal" type="number" min="1" max="100000" step="0.01" value={sendAmount} onChange={(event) => setSendAmount(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-white/10 bg-white/5 p-4 pl-11 text-xl text-white outline-none focus:border-amber-400/50" />
              </div>
              {sendAmount && !validAmount(sendAmount) && <p className="mt-2 text-xs text-rose-300">Enter an amount from ₹1 to ₹1,00,000 with up to two decimals.</p>}
            </div>
            <div>
              <label htmlFor="p2p-send-note" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">NOTE (OPTIONAL)</label>
              <input id="p2p-send-note" value={sendNote} onChange={(event) => setSendNote(event.target.value)} maxLength={80} placeholder="For dinner, rent..." className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-amber-400/50" />
            </div>
          </div>

          {resolvedRecipient ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><Check className="h-4 w-4" /> Recipient route resolved</div>
              <p className="text-sm text-white">{resolvedRecipient.payeeName}</p>
              <p className="text-xs text-white/50">{resolvedRecipient.vpa}</p>
              {resolvedRecipient.handle && <p className="text-[11px] text-white/40">VaultTag: @{resolvedRecipient.handle}</p>}
              <p className="text-[11px] text-amber-200/80">User-submitted details — beneficiary name is not bank-verified by VaultBank.</p>
            </div>
          ) : null}

          {resolveError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">{resolveError}</p>}
          {sendMessage && <p role="status" className="rounded-xl border border-amber-400/15 bg-amber-500/5 p-3 text-xs text-amber-100/80">{sendMessage}</p>}

          {!resolvedRecipient ? (
            <button type="button" onClick={() => void resolveRecipient()} disabled={resolving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-4 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-300 disabled:opacity-50">
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {resolving ? 'Resolving recipient…' : 'Resolve recipient'}
            </button>
          ) : (
            <>
              <a href={paymentLink || undefined} onClick={(event) => { if (!paymentLink) event.preventDefault(); }} className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm font-bold transition-colors ${paymentLink ? 'bg-amber-400 text-slate-950 hover:bg-amber-300' : 'pointer-events-none bg-white/10 text-white/30'}`}>
                <Smartphone className="h-4 w-4" /> Open UPI app <ExternalLink className="h-4 w-4" />
              </a>
              <button type="button" onClick={() => { setResolvedRecipient(null); setSendMessage(''); }} className="w-full rounded-xl border border-white/10 px-4 py-3 text-xs font-semibold text-white/60 hover:bg-white/5">Change recipient</button>
            </>
          )}

          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
              <p className="text-xs leading-5 text-white/65">
                Always verify the beneficiary name shown by your UPI app before entering your UPI PIN. The payee name stored in VaultBank is user-submitted. Do not pay if the bank-validated name does not match.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="glass-panel rounded-3xl border border-white/10 p-5 sm:p-7 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
              <ArrowDownLeft className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Your UPI receiving details</h2>
              <p className="text-xs text-white/45">Payments go directly to the bank account linked to your UPI ID</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="p2p-own-handle" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">CHOOSE YOUR VAULTTAG</label>
              <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-4">
                <span className="text-sm text-emerald-300">@</span>
                <input id="p2p-own-handle" value={ownHandle} onChange={(event) => setOwnHandle(event.target.value.toLowerCase())} maxLength={24} placeholder="yourname" className="w-full bg-transparent p-4 text-sm text-white outline-none" />
              </div>
              <p className="mt-1 text-[11px] text-white/40">This is only an internal VaultBank alias, not a UPI ID. Others can search it inside VaultBank.</p>
            </div>

            <div>
              <label htmlFor="p2p-own-vpa" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">YOUR REAL UPI ID</label>
              <input id="p2p-own-vpa" autoComplete="off" value={ownVpa} onChange={(event) => setOwnVpa(event.target.value)} placeholder="yourname@bank" className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-base text-white outline-none focus:border-emerald-400/50" />
            </div>

            <div>
              <label htmlFor="p2p-own-name" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">PAYEE NAME</label>
              <input id="p2p-own-name" value={ownName} onChange={(event) => setOwnName(event.target.value)} maxLength={70} placeholder="Name shown by your bank/UPI app" className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-emerald-400/50" />
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/65">
              <input type="checkbox" checked={isListed} onChange={(event) => setIsListed(event.target.checked)} className="mt-0.5 accent-emerald-400" />
              <span>Make my VaultTag searchable by signed-in VaultBank users</span>
            </label>

            <button type="button" onClick={() => void saveProfile()} disabled={profileSaving || profileLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">
              {profileSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {profileSaving ? 'Saving…' : profile ? 'Update VaultTag' : 'Save VaultTag'}
            </button>
            {profile && <p className="text-[11px] text-white/40">Current VaultTag: <span className="font-semibold text-emerald-200">@{profile.handle}</span> · {profile.isListed ? 'Listed' : 'Private'}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="p2p-receive-amount" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">REQUESTED AMOUNT (OPTIONAL)</label>
              <div className="relative">
                <IndianRupee className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-300" />
                <input id="p2p-receive-amount" type="number" inputMode="decimal" min="1" max="100000" step="0.01" value={receiveAmount} onChange={(event) => setReceiveAmount(event.target.value)} placeholder="Any amount" className="w-full rounded-xl border border-white/10 bg-white/5 p-4 pl-11 text-xl text-white outline-none focus:border-emerald-400/50" />
              </div>
            </div>
            <div>
              <label htmlFor="p2p-receive-note" className="mb-2 block text-[10px] font-semibold tracking-wider text-white/45">NOTE (OPTIONAL)</label>
              <input id="p2p-receive-note" value={receiveNote} onChange={(event) => setReceiveNote(event.target.value)} maxLength={80} placeholder="What is it for?" className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none focus:border-emerald-400/50" />
            </div>
          </div>
          {receiveAmount.trim() && !validAmount(receiveAmount) && <p className="text-xs text-rose-300">Enter an amount from ₹1 to ₹1,00,000.</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!receiveLink} onClick={() => void copyText(receiveLink, 'UPI payment link copied. Share it with the payer.')} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3.5 text-sm font-semibold text-white/75 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy UPI link
            </button>
            <button type="button" disabled={!receiveProfile} onClick={() => void shareReceive()} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">
              <ExternalLink className="h-4 w-4" /> Share details
            </button>
          </div>

          {profileLoading && <p className="text-xs text-white/40">Loading your saved VaultTag…</p>}
          {profileError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">{profileError}</p>}
          {profileMessage && <p role="status" className="rounded-xl border border-emerald-400/15 bg-emerald-500/5 p-3 text-xs text-emerald-100/80">{profileMessage}</p>}
        </section>
      )}

      <div className="rounded-2xl border border-sky-400/15 bg-sky-500/5 p-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-200" />
          <div>
            <p className="text-sm font-semibold text-white">What VaultTag does — and does not do</p>
            <p className="mt-1 text-xs leading-5 text-white/55">
              VaultTag is a VaultBank directory alias that resolves to a real UPI VPA entered by the recipient. It is not a bank-issued UPI handle, does not prove VPA ownership, and does not create a VaultBank wallet. The payer approves the transfer in their UPI app. VaultBank receives no trusted bank/PSP settlement callback from this basic intent flow, so opening or returning from an app, an SMS, a screenshot or a user-entered UTR must never be shown as payment success. Check the bank/UPI app transaction history.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
