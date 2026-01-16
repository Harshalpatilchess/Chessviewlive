// Minimal, SSR-safe header for live board view
export default function LiveHeader({ title }: { title: string }) {
  return (
    <header role="banner" className="container mx-auto px-4 py-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur flex items-center justify-between gap-3 px-4 py-2">
        <h1 className="text-sm font-medium tracking-wide">{title}</h1>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-300 animate-pulse" />
          NOW LIVE
        </span>
      </div>
    </header>
  );
}
