export default function ViewerShellLoading() {
  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100 overflow-x-hidden">
      <div className="mx-auto flex-1 w-full max-w-[1520px] px-3 py-1 lg:px-6 lg:py-1 flex flex-col min-h-0">
        <div className="flex flex-1 min-h-0 flex-col gap-1.5 sm:gap-2.5 overflow-hidden lg:grid lg:h-[calc(100dvh-6.5rem)] lg:max-h-[calc(100dvh-6.5rem)] lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] lg:items-stretch lg:overflow-hidden">
          <section className="mx-auto lg:mx-0 flex h-full min-h-0 w-full max-w-[680px] lg:max-w-[720px] flex-1 flex-col gap-1 rounded-3xl border border-white/10 bg-slate-950/80 p-2 shadow-xl ring-1 ring-white/5 overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5">
              <div className="h-6 w-56 rounded bg-slate-800/60" />
              <div className="h-9 w-44 rounded-full bg-slate-800/60" />
            </header>

            <div className="flex flex-1 min-h-0 flex-col rounded-3xl border border-slate-800/70 bg-slate-950/80 p-2 shadow-inner sm:p-2.5">
              <div className="space-y-1.5 sm:space-y-2">
                <div className="h-10 rounded-2xl border border-white/10 bg-slate-900/60" />

                <div className="flex items-stretch gap-2 sm:gap-2.5">
                  <div className="w-8 rounded-2xl border border-white/10 bg-slate-900/60" />
                  <div className="relative flex-1 lg:max-w-[min(100%,clamp(24rem,58vh,39rem))]">
                    <div className="mx-auto w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 aspect-square" />
                  </div>
                </div>

                <div className="h-10 rounded-2xl border border-white/10 bg-slate-900/60" />
              </div>

              <div className="pt-0.5 sm:pt-1">
                <div className="h-10 rounded-2xl border border-white/10 bg-slate-900/60" />
              </div>
            </div>
          </section>

          <aside className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 overflow-hidden">
            <div className="aspect-video w-full max-h-[46vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[50vh] lg:rounded-b-none lg:border-b-0" />
            <div className="flex-none border border-white/10 bg-slate-950/70 px-2.5 py-2 sm:px-3 lg:rounded-none lg:border-x lg:border-b lg:border-t-0">
              <div className="flex items-stretch gap-2">
                <div className="grid h-11 flex-1 grid-cols-[1fr_2fr_1fr] divide-x divide-white/10 overflow-hidden rounded-xl border border-white/15 bg-white/[0.04]">
                  <div className="h-full w-full bg-white/5" />
                  <div className="h-full w-full bg-white/[0.08]" />
                  <div className="h-full w-full bg-white/5" />
                </div>
                <div className="h-11 w-11 flex-none rounded-xl border border-white/15 bg-white/[0.04]" />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-sm lg:rounded-t-none lg:border-t-0">
              <div className="flex flex-none gap-2 rounded-t-2xl bg-slate-900/60 px-3 py-0.5 backdrop-blur lg:rounded-t-none">
                <div className="h-9 flex-1 rounded-full bg-white/10" />
                <div className="h-9 flex-1 rounded-full bg-white/10" />
                <div className="h-9 flex-1 rounded-full bg-white/10" />
              </div>
              <div className="mt-0 flex-1 min-h-0 pr-0">
                <div className="h-full w-full rounded-xl bg-slate-950/60" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
