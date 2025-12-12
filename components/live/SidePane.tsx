import type { Clock, Match } from "@/lib/types";

type SidePaneProps = {
  match: Match;
  clocks: Record<"white" | "black", Clock>;
  commentary: string[];
};

const formatTime = (ms: number) => {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const SidePane = ({ match, clocks, commentary }: SidePaneProps) => {
  const entries = [
    { key: "white" as const, label: "White", player: match.white, clock: clocks.white },
    { key: "black" as const, label: "Black", player: match.black, clock: clocks.black },
  ];

  return (
    <aside className="flex h-full flex-col gap-4 rounded-lg border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
      <div className="space-y-3">
        {entries.map(entry => {
          const { key, label, player, clock } = entry;
          const isActive = clock.isRunning && clock.remainingMs > 0;
          const total = clock.initialMs ?? Math.max(clock.remainingMs, 1);
          const percentage = Math.max(0, Math.min(100, Math.round((clock.remainingMs / total) * 100)));

          const containerClasses = [
            "rounded-lg",
            "border",
            "p-3",
            "transition",
            "bg-white/70",
            "dark:bg-white/5",
          ];
          if (isActive) {
            containerClasses.push("border-emerald-400", "ring-2", "ring-emerald-200", "dark:ring-emerald-500/30");
          } else {
            containerClasses.push("border-black/10", "dark:border-white/10");
          }

          return (
            <div key={key} className={containerClasses.join(" ")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {label}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {player.title ? `${player.title} ${player.name}` : player.name}
                  </p>
                  {typeof player.rating === "number" ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Rating {player.rating}</p>
                  ) : null}
                  <p className="text-xs text-gray-500 dark:text-gray-400">{player.country}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
                    {formatTime(clock.remainingMs)}
                  </p>
                  {typeof clock.incrementMs === "number" ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      +{Math.round(clock.incrementMs / 1000)}s per move
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded bg-black/10 dark:bg-white/10">
                <div
                  className="h-full bg-emerald-400 transition-all dark:bg-emerald-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white/70 p-3 text-sm text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
        <h3 className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Commentary
        </h3>
        {commentary.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Commentary will appear once the broadcast starts.
          </p>
        ) : (
          <ul className="space-y-2">
            {commentary.map((line, index) => (
              <li
                key={index}
                className="rounded-md border border-black/10 bg-white/80 p-2 text-xs text-gray-600 dark:border-white/10 dark:bg-transparent dark:text-gray-300"
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};

export default SidePane;
