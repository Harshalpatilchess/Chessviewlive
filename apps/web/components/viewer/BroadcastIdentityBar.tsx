import TournamentPlayerStrip from "@/components/boards/TournamentPlayerStrip";
import type { BoardNavigationPlayer } from "@/lib/boards/navigationTypes";

type BroadcastIdentityBarProps = {
  player: BoardNavigationPlayer;
  scorePill: string;
  clockLabel: string;
  hasClock: boolean;
  isTimeTrouble: boolean;
  showAnalysis?: boolean;
  showBroadcastCues?: boolean;
  isToMove?: boolean;
  rowColor?: "white" | "black";
  showMissingData?: boolean;
  debugFlagProbe?: boolean;
};

export default function BroadcastIdentityBar({
  player,
  scorePill,
  clockLabel,
  hasClock,
  isTimeTrouble,
  showAnalysis = false,
  showBroadcastCues = false,
  isToMove = false,
  rowColor = "white",
  showMissingData = false,
  debugFlagProbe = false,
}: BroadcastIdentityBarProps) {
  const accentClass = rowColor === "white" ? "bg-white/25" : "bg-slate-700/60";
  return (
    <div className="flex flex-col gap-1.5">
      {showAnalysis ? (
        <div className="flex justify-end">
          <span className="rounded-full border border-rose-300/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-rose-100">
            Analysis
          </span>
        </div>
      ) : null}
      <div className="relative">
        {showBroadcastCues ? (
          <span
            aria-hidden
            className={`pointer-events-none absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${accentClass}`}
          />
        ) : null}
        <TournamentPlayerStrip
          player={player}
          scorePill={scorePill}
          clockLabel={clockLabel}
          hasClock={hasClock}
          isTimeTrouble={isTimeTrouble}
          size="viewerLarge"
          debugFlagProbe={debugFlagProbe}
        />
        {showBroadcastCues && isToMove ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-28 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-300/70 ring-1 ring-emerald-200/40 animate-pulse"
          />
        ) : null}
      </div>
      {showMissingData ? (
        <span className="text-[10px] font-medium text-amber-200/90">(missing player data)</span>
      ) : null}
    </div>
  );
}
