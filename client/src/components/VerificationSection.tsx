import { PauseCircle, ShieldCheck } from 'lucide-react';

export default function VerificationSection() {
  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-3xl border border-amber-400/20 p-6 sm:p-8">
        <div className="flex items-center gap-3 text-amber-200">
          <PauseCircle className="h-6 w-6" />
          <span className="text-[10px] font-bold uppercase tracking-[0.28em]">INTERNAL TESTING MODE</span>
        </div>
        <h2 className="mt-4 font-display text-2xl text-white sm:text-3xl">Verification is paused</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55">
          Email verification and KYC document collection are paused while VaultBank focuses on its core account,
          balance, and demo-funding experience. You do not need to upload identity documents for internal UI testing.
        </p>
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/50" />
          <p className="text-xs leading-relaxed text-white/45">
            This pause does not enable real-money deposits or withdrawals. Real-money rails remain disabled until
            they are properly configured and tested. Demo funds, when available, must be clearly labelled and
            must never represent withdrawable money.
          </p>
        </div>
      </section>
    </div>
  );
}
