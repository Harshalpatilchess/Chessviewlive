"use client";

import type { ReactNode } from "react";

export type PlayerTilesProps = {
  whiteName?: string;
  whiteRatingLabel?: ReactNode;
  whiteClock?: string;
  blackName?: string;
  blackRatingLabel?: ReactNode;
  blackClock?: string;
};

const DEFAULT_CLOCK = "01:23:45";

const buildRatingLabel = (label?: ReactNode) => {
  if (label === 0) return "Rating 0";
  if (label === null || label === undefined) return "Rating TBD";
  return label;
};

export default function PlayerTiles({
  whiteName,
  whiteRatingLabel,
  whiteClock,
  blackName,
  blackRatingLabel,
  blackClock,
}: PlayerTilesProps) {
  const whiteDisplay = whiteName || "White Player";
  const blackDisplay = blackName || "Black Player";
  const whiteClockLabel = whiteClock || DEFAULT_CLOCK;
  const blackClockLabel = blackClock || DEFAULT_CLOCK;

  return (
    <div className="grid gap-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 md:grid-cols-[1fr_auto_1fr]">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-full border border-white/15 bg-slate-900/70" />
        <div className="space-y-0.5 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-400">White</p>
          <p className="text-base font-semibold text-white">{whiteDisplay}</p>
          <p className="text-sm text-slate-400">{buildRatingLabel(whiteRatingLabel)}</p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">
        <div className="rounded-full border border-white/15 bg-slate-900/70 px-4 py-1.5 font-mono text-sm tracking-normal text-white shadow-inner">
          {whiteClockLabel}
        </div>
        <span>vs</span>
        <div className="rounded-full border border-white/15 bg-slate-900/70 px-4 py-1.5 font-mono text-sm tracking-normal text-white shadow-inner">
          {blackClockLabel}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 text-right">
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-400">Black</p>
          <p className="text-base font-semibold text-white">{blackDisplay}</p>
          <p className="text-sm text-slate-400">{buildRatingLabel(blackRatingLabel)}</p>
        </div>
        <div className="h-14 w-14 rounded-full border border-white/15 bg-slate-900/70" />
      </div>
    </div>
  );
}
