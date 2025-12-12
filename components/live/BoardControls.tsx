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
}: BoardControlsProps) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <button
        type="button"
        title="Evaluation gauge"
        aria-label="Toggle evaluation gauge"
        onClick={toggleEval}
        className={`rounded-full border border-white/10 p-2 ${
          showEval ? "bg-emerald-600/30" : "bg-slate-800/60"
        }`}
      >
        <Activity size={18} />
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous move"
          onClick={onPrev}
          disabled={!canPrev}
          className="rounded-full border border-white/10 p-2 bg-slate-800/60 hover:border-white/40 hover:text-white disabled:opacity-50"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          aria-label="Live"
          onClick={onLive}
          className={`rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            liveActive
              ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
              : "border-white/10 bg-slate-800/60 text-white hover:border-white/40"
          }`}
        >
          LIVE
        </button>
        <button
          type="button"
          aria-label="Next move"
          onClick={onNext}
          disabled={!canNext}
          className="rounded-full border border-white/10 p-2 bg-slate-800/60 hover:border-white/40 hover:text-white disabled:opacity-50"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <button
        type="button"
        title="Flip"
        aria-label="Flip board"
        onClick={onFlip}
        className="rounded-full border border-white/10 bg-slate-800/60 p-2 hover:border-white/40 hover:text-white"
      >
        <RotateCw size={18} />
      </button>
    </div>
  );
}
