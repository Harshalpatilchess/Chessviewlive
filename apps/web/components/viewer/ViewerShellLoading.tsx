export default function ViewerShellLoading() {
  return (
    <main className="flex min-h-screen h-screen flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <div className="mx-auto flex-1 w-full max-w-[1440px] px-4 py-1.5 lg:px-8 flex flex-col min-h-0">
        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch">
          <section className="mx-auto flex h-full min-h-0 w-full max-w-[620px] flex-1 flex-col gap-1.5 rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl ring-1 ring-white/5 lg:flex-[0.9]">
            <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5">
              <div className="h-6 w-56 rounded bg-slate-800/60" />
              <div className="h-9 w-44 rounded-full bg-slate-800/60" />
            </header>

            <div className="flex flex-1 min-h-0 flex-col rounded-3xl border border-slate-800/70 bg-slate-950/80 p-3 shadow-inner sm:p-3.5">
              <div className="space-y-2 sm:space-y-2.5">
                <div className="h-10 rounded-2xl border border-white/10 bg-slate-900/60" />

                <div className="flex items-stretch gap-2.5 sm:gap-3.5">
                  <div className="w-8 rounded-2xl border border-white/10 bg-slate-900/60" />
                  <div className="relative flex-1">
                    <div className="mx-auto w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 aspect-square" />
                  </div>
                </div>

                <div className="h-10 rounded-2xl border border-white/10 bg-slate-900/60" />
              </div>

              <div className="pt-1 sm:pt-1.5">
                <div className="h-10 rounded-2xl border border-white/10 bg-slate-900/60" />
              </div>
            </div>
          </section>

          <aside className="flex h-full min-h-0 w-full flex-col gap-1.5 overflow-hidden lg:flex-[1.1] lg:gap-2">
            <div className="aspect-video w-full max-h-[40vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[48vh]" />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-sm">
              <div className="flex flex-none gap-2 rounded-t-2xl bg-slate-900/60 px-3 py-0.5 backdrop-blur">
                <div className="h-9 flex-1 rounded-full bg-white/10" />
                <div className="h-9 flex-1 rounded-full bg-white/10" />
                <div className="h-9 flex-1 rounded-full bg-white/10" />
              </div>
              <div className="mt-1 flex-1 min-h-0 pr-2">
                <div className="h-full w-full rounded-xl bg-slate-950/60" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

