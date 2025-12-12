export default function ReplayLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-4 lg:px-8">
        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[620px] flex-1 flex-col gap-2 rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl ring-1 ring-white/5 lg:flex-[0.9]">
            <div className="h-10 rounded-xl bg-slate-800/60" />
            <div className="flex-1 rounded-2xl border border-slate-800/70 bg-slate-900/60" />
          </div>
          <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden lg:flex-[1.1]">
            <div className="aspect-video w-full rounded-2xl border border-white/10 bg-slate-900/70 shadow-sm" />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-sm">
              <div className="h-10 bg-slate-900/60" />
              <div className="flex-1 bg-slate-950/60" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
