"use client";

import dynamic from "next/dynamic";

import PlayerTiles from "./PlayerTiles";

const BroadcastBoard = dynamic(() => import("./BroadcastBoard"), {
  ssr: false,
});

export default function BroadcastBoardShell() {
  return (
    <div className="grid gap-6 lg:min-h-[calc(100vh-96px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="mx-auto flex w-full max-w-[620px] flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-xl ring-1 ring-white/5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-400">
              Championship broadcast
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">Game 7.1</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
            <span className="rounded-full border border-white/20 bg-slate-900/60 px-3 py-1 text-slate-200">Round 7</span>
            <span className="rounded-full border border-white/20 bg-slate-900/60 px-3 py-1 text-slate-200">Board 7.1</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-100">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            Sync ok
          </div>
        </header>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-inner">
          <PlayerTiles />

          <div className="flex items-stretch gap-3">
            <div className="hidden min-h-[320px] md:flex">
              <div className="flex h-full w-9 flex-col justify-end rounded-3xl border border-white/15 bg-slate-950/70 px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                <div className="flex-1 rounded-full bg-gradient-to-b from-emerald-400 via-amber-200 to-rose-500 shadow-[inset_0_0_6px_rgba(0,0,0,0.4)]" />
                <span className="mt-3 text-center text-[11px] text-white/80">Eval</span>
              </div>
            </div>
            <div className="relative flex-1">
              <BroadcastBoard />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-slate-300 md:text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Latency</span>
              <span className="font-semibold text-white">— ms</span>
            </div>
            <div className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden />
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Quality</span>
              <span className="font-semibold text-white">—</span>
            </div>
            <div className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden />
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Viewers</span>
              <span className="font-semibold text-white">—</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden />
              Live relay syncing
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.35em]">
              <button className="rounded-full border border-white/30 px-3 py-1 text-white transition hover:border-white/60">
                Prev
              </button>
              <button className="rounded-full bg-rose-500/90 px-4 py-1 text-white shadow-lg shadow-rose-500/30">
                Live
              </button>
              <button className="rounded-full border border-white/30 px-3 py-1 text-white transition hover:border-white/60">
                Next
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="flex w-full flex-col gap-4 lg:gap-5">
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 shadow-xl ring-1 ring-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Player video feed</p>
              <p className="text-xs text-slate-400">Cameras & overlays will appear here.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              Connected
            </div>
          </div>
          <div className="mt-4 flex min-h-[220px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#050f1e] text-center text-sm text-slate-400">
            Live player video will appear here.
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <div className="rounded-full border border-white/15 bg-slate-900/80 px-3 py-1.5">Swap camera</div>
            <div className="rounded-full border border-white/15 bg-slate-900/80 px-3 py-1.5">Toggle overlays</div>
            <div className="rounded-full border border-white/15 bg-slate-900/80 px-3 py-1.5">Studio controls</div>
          </div>
        </div>

        <div className="flex-1 rounded-3xl border border-white/10 bg-slate-950/80 p-4 shadow-xl ring-1 ring-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Notation &amp; analysis</p>
            <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
              Coming soon
            </span>
          </div>
          <div className="mt-4 min-h-[200px] rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-400">
            Notation, engine insights, and commentary will appear here.
          </div>
        </div>
      </aside>
    </div>
  );
}
