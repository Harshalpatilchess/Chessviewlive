import {
  resolveBoardPlayerDisplayName,
} from "@/components/boards/BoardPlayerIdentityInline";
import TitleBadge from "@/components/boards/TitleBadge";
import { resolveFlagDisplay } from "@/components/live/Flag";
import type { BoardNavigationPlayer } from "@/lib/boards/navigationTypes";

const pillBase = "inline-flex items-center justify-center whitespace-nowrap rounded-md border font-semibold leading-tight";

const toTrimmedString = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export type TournamentPlayerStripProps = {
  player: BoardNavigationPlayer;
  scorePill?: string | null;
  clockLabel?: string | null;
  hasClock?: boolean;
  isTimeTrouble?: boolean;
  size?: "mini" | "viewerLarge";
  debugFlagProbe?: boolean;
};

export default function TournamentPlayerStrip({
  player,
  scorePill,
  clockLabel,
  hasClock,
  isTimeTrouble,
  size = "mini",
  debugFlagProbe = false,
}: TournamentPlayerStripProps) {
  const resolvedFlagDisplay = resolveFlagDisplay(player);
  const rawFlag = toTrimmedString(player.flag ?? null);
  const federation = toTrimmedString(player.federation ?? null);
  const country = toTrimmedString(player.country ?? null);
  const title = toTrimmedString(player.title ?? null);
  const displayName = resolveBoardPlayerDisplayName(player);
  const rating =
    Number.isFinite(Number(player?.rating ?? NaN)) && Number(player.rating) > 0
      ? String(Math.trunc(Number(player.rating)))
      : null;
  const resolvedScorePill = scorePill ?? "—";
  const resolvedClockLabel = clockLabel ?? "—";
  const scorePillTone =
    resolvedScorePill === "—"
      ? "border-white/10 bg-white/5 text-slate-500/80"
      : "border-white/15 bg-white/10 text-slate-100";
  const ratingTone = rating ? "text-slate-300" : "text-slate-500/80";
  const clockTone = hasClock
    ? isTimeTrouble
      ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
      : "border-slate-600/60 text-slate-100"
    : "border-slate-700/60 text-slate-500/80";
  const containerClass =
    size === "viewerLarge"
      ? "grid min-h-[42px] grid-cols-[minmax(0,1fr)_44px_92px] items-center gap-x-1 rounded-xl border border-slate-700/70 bg-slate-950/80 px-2 py-1.5"
      : "grid min-h-[26px] grid-cols-[minmax(0,1fr)_26px_52px] items-center gap-x-px rounded-lg border border-slate-800/60 bg-slate-950/70 px-1 py-0.5";
  const flagWrapperClass =
    size === "viewerLarge"
      ? "mr-1.5 flex h-6 shrink-0 items-center justify-center"
      : "mr-1 flex h-5 shrink-0 items-center justify-center";
  const flagClass = size === "viewerLarge" ? "text-[20px] leading-none" : "text-[16px] leading-none";
  const titleClass = size === "viewerLarge" ? "shrink-0 mr-1.5 text-[10px]" : "shrink-0 mr-1 text-[8px]";
  const titleFallbackClass =
    size === "viewerLarge"
      ? "mr-1.5 shrink-0 text-[10px] font-semibold text-slate-600/70"
      : "mr-1 shrink-0 text-[8px] font-semibold text-slate-600/70";
  const nameClass =
    size === "viewerLarge"
      ? "min-w-0 flex-initial truncate text-[14px] font-semibold leading-tight text-slate-50"
      : "min-w-0 flex-initial truncate text-[11px] font-semibold leading-tight text-slate-50";
  const ratingClass =
    size === "viewerLarge"
      ? `ml-1.5 shrink-0 text-[12px] font-semibold tabular-nums ${ratingTone}`
      : `ml-1 shrink-0 text-[10px] font-semibold tabular-nums ${ratingTone}`;
  const scorePillClass =
    size === "viewerLarge"
      ? `${pillBase} ${scorePillTone} px-2 py-[2px] text-[11px]`
      : `${pillBase} ${scorePillTone} px-1 py-[1px] text-[9px]`;
  const clockPillClass =
    size === "viewerLarge"
      ? `${pillBase} min-w-[92px] justify-self-end px-2 py-[2px] text-[11px] tabular-nums ${clockTone}`
      : `${pillBase} min-w-[52px] justify-self-end px-1 py-[1px] text-[9px] tabular-nums ${clockTone}`;
  const flagProbeText = `raw:{flag=${rawFlag ?? "-"},fed=${federation ?? "-"},country=${country ?? "-"}} -> ${resolvedFlagDisplay.display}`;
  const flagProbeClass =
    size === "viewerLarge"
      ? "ml-1.5 max-w-[220px] truncate text-[9px] font-medium text-slate-500/80"
      : "ml-1 max-w-[140px] truncate text-[8px] font-medium text-slate-500/80";

  return (
    <div className={containerClass}>
      <div className="flex min-w-0 items-center flex-nowrap">
        <div className={flagWrapperClass}>
          {resolvedFlagDisplay.emoji ? (
            <span role="img" aria-label={resolvedFlagDisplay.normalized} className={flagClass}>
              {resolvedFlagDisplay.display}
            </span>
          ) : null}
        </div>
        {debugFlagProbe ? <span className={flagProbeClass}>{flagProbeText}</span> : null}
        {title ? (
          <TitleBadge title={title} compact={size !== "viewerLarge"} className={titleClass} />
        ) : (
          <span className={titleFallbackClass}>—</span>
        )}
        <span className={nameClass}>{displayName}</span>
        <span className={ratingClass}>{rating ?? "—"}</span>
      </div>
      <span className={scorePillClass}>
        {resolvedScorePill}
      </span>
      <span className={clockPillClass} aria-label="Clock">
        {resolvedClockLabel}
      </span>
    </div>
  );
}
