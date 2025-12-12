type EvalBarProps = {
  value: number;
  scoreLabel?: string;
  advantage?: "white" | "black" | "equal";
  orientation?: "white" | "black";
};

const clamp = (val: number) => Math.min(100, Math.max(0, val));

const EvalBar = ({ value, scoreLabel, advantage, orientation = "white" }: EvalBarProps) => {
  const percent = clamp(value);
  const rawLabel = scoreLabel ?? "0.0";
  const effectiveAdvantage =
    advantage ??
    (percent > 50 ? "white" : percent < 50 ? "black" : "equal");
  const isWhiteAtBottom = orientation !== "black";
  const whitePosition = isWhiteAtBottom ? "bottom-2 translate-y-1/2" : "top-2 -translate-y-1/2";
  const blackPosition = isWhiteAtBottom ? "top-2 -translate-y-1/2" : "bottom-2 translate-y-1/2";
  const centerPosition = "top-1/2 -translate-y-1/2";
  const positionClass =
    effectiveAdvantage === "equal"
      ? centerPosition
      : effectiveAdvantage === "white"
        ? whitePosition
        : blackPosition;
  const labelClass =
    "pointer-events-none absolute left-1/2 -translate-x-1/2 transform select-none text-[10px] font-semibold leading-tight text-slate-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] bg-black/25 px-1 rounded-sm backdrop-blur-[1px]";
  const normalizedLabel =
    effectiveAdvantage === "black" ? rawLabel.replace(/^-/, "") : rawLabel;
  const displayLabel = effectiveAdvantage === "equal" ? "0.0" : normalizedLabel;

  return (
    <div className="relative flex h-full w-3 items-stretch overflow-hidden rounded-full bg-slate-800/70 md:w-3.5">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-amber-300/70" />
      <div
        className="mt-auto h-full w-full rounded-full bg-emerald-400 transition-all"
        style={{ height: `${percent}%` }}
        aria-label={displayLabel}
      />
      {effectiveAdvantage === "equal" ? (
        <>
          <span className={`${labelClass} ${whitePosition}`} aria-hidden="true">
            {displayLabel}
          </span>
          <span className={`${labelClass} ${blackPosition}`} aria-hidden="true">
            {displayLabel}
          </span>
        </>
      ) : (
        <span className={`${labelClass} ${positionClass}`} aria-hidden="true">
          {displayLabel}
        </span>
      )}
    </div>
  );
};

export default EvalBar;
