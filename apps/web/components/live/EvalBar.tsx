type EvalBarProps = {
  value: number;
  scoreLabel?: string;
  advantage?: "white" | "black" | "equal";
  orientation?: "white" | "black";
  size?: "default" | "compact" | "mini";
  showLabel?: boolean;
  tone?: "active" | "idle";
};

const clamp = (val: number) => Math.min(100, Math.max(0, val));

const EvalBar = ({
  value,
  scoreLabel,
  advantage,
  orientation = "white",
  size = "default",
  showLabel = true,
  tone = "active",
}: EvalBarProps) => {
  const percent = clamp(value);
  const rawLabel = scoreLabel ?? "0.0";
  const isPlaceholder = rawLabel === "—";
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
  const widthClass =
    size === "mini"
      ? "w-2.5 md:w-3"
      : size === "compact"
        ? "w-2.5 md:w-3"
        : "w-3 md:w-3.5";
  const labelSizeClass = size === "mini" ? "text-[9px]" : "text-[10px]";
  const labelClass = `pointer-events-none absolute left-1/2 -translate-x-1/2 transform select-none ${labelSizeClass} font-semibold leading-tight text-slate-50 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] bg-black/25 px-1 rounded-sm backdrop-blur-[1px]`;
  const normalizedLabel =
    effectiveAdvantage === "black" ? rawLabel.replace(/^-/, "") : rawLabel;
  const displayLabel = isPlaceholder ? rawLabel : effectiveAdvantage === "equal" ? "0.0" : normalizedLabel;
  const railClass = "bg-slate-800/70";
  const midlineClass = "bg-amber-300/70";
  const fillClass = "bg-emerald-400";
  const toneClass = tone === "idle" ? "opacity-60 saturate-50" : "";

  return (
    <div className={`relative flex h-full ${widthClass} items-stretch overflow-hidden rounded-full ${railClass} ${toneClass}`}>
      <div className={`pointer-events-none absolute inset-x-0 top-1/2 h-px ${midlineClass}`} />
      <div
        className={`mt-auto h-full w-full rounded-full transition-[height] duration-300 ease-out ${fillClass}`}
        style={{ height: `${percent}%` }}
        aria-label={displayLabel}
      />
      {showLabel ? (
        effectiveAdvantage === "equal" ? (
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
        )
      ) : null}
    </div>
  );
};

export default EvalBar;
