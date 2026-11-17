import { Info } from 'lucide-react';

interface PreviewOnlyNoticeProps {
  title: string;
  message: string;
}

export default function PreviewOnlyNotice({ title, message }: PreviewOnlyNoticeProps) {
  return (
    <section role="status" aria-live="polite" className="bank-surface flex gap-3 p-5 sm:p-6">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-300/10 bg-white/5 text-slate-400">
        <Info size={17} />
      </span>
      <div className="min-w-0">
        <p className="bank-label">Not available yet</p>
        <h3 className="mt-1 text-sm font-semibold text-slate-100">{title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{message}</p>
      </div>
    </section>
  );
}
