interface PreviewOnlyNoticeProps {
  title: string;
  message: string;
}

export default function PreviewOnlyNotice({ title, message }: PreviewOnlyNoticeProps) {
  return (
    <section role="status" aria-live="polite" className="glass-panel rounded-3xl p-6 lg:p-7 border border-amber-500/20">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
        <span className="text-[10px] tracking-[0.2em] font-bold text-amber-300">PREVIEW ONLY</span>
      </div>
      <h3 className="font-display text-xl text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{message}</p>
    </section>
  );
}
