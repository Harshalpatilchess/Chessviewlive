import Flag from "@/components/live/Flag";
import type { Player } from "@/lib/types";

type PlayerHeaderProps = {
  player: Player;
  color: "white" | "black";
  clock: string;
};

const badgeStyles: Record<PlayerHeaderProps["color"], string> = {
  white: "border-white/20 bg-white/5",
  black: "border-slate-800 bg-slate-900/50",
};

const textAccent: Record<PlayerHeaderProps["color"], string> = {
  white: "text-slate-200",
  black: "text-slate-300",
};

const PlayerHeaderTop = ({ player, color, clock }: PlayerHeaderProps) => {
  const nameLabel = player.title ? `${player.title} ${player.name}` : player.name;

  return (
    <header
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs sm:text-sm ${
        badgeStyles[color]
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 text-slate-200">
        <Flag country={player.country} className="text-base leading-none" />
        <div className="flex min-w-0 items-center gap-2 truncate text-xs sm:text-sm">
          <span className="truncate font-semibold text-white">{nameLabel}</span>
          <span className="rating-text text-[11px] sm:text-xs">({player.rating})</span>
          <span className={`rating-text text-[11px] uppercase tracking-wide ${textAccent[color]}`}>{player.country}</span>
        </div>
      </div>
      <span className="shrink-0 font-mono text-sm font-semibold tracking-wide text-slate-100">
        {clock}
      </span>
    </header>
  );
};

export default PlayerHeaderTop;
