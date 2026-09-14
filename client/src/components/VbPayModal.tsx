import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Loader2, CheckCircle2, AlertTriangle, QrCode } from 'lucide-react';
import { api } from '../api';
import { refreshBus } from '../refreshBus';

interface PublicRequest {
  id: string;
  amount: number;
  description: string | null;
  status: string;
  merchant_name: string;
  merchant_category: string;
  expires_at: string;
}

export default function VbPayModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getVbPayRequestPublic(requestId);
      if (r.success) setReq(r.request as PublicRequest);
      else setError(r.message || 'Payment request not found.');
    } catch {
      setError('Could not load this payment request.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const handlePay = async () => {
    setPaying(true);
    setError(null);
    try {
      const r = await api.payVbPayRequest(requestId);
      if (r.success) {
        setDone(true);
        refreshBus.emit();
        setTimeout(onClose, 2500);
      } else {
        setError(r.message || 'Payment failed.');
        await load();
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPaying(false);
    }
  };

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }} className="glass-panel rounded-3xl p-6 w-full max-w-md">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] tracking-widest text-white/40 font-bold flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> VAULTBANK PAY
            </p>
            <button onClick={onClose} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
          </div>

          {loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-white/30" /></div>
          ) : done ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-300 mx-auto mb-3" />
              <h3 className="font-display text-xl text-white">Payment sent</h3>
              <p className="text-sm text-white/40 mt-1">Settled instantly on the VaultBank network.</p>
            </div>
          ) : error && !req ? (
            <div className="py-8 text-center">
              <AlertTriangle className="w-12 h-12 text-rose-300 mx-auto mb-3" />
              <h3 className="font-display text-lg text-white">{error}</h3>
            </div>
          ) : req && (
            <>
              <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center mb-5">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-linear-to-br from-amber-400 to-yellow-500 flex items-center justify-center mb-3">
                  <QrCode className="w-6 h-6 text-amber-950" />
                </div>
                <p className="text-[11px] tracking-widest text-white/40 font-bold">{req.merchant_name.toUpperCase()}</p>
                <p className="font-display text-4xl text-white mt-2">{fmt(req.amount)}</p>
                {req.description && <p className="text-sm text-white/50 mt-1">{req.description}</p>}
                <p className={`text-[11px] mt-3 font-bold ${req.status === 'pending' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {req.status === 'pending' ? 'READY TO PAY' : req.status.toUpperCase()}
                </p>
              </div>

              {error && <p className="text-xs text-rose-300 mb-3 text-center">{error}</p>}

              <button
                onClick={handlePay}
                disabled={paying || req.status !== 'pending'}
                className="w-full py-3.5 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {paying ? 'Paying…' : `Pay ${fmt(req.amount)} from VaultBank`}
              </button>
              <p className="text-[10px] text-white/30 text-center mt-3">100% VaultBank — settles in under a second, no third party sees anything.</p>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}