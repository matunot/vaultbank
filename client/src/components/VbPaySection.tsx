import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Loader2, QrCode, Store, Copy, Check, Send, Wallet,
  CheckCircle2, AlertTriangle, Link2,
} from 'lucide-react';
import { api } from '../api';
import { refreshBus } from '../refreshBus';

interface VbPayRequest {
  id: string;
  amount: number;
  description: string | null;
  status: string;
  payer_name?: string | null;
  paid_at?: string | null;
  created_at: string;
}

interface MerchantProfile {
  exists: boolean;
  merchant?: { id: string; name: string; category: string };
  payLink?: string;
  stats?: { paidCount: number; receivedTotal: number; pendingCount: number };
}

interface ChainStatus {
  configured: boolean;
  walletAddress?: string;
  base?: { native: number; usdc: number };
  dailyLimit?: number;
  message?: string;
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VbPaySection() {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [merchantName, setMerchantName] = useState('');
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [creatingReq, setCreatingReq] = useState(false);
  const [lastRequest, setLastRequest] = useState<{ payUrl: string; qrDataUrl: string; amount: number } | null>(null);
  const [requests, setRequests] = useState<VbPayRequest[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Chain withdraw
  const [wTo, setWTo] = useState('');
  const [wAmount, setWAmount] = useState('');
  const [wToken, setWToken] = useState('usdc');
  const [wNetwork, setWNetwork] = useState('base');
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([
        api.getVbPayMerchant().catch(() => null),
        api.getChainStatus().catch(() => null),
      ]);
      if (m?.success) setMerchant(m as unknown as MerchantProfile);
      if (c?.success) setChainStatus(c as unknown as ChainStatus);
      if (m?.exists) {
        const r = await api.getVbPayRequests().catch(() => null);
        if (r?.success) setRequests((r.requests as VbPayRequest[]) || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleBecomeMerchant = async () => {
    if (!merchantName.trim()) { setMsg({ type: 'error', text: 'Enter your business or store name.' }); return; }
    setCreating(true); setMsg(null);
    try {
      const r = await api.createVbPayMerchant({ name: merchantName.trim() });
      if (r.success) { await load(); setMsg({ type: 'success', text: 'Merchant account ready — you can accept VaultBank Pay now.' }); }
      else setMsg({ type: 'error', text: r.message || 'Failed.' });
    } catch { setMsg({ type: 'error', text: 'Could not reach the server.' }); } finally { setCreating(false); }
  };

  const handleCreateRequest = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { setMsg({ type: 'error', text: 'Enter an amount for the payment link.' }); return; }
    setCreatingReq(true); setMsg(null);
    try {
      const r = await api.createVbPayRequest({ amount: amt, description: description.trim() || undefined });
      if (r.success) {
        setLastRequest({ payUrl: r.payUrl as string, qrDataUrl: r.qrDataUrl as string, amount: amt });
        setDescription('');
        const rr = await api.getVbPayRequests().catch(() => null);
        if (rr?.success) setRequests((rr.requests as VbPayRequest[]) || []);
        refreshBus.emit();
      } else setMsg({ type: 'error', text: r.message || 'Failed.' });
    } catch { setMsg({ type: 'error', text: 'Could not reach the server.' }); } finally { setCreatingReq(false); }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(wAmount);
    if (!(amt > 0)) { setMsg({ type: 'error', text: 'Enter an amount to send.' }); return; }
    if (!wTo.trim()) { setMsg({ type: 'error', text: 'Enter the destination wallet address.' }); return; }
    setWithdrawing(true); setMsg(null);
    try {
      const r = await api.chainWithdraw({ to: wTo.trim(), amount: amt, token: wToken, network: wNetwork });
      if (r.success) {
        setMsg({ type: 'success', text: r.message as string });
        setWTo(''); setWAmount('');
        refreshBus.emit();
        const c = await api.getChainStatus().catch(() => null);
        if (c?.success) setChainStatus(c as unknown as ChainStatus);
      } else setMsg({ type: 'error', text: r.message || 'Withdrawal failed — nothing was sent.' });
    } catch { setMsg({ type: 'error', text: 'Could not reach the server.' }); } finally { setWithdrawing(false); }
  };
if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pb-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <p className="text-xs tracking-widest text-white/40 font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" /> VAULTBANK PAY — OUR OWN NETWORK
        </p>
        <p className="font-display text-4xl lg:text-5xl text-white mt-2">
          Zero Middlemen<span className="text-amber-400">.</span>
        </p>
        <p className="text-sm text-white/40 mt-2">
          Payment links + QR codes settle instantly, VaultBank to VaultBank. Send crypto to any wallet on Earth. No Stripe, no PayPal — your data never leaves VaultBank.
        </p>
      </motion.div>

      {msg && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className={`mb-5 rounded-2xl px-4 py-3 text-sm font-semibold border ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          {msg.text}
        </motion.div>
      )}

      {/* ── MERCHANT ── */}
      {merchant?.exists ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-3xl p-6 mb-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display text-lg text-white flex items-center gap-2"><Store className="w-4 h-4 text-amber-300" /> {merchant.merchant!.name}</h3>
            <div className="flex gap-4 text-right">
              <div><p className="font-display text-xl text-emerald-300">{fmt(merchant.stats!.receivedTotal)}</p><p className="text-[10px] text-white/40">received</p></div>
              <div><p className="font-display text-xl text-white">{merchant.stats!.paidCount}</p><p className="text-[10px] text-white/40">payments</p></div>
            </div>
          </div>
          <p className="text-xs text-white/40 mb-4">Create a payment link — the payer scans or taps, money lands instantly.</p>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="Amount $"
              inputMode="decimal"
              className="w-32 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm outline-none focus:border-amber-400/50"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is it for? (optional)"
              maxLength={140}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-amber-400/50"
            />
            <button
              onClick={handleCreateRequest}
              disabled={creatingReq}
              className="px-5 py-3 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {creatingReq ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Create link
            </button>
          </div>
{lastRequest && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl bg-white/5 border border-amber-400/30 p-4 flex flex-col sm:flex-row items-center gap-4">
              <img src={lastRequest.qrDataUrl} alt="Payment QR" className="w-32 h-32 rounded-xl bg-white p-1" />
              <div className="flex-1 min-w-0">
                <p className="font-display text-2xl text-white">{fmt(lastRequest.amount)} <span className="text-xs text-white/40 font-sans">— scan or share this link</span></p>
                <p className="text-[11px] text-white/40 font-mono truncate mt-1">{lastRequest.payUrl}</p>
                <button onClick={() => handleCopy(lastRequest.payUrl)} className="mt-2 px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center gap-2">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied!' : 'Copy payment link'}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-3xl p-6 mb-5 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-linear-to-br from-amber-400 to-yellow-500 flex items-center justify-center mb-3">
            <Store className="w-7 h-7 text-amber-950" />
          </div>
          <h3 className="font-display text-xl text-white">Accept payments with VaultBank Pay</h3>
          <p className="text-sm text-white/40 mt-1 mb-4 max-w-md mx-auto">Become a merchant in seconds — payment links, QR codes, instant settlement. Your data stays yours.</p>
          <div className="flex max-w-md mx-auto gap-2">
            <input
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              placeholder="Your business or store name"
              maxLength={60}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-amber-400/50"
            />
            <button
              onClick={handleBecomeMerchant}
              disabled={creating}
              className="px-5 py-3 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join'}
            </button>
          </div>
        </motion.div>
      )}

      {/* ── RECENT PAYMENT REQUESTS ── */}
      {merchant?.exists && requests.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-panel rounded-3xl p-6 mb-5">
          <p className="text-[10px] tracking-widest text-white/40 font-bold mb-4 flex items-center gap-2"><Link2 className="w-3.5 h-3.5" /> PAYMENT REQUESTS</p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {requests.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                <div>
                  <p className="text-xs text-white font-semibold">{r.description || 'Payment request'}</p>
                  <p className="text-[10px] text-white/30">
                    {r.status === 'paid' ? 'Paid by ' + (r.payer_name || 'customer') : r.status} · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <p className={`text-sm font-bold font-mono ${r.status === 'paid' ? 'text-emerald-300' : r.status === 'pending' ? 'text-amber-300' : 'text-white/30'}`}>{fmt(r.amount)}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
{/* ── VAULTBANK CHAIN ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display text-lg text-white flex items-center gap-2"><Send className="w-4 h-4 text-emerald-300" /> VaultBank Chain — send to any wallet</h3>
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${chainStatus?.configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
            {chainStatus?.configured ? 'LIVE' : 'NOT CONFIGURED'}
          </span>
        </div>
        {!chainStatus?.configured ? (
          <p className="text-xs text-white/40 mt-1 mb-4 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-300" />
            {chainStatus?.message || 'Set USDC_HOT_WALLET_KEY in Render (0x + 64 hex chars) to enable chain withdrawals. Deposits work already.'}
          </p>
        ) : (
          <p className="text-xs text-white/40 mt-1 mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            Hot wallet <span className="font-mono">{chainStatus.walletAddress?.slice(0, 10)}…{chainStatus.walletAddress?.slice(-6)}</span>
            {chainStatus.base && <span className="ml-1">· {fmt(chainStatus.base.usdc)} USDC on Base · gas {chainStatus.base.native.toFixed(3)} ETH</span>}
          </p>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <input
              value={wTo}
              onChange={(e) => setWTo(e.target.value)}
              placeholder="Destination wallet 0x…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm outline-none focus:border-emerald-400/50"
            />
            <div className="flex gap-2">
              <input
                value={wAmount}
                onChange={(e) => setWAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Amount $"
                inputMode="decimal"
                className="w-32 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm outline-none focus:border-emerald-400/50"
              />
              <select value={wToken} onChange={(e) => setWToken(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none">
                <option value="usdc">USDC</option>
                <option value="usdt">USDT</option>
              </select>
              <select value={wNetwork} onChange={(e) => setWNetwork(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none">
                <option value="base">Base</option>
                <option value="polygon">Polygon</option>
              </select>
            </div>
            <button
              onClick={handleWithdraw}
              disabled={withdrawing || !chainStatus?.configured}
              className="w-full py-3 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {withdrawing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send {wToken.toUpperCase()} to wallet
            </button>
            <p className="text-[10px] text-white/30">Instant broadcast · {wNetwork === 'base' ? '~$0.01' : '~$0.05'} gas · tx hash on {wNetwork === 'base' ? 'Basescan' : 'Polygonscan'}</p>
          </div>
          <div className="rounded-2xl bg-white/3 border border-white/5 p-4 text-[11px] text-white/40 leading-relaxed">
            <p className="text-white/70 font-semibold mb-2 flex items-center gap-2"><Wallet className="w-3.5 h-3.5" /> How VaultBank Chain works</p>
            <p>1. You send USDC/USDT from your VaultBank balance to any wallet address on Earth — Base or Polygon.</p>
            <p className="mt-1.5">2. The VaultBank hot wallet signs + broadcasts directly on the public network. <span className="text-white/60">No bank, no processor, no approval — ever.</span></p>
            <p className="mt-1.5">3. You get the on-chain tx hash instantly. Verifiable forever on the public ledger.</p>
            {chainStatus?.dailyLimit && <p className="mt-1.5 text-amber-300/70">Daily limit: {fmt(chainStatus.dailyLimit)} per account — safety first.</p>}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
