import { Activity, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";

type BoardControlsProps = {
  onPrev: () => void;
  onLive: () => void;
  onNext: () => void;
  onFlip: () => void;
  showEval: boolean;
  toggleEval: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  liveActive?: boolean;
  density?: "default" | "compact";
};

export default function BoardControls({
  onPrev,
  onLive,
  onNext,
  onFlip,
  showEval,
  toggleEval,
  canPrev = true,
  canNext = true,
  liveActive = false,
  density = "default",
}: BoardControlsProps) {
  const isCompact = density === "compact";
  const iconSize = isCompact ? 16 : 18;
  return (
    <div className={`flex items-center justify-between ${isCompact ? "gap-1.5 py-1" : "gap-2 py-2"}`}>
      <button
        type="button"
        title="Evaluation gauge"
        aria-label="Toggle evaluation gauge"
        onClick={toggleEval}
        className={`rounded-full border border-white/10 ${isCompact ? "p-1.5" : "p-2"} ${
          showEval ? "bg-emerald-600/30" : "bg-slate-800/60"
        }`}
      >
        <Activity size={iconSize} />
      </button>

      <div className={`flex items-center ${isCompact ? "gap-1.5" : "gap-2"}`}>
        <button
          type="button"
          aria-label="Previous move"
          onClick={onPrev}
          disabled={!canPrev}
          className={`rounded-full border border-white/10 bg-slate-800/60 hover:border-white/40 hover:text-white disabled:opacity-50 ${
            isCompact ? "p-1.5" : "p-2"
          }`}
        >
          <ChevronLeft size={iconSize} />
        </button>
        <button
          type="button"
          aria-label="Live"
          onClick={onLive}
          className={`rounded border font-semibold uppercase tracking-wide ${
            !liveActive
              ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
              : "border-white/10 bg-slate-800/60 text-white hover:border-white/40"
          } ${isCompact ? "px-2.5 py-0.5 text-[10px]" : "px-3 py-1 text-xs"}`}
        >
          LIVE
        </button>
        <button
          type="button"
          aria-label="Next move"
          onClick={onNext}
          disabled={!canNext}
          className={`rounded-full border border-white/10 bg-slate-800/60 hover:border-white/40 hover:text-white disabled:opacity-50 ${
            isCompact ? "p-1.5" : "p-2"
          }`}
        >
          <ChevronRight size={iconSize} />
        </button>
      </div>

      <button
        type="button"
        title="Flip"
        aria-label="Flip board"
        onClick={onFlip}
        className={`rounded-full border border-white/10 bg-slate-800/60 hover:border-white/40 hover:text-white ${
          isCompact ? "p-1.5" : "p-2"
        }`}
      >
        <RotateCw size={iconSize} />
      </button>
    </div>
  );
}
