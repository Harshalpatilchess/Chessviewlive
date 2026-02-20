import type { LiveRound } from "@/lib/types";

type LeftRailProps = {
  round: LiveRound;
  activeMatchId?: string;
};

const LeftRail = ({ round, activeMatchId }: LeftRailProps) => {
  return (
    <aside className="flex w-full flex-col rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm lg:min-w-[220px] lg:max-w-[280px]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          Round Summary
        </p>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-white/20 bg-black/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/40 hover:text-white"
        >
          <span>Collapse</span>
          <span className="text-xs">v</span>
        </button>
      </div>
      <div className="px-4 py-2">
        <p className="text-sm font-semibold text-slate-100">
          Round {round.roundNumber}
        </p>
        <p className="text-xs text-slate-400">{round.games.length} boards in play</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-2">
          {round.games.map(game => {
            const isActive = game.id === activeMatchId;
            const pillText = game.result ?? game.evaluation ?? "...";
            return (
              <li key={game.id}>
                <div
                  className={`flex flex-col gap-2 rounded-lg border px-3 py-2 transition ${
                    isActive
                      ? "border-emerald-400/60 bg-emerald-400/10 shadow-inner"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-xs font-semibold text-slate-200">
                      {game.board}
                    </span>
                    <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                      {pillText}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-sm bg-black/50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-200">
                        {game.white.flag}
                      </span>
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {game.white.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-sm bg-black/50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-400">
                        {game.black.flag}
                      </span>
                      <p className="truncate text-xs text-slate-400">
                        {game.black.name}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
};

export default LeftRail;
