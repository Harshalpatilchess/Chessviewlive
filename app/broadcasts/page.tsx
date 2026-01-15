import Link from "next/link";
import { BROADCASTS } from "@/lib/broadcasts/catalog";

export default function BroadcastsIndexPage() {
  return (
    <main className="min-h-screen bg-[#05070f] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_55%)]" />
      <div className="relative mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">Broadcasts</p>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
            Curated live boards, polished for viewing
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-slate-300">
            A focused index of premium tournament feeds, ready to open inside the broadcast hub.
          </p>
        </header>

        <section className="grid gap-5">
          {BROADCASTS.map(tournament => {
            const href = `/broadcast/${encodeURIComponent(tournament.slug)}`;
            const sourceLabel = tournament.sourceType === "lichessBroadcast" ? "Lichess Broadcast" : "LiveChessCloud";
            return (
              <Link
                key={tournament.slug}
                href={href}
                className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl transition hover:border-sky-300/40 hover:bg-white/[0.07]"
              >
                <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(56,189,248,0.08),_transparent_60%)] opacity-0 transition group-hover:opacity-100" />
                <div className="relative flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-white">{tournament.title}</h2>
                      {tournament.isLiveHint ? (
                        <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                          Live
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        Round {tournament.defaultRound}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                        Source: {sourceLabel}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition group-hover:border-sky-300/60 group-hover:bg-sky-300/10">
                    Open boards →
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
