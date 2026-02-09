"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEvalCompact, formatEvalDetailed } from "@/lib/engine/evalMapping";
import { formatPvSan } from "@/lib/chess/formatPvSan";
import useTweenedNumber from "@/lib/hooks/useTweenedNumber";
import {
  DEFAULT_ENGINE_PROFILE_ID,
  ENGINE_PROFILE_IDS,
  ENGINE_PROFILES,
  formatEngineBackendLabel,
  type EngineBackend,
  type EngineProfileConfig,
  type EngineProfileId,
} from "@/lib/engine/config";
import type { StockfishEval, StockfishLine } from "@/lib/engine/useStockfishEvaluation";

const PROFILE_DEPTH_HINTS: Record<EngineProfileId, { min: number; max: number; base: number; peak: number }> = {
  light: { min: 10, max: 22, base: 1800, peak: 2350 },
  standard: { min: 16, max: 28, base: 2300, peak: 2850 },
  pro: { min: 20, max: 34, base: 2550, peak: 3200 },
};

const PROFILE_TAGLINES: Record<EngineProfileId, string> = {
  light: "Fast, shallower depth",
  standard: "Balanced, default",
  pro: "Deepest search",
};

const LINE_CAP = 3;

function formatLineEval(cp?: number, mate?: number, variant: "compact" | "detailed" = "compact"): string {
  if (typeof mate === "number") {
    const sign = mate > 0 ? "+" : "-";
    return `${sign}M${Math.abs(mate)}`;
  }
  if (typeof cp === "number") {
    const pawns = cp / 100;
    return variant === "detailed" ? formatEvalDetailed(pawns) : formatEvalCompact(pawns);
  }
  return "";
}

const PV_SAFETY_LIMIT = 60;

const formatPvForDisplay = (pv?: string, moveLimit: number = PV_SAFETY_LIMIT): string => {
  if (!pv) return "";
  const tokens = pv.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  const limited = tokens.length > moveLimit ? tokens.slice(0, moveLimit) : tokens;
  const joined = limited.join(" ");
  return tokens.length > moveLimit ? `${joined} …` : joined;
};

const clampDepthIndex = (value: number, steps: number[]): number => {
  const maxIndex = Math.max(steps.length - 1, 0);
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.round(value);
  return Math.max(0, Math.min(maxIndex, normalized));
};

const resolveDepthSteps = (steps?: number[], fallback?: number[]) => {
  const filtered = Array.isArray(steps) ? steps.filter(step => Number.isFinite(step)) : [];
  if (filtered.length) return filtered;
  if (fallback && fallback.length) return fallback;
  return [16, 20, 24];
};

const clampLineCount = (value?: number) => Math.max(1, Math.min(LINE_CAP, Math.round(value || 1)));

const getCurrentDepth = (lines: StockfishLine[]): number | null => {
  let maxDepth: number | null = null;
  for (const line of lines) {
    if (typeof line.depth === "number") {
      if (maxDepth === null || line.depth > maxDepth) {
        maxDepth = line.depth;
      }
    }
  }
  return maxDepth;
};

const getStrengthLabel = (depth: number, profileId: EngineProfileId) => {
  const hint = PROFILE_DEPTH_HINTS[profileId] ?? PROFILE_DEPTH_HINTS.standard;
  const clamped = Math.min(hint.max, Math.max(hint.min, depth));
  const ratio = (clamped - hint.min) / Math.max(1, hint.max - hint.min);
  const estimated = Math.round(hint.base + ratio * (hint.peak - hint.base));
  const suffix = clamped >= hint.max ? "+" : "";
  return `~${estimated}${suffix}`;
};

const formatDepthLabel = (depth?: number | null) => {
  if (!Number.isFinite(depth ?? NaN)) return "Depth —";
  return `Depth ${depth}`;
};

const getActiveColor = (fen?: string | null) => {
  if (!fen) return "w";
  const parts = fen.trim().split(/\s+/);
  return parts[1] === "b" ? "b" : "w";
};

const toWhitePerspective = (value: StockfishEval, fen?: string | null): StockfishEval => {
  if (!value) return null;
  const povMultiplier = getActiveColor(fen) === "b" ? -1 : 1;
  if (typeof value.mate === "number") {
    return { mate: value.mate * povMultiplier };
  }
  if (typeof value.cp === "number") {
    return { cp: value.cp * povMultiplier };
  }
  return null;
};

const normalizeLines = (lines: StockfishLine[], fen?: string | null): StockfishLine[] =>
  (lines ?? [])
    .slice()
    .sort((a, b) => a.multipv - b.multipv)
    .map(line => ({
      ...line,
      ...(() => {
        const adjusted = toWhitePerspective(
          line.cp != null || line.mate != null ? { cp: line.cp, mate: line.mate } : null,
          fen
        );
        return {
          cp: typeof adjusted?.cp === "number" ? adjusted.cp : undefined,
          mate: typeof adjusted?.mate === "number" ? adjusted?.mate : undefined,
        };
      })(),
      pv: line.pv ?? "",
    }));

type StockfishPanelProps = {
  enabled: boolean;
  evalResult: StockfishEval;
  lines: StockfishLine[];
  multiPv?: number;
  depthIndex?: number;
  depthSteps?: number[];
  targetDepth?: number;
  onMultiPvChange?: (value: number) => void;
  onDepthChange?: (index: number) => void;
  profileId?: EngineProfileId;
  profileConfig?: EngineProfileConfig;
  onProfileChange?: (value: EngineProfileId) => void;
  fen?: string | null;
  onToggle?: (next: boolean) => void;
  renderLines?: boolean;
  engineName?: string;
  engineBackend?: EngineBackend;
  debugBackendSwitcherEnabled?: boolean;
  onEngineBackendChange?: (backend: EngineBackend) => void;
  activeTab?: string | null;
  variant?: "full" | "mini";
  onNavigateToFull?: () => void;
};

const ControlRow = ({
  label,
  onDecrease,
  onIncrease,
}: {
  label: string;
  onDecrease?: () => void;
  onIncrease?: () => void;
}) => (
  <div className="inline-flex items-center gap-1 text-xs font-semibold text-slate-200">
    <button
      type="button"
      onClick={onDecrease}
      className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-slate-900/60 text-[12px] leading-none text-slate-100 shadow-sm transition hover:border-emerald-300/60 hover:bg-slate-800/80 active:scale-95"
      aria-label={`Decrease ${label}`}
    >
      &minus;
    </button>
    <span className="w-[52px] text-center leading-tight text-slate-200">{label}</span>
    <button
      type="button"
      onClick={onIncrease}
      className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-slate-900/60 text-[12px] leading-none text-slate-100 shadow-sm transition hover:border-emerald-300/60 hover:bg-slate-800/80 active:scale-95"
      aria-label={`Increase ${label}`}
    >
      +
    </button>
  </div>
);

const StockfishPanel = ({
  enabled,
  evalResult,
  lines,
  multiPv,
  depthIndex,
  depthSteps: depthStepsProp,
  targetDepth,
  onMultiPvChange,
  onDepthChange,
  profileId,
  profileConfig: profileConfigProp,
  onProfileChange,
  fen,
  onToggle,
  renderLines = true,
  engineName,
  engineBackend = "js-worker",
  debugBackendSwitcherEnabled = false,
  onEngineBackendChange,
  activeTab = "notation",
  variant = "full",
  onNavigateToFull,
}: StockfishPanelProps) => {
  const [showSettings, setShowSettings] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showSettings) return;
    if (typeof document === "undefined") return;

    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        setShowSettings(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSettings(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSettings]);
  const normalizedLines = useMemo(
    () => normalizeLines(lines ?? [], fen),
    [fen, lines]
  );
  const adjustedEval = toWhitePerspective(evalResult, fen);
  const primaryLine = normalizedLines[0];
  const headlineEvalMate =
    typeof primaryLine?.mate === "number"
      ? formatLineEval(undefined, primaryLine.mate, "detailed")
      : typeof adjustedEval?.mate === "number"
        ? formatLineEval(undefined, adjustedEval.mate, "detailed")
        : "";
  const targetHeadlineEvalNumber =
    headlineEvalMate
      ? null
      : typeof primaryLine?.cp === "number"
        ? primaryLine.cp / 100
        : typeof adjustedEval?.cp === "number"
          ? adjustedEval.cp / 100
          : null;
  const animatedHeadlineEvalNumber = useTweenedNumber(targetHeadlineEvalNumber, { durationMs: 200 });
  const headlineEval = enabled
    ? headlineEvalMate ||
      (typeof animatedHeadlineEvalNumber === "number" ? formatEvalDetailed(animatedHeadlineEvalNumber) : "")
    : "";
  const profileOptions = useMemo(() => ENGINE_PROFILE_IDS.map(id => ENGINE_PROFILES[id]), []);
  const resolvedProfile = useMemo<EngineProfileConfig>(() => {
    const mappedProfile = profileConfigProp ? ENGINE_PROFILES[profileConfigProp.id] : null;
    const selectedProfile = profileId ? ENGINE_PROFILES[profileId] : null;
    const fallback = ENGINE_PROFILES[DEFAULT_ENGINE_PROFILE_ID];
    if (profileConfigProp && profileConfigProp.id) {
      return {
        ...(selectedProfile ?? mappedProfile ?? fallback),
        ...profileConfigProp,
      };
    }
    return selectedProfile ?? mappedProfile ?? fallback;
  }, [profileConfigProp, profileId]);
  const resolvedDepthSteps = useMemo(
    () => resolveDepthSteps(depthStepsProp, resolvedProfile.depthSteps),
    [depthStepsProp, resolvedProfile.depthSteps]
  );
  const safeMultiPv = useMemo(() => {
    const candidate = typeof multiPv === "number" && Number.isFinite(multiPv) ? multiPv : 1;
    return clampLineCount(candidate);
  }, [multiPv]);
  const safeDepthIndex = useMemo(
    () =>
      clampDepthIndex(
        typeof depthIndex === "number" && Number.isFinite(depthIndex)
          ? depthIndex
          : resolvedProfile.defaultDepthIndex ?? 0,
        resolvedDepthSteps
      ),
    [depthIndex, resolvedDepthSteps, resolvedProfile.defaultDepthIndex]
  );
  const targetDepthValue = useMemo(() => {
    if (typeof targetDepth === "number" && Number.isFinite(targetDepth)) return targetDepth;
    return resolvedDepthSteps[safeDepthIndex] ?? resolvedDepthSteps[0];
  }, [resolvedDepthSteps, safeDepthIndex, targetDepth]);
  const linesToRender = useMemo(
    () => normalizedLines.slice(0, clampLineCount(safeMultiPv)),
    [normalizedLines, safeMultiPv]
  );
  const strengthLabel = targetDepthValue ? getStrengthLabel(targetDepthValue, resolvedProfile.id as EngineProfileId) : "—";
  const showMainContent =
    enabled && (activeTab === "notation" || activeTab === "engine") && !showSettings;
  const currentDepth = useMemo(
    () => getCurrentDepth(linesToRender.length ? linesToRender : normalizedLines),
    [linesToRender, normalizedLines]
  );
  const defaultDepthForProfile =
    resolvedDepthSteps[clampDepthIndex(resolvedProfile.defaultDepthIndex ?? 0, resolvedDepthSteps)] ??
    resolvedDepthSteps[0];
  const engineBackendDisplay = useMemo(
    () => formatEngineBackendLabel(engineBackend, { engineName }),
    [engineBackend, engineName]
  );
  const engineSecondaryLabel =
    engineBackend === "cloud"
      ? "Cloud engine"
      : engineBackend === "js-worker"
        ? "JS worker"
        : engineBackend === "wasm-nnue"
          ? "WASM NNUE"
          : "WASM";
  const isMiniPanel = variant === "mini";
  const handleMiniNavigate = () => {
    if (typeof onNavigateToFull === "function") {
      onNavigateToFull();
    }
  };
  const displayedDepth = currentDepth ?? targetDepthValue;
  const handleToggleClick = () => {
    if (typeof onToggle === "function") {
      onToggle(!enabled);
    }
  };
  const handleLinesStep = (delta: number) => {
    if (typeof onMultiPvChange !== "function") return;
    const next = clampLineCount(safeMultiPv + delta);
    onMultiPvChange(next);
  };
  const handleDepthStep = (delta: number) => {
    if (typeof onDepthChange !== "function") return;
    const nextIndex = clampDepthIndex(safeDepthIndex + delta, resolvedDepthSteps);
    onDepthChange(nextIndex);
  };
  const handleSliderChange = (event: { target: { value: string } }) => {
    const parsed = parseInt(event.target.value, 10);
    if (!Number.isFinite(parsed)) return;
    const nextIndex = clampDepthIndex(parsed, resolvedDepthSteps);
    onDepthChange?.(nextIndex);
  };

  if (isMiniPanel) {
    const pvLabel = primaryLine ? formatLineEval(primaryLine.cp, primaryLine.mate) : headlineEval;
    const pvMoves = typeof primaryLine?.pv === "string" ? primaryLine.pv.trim().split(/\s+/).filter(Boolean) : [];
    const formattedPv = formatPvSan(fen, pvMoves).pvSan;
    const pvText = formatPvForDisplay(formattedPv || primaryLine?.pv || "");
    return (
      <div
        ref={panelRef}
        className="mt-2 rounded-2xl border border-slate-800/70 bg-slate-950/70 p-2 text-xs text-slate-100 shadow-inner"
      >
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-900/70 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Toggle engine"
              onClick={handleToggleClick}
              className={`flex h-7 w-12 items-center rounded-full px-1 transition ${
                enabled ? "bg-emerald-500/40" : "bg-slate-700"
              } ${typeof onToggle === "function" ? "cursor-pointer hover:bg-emerald-500/60" : "cursor-not-allowed opacity-80"}`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white shadow transition ${enabled ? "translate-x-5" : "translate-x-0"}`}
              />
            </button>
            <div className="flex min-w-0 flex-col leading-tight">
              <div className="text-[11px] font-semibold text-slate-50">{engineBackendDisplay.short}</div>
              <div className="text-[9px] text-slate-400">{engineSecondaryLabel}</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-end leading-tight">
            {enabled && headlineEval ? (
              <div className="text-[14px] font-semibold text-emerald-100 tabular-nums">{headlineEval}</div>
            ) : (
              <div className="text-[10px] font-semibold text-slate-400">Engine off</div>
            )}
            {enabled ? (
              <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                Depth {displayedDepth ?? "—"}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleMiniNavigate}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 text-[9px] font-semibold uppercase tracking-wide text-emerald-200"
              aria-label="Open engine settings"
            >
              <span className="leading-none">{resolvedProfile.label}</span>
              <span aria-hidden="true" className="leading-none text-emerald-200/90">
                ▾
              </span>
            </button>
            <button
              type="button"
              onClick={handleMiniNavigate}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-slate-800 text-slate-200 transition hover:bg-slate-700"
              aria-label="Open engine settings"
            >
              <span className="text-[11px]">⚙</span>
            </button>
          </div>
        </div>

        {enabled ? (
          <div className="mt-2 rounded-lg border border-slate-800/80 bg-slate-900/60 px-2 py-1.5">
            <div className="flex items-baseline gap-2">
              <div className="shrink-0 text-[10px] font-semibold leading-none text-emerald-100 tabular-nums">
                {pvLabel || "—"}
              </div>
              <div className="min-w-0 flex-1 truncate font-mono text-[10px] leading-none tracking-tight text-slate-100">
                {pvText || "No moves yet."}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="mt-2 rounded-2xl border border-slate-800/70 bg-slate-950/70 p-3 text-xs text-slate-100 shadow-inner"
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Toggle engine"
            onClick={handleToggleClick}
            className={`flex h-8 w-14 items-center rounded-full px-1 transition ${
              enabled ? "bg-emerald-500/40" : "bg-slate-700"
            } ${typeof onToggle === "function" ? "cursor-pointer hover:bg-emerald-500/60" : "cursor-not-allowed opacity-80"}`}
          >
            <span
              className={`h-6 w-6 rounded-full bg-white shadow transition ${enabled ? "translate-x-6" : "translate-x-0"}`}
            />
          </button>
          <div className="flex flex-col leading-tight">
            <div className="text-sm font-semibold text-slate-50">{engineBackendDisplay.short}</div>
            <div className="text-[11px] text-slate-400">{engineSecondaryLabel}</div>
          </div>
        </div>
	        <div className="flex flex-1 flex-col items-center justify-center">
	          {enabled ? (
	            <>
	              {headlineEval ? (
	                <div className="text-[26px] font-black leading-tight text-emerald-100 drop-shadow">{headlineEval}</div>
	              ) : null}
	              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
	                Depth {displayedDepth ?? "—"}
	              </div>
	            </>
	          ) : null}
	        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="engine-quality">
            Analysis quality
          </label>
          <div className="relative inline-flex">
            <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
              <span className="leading-none">{resolvedProfile.label}</span>
              <span aria-hidden="true" className="leading-none text-emerald-200/90">
                ▾
              </span>
            </div>
            <select
              id="engine-quality"
              value={resolvedProfile.id}
              onChange={event => onProfileChange?.(event.target.value as EngineProfileId)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Analysis quality"
            >
              {profileOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowSettings(prev => !prev);
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-full border text-slate-200 transition ${
              showSettings
                ? "border-emerald-400/60 bg-emerald-500/15 hover:bg-emerald-500/20"
                : "border-transparent bg-slate-800 hover:bg-slate-700"
            }`}
            aria-label={showSettings ? "Close engine settings" : "Open engine settings"}
            aria-pressed={showSettings}
          >
            <span className="text-sm">{showSettings ? "✕" : "⚙"}</span>
          </button>
        </div>
      </div>

      {showMainContent ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3 py-3">
          <div className="min-w-0 flex-1">
            {renderLines ? (
              enabled ? (
                linesToRender.length ? (
                  <div className="space-y-1.5">
                    {linesToRender.map((line, idx) => {
                      const label = formatLineEval(line.cp, line.mate);
                      const pvMoves = typeof line.pv === "string" ? line.pv.trim().split(/\s+/).filter(Boolean) : [];
                      const formattedPv = formatPvSan(fen, pvMoves).pvSan;
                      const pvText = formatPvForDisplay(formattedPv || line.pv || "");
                      const emphasized = idx === 0;
                      return (
                        <div
                          key={line.multipv}
                          className={`flex items-baseline gap-1.5 rounded-lg border px-3 py-2 ${
                            emphasized
                              ? "border-emerald-400/60 bg-emerald-500/5"
                              : "border-slate-800/70 bg-slate-950/40"
                          }`}
                        >
                          <div className="shrink-0 text-sm font-semibold leading-none text-emerald-100 tabular-nums">
                            {label}
                          </div>
                          <div className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none tracking-tight text-slate-100">
                            {pvText || "No moves yet."}
                          </div>
                        </div>
                      );
                    })}
                  </div>
		                ) : null
		              ) : (
		                <div className="text-[12px] font-semibold text-slate-400">Analysis disabled</div>
		              )
            ) : null}
          </div>
          <div className="shrink-0 self-start">
            <div className="flex w-[132px] flex-col items-end gap-2">
              <ControlRow
                label="Lines"
                onDecrease={() => handleLinesStep(-1)}
                onIncrease={() => handleLinesStep(1)}
              />
              <ControlRow
                label="Depth"
                onDecrease={() => handleDepthStep(-1)}
                onIncrease={() => handleDepthStep(1)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto rounded-2xl border border-slate-800/70 bg-slate-950/80 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-100">Engine profiles</div>
              <div className="mt-0.5 text-[11px] text-slate-400">Pick a starting point, then adjust depth.</div>
            </div>
            <div className="rounded-full border border-emerald-400/50 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
              {resolvedProfile.label}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {profileOptions.map(option => {
              const active = option.id === resolvedProfile.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onProfileChange?.(option.id)}
                  className={`flex min-w-0 flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                    active
                      ? "border-emerald-400 bg-emerald-500/10 text-emerald-100 shadow-inner"
                      : "border-slate-700 bg-slate-900/50 text-slate-200 hover:border-emerald-300/70 hover:bg-slate-800/70"
                  }`}
                  aria-pressed={active}
                >
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className="text-[10px] text-slate-300/90">{PROFILE_TAGLINES[option.id]}</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-100">Search depth</div>
                <div className="text-[11px] text-slate-400">Higher tiers push to deeper plies.</div>
              </div>
              <div className="text-sm font-semibold text-emerald-200">{formatDepthLabel(targetDepthValue)}</div>
            </div>
            <div className="mt-3">
              <input
                type="range"
                min={0}
                max={Math.max(resolvedDepthSteps.length - 1, 0)}
                step={1}
                value={safeDepthIndex}
                onChange={handleSliderChange}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-emerald-400"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Rating hint {strengthLabel}</span>
              <span>
                {safeMultiPv} line{safeMultiPv > 1 ? "s" : ""} ·{" "}
                {formatDepthLabel(defaultDepthForProfile)}
              </span>
            </div>
            {debugBackendSwitcherEnabled ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-300">
                <span className="text-slate-500">Backend</span>
                <select
                  value={engineBackend}
                  onChange={event => onEngineBackendChange?.(event.target.value as EngineBackend)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="cloud">Cloud</option>
                  <option value="js-worker">JS Worker</option>
                  <option value="wasm">WASM</option>
                  <option value="wasm-nnue">WASM NNUE</option>
                </select>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default StockfishPanel;

type StockfishLinesListProps = {
  lines: StockfishLine[];
  fen?: string | null;
  emptyLabel?: string;
};

export const StockfishLinesList = ({ lines, fen, emptyLabel = "" }: StockfishLinesListProps) => {
  const normalizedLines = useMemo(() => normalizeLines(lines ?? [], fen), [fen, lines]);
  if (!normalizedLines.length) {
    if (!emptyLabel) return null;
    return (
      <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-300">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      {normalizedLines.map(line => {
        const label = formatLineEval(line.cp, line.mate);
        const pvMoves = typeof line.pv === "string" ? line.pv.trim().split(/\s+/).filter(Boolean) : [];
        const formattedPv = formatPvSan(fen, pvMoves).pvSan;
        const pvText = formatPvForDisplay(formattedPv || line.pv || "");
        return (
          <div
            key={line.multipv}
            className="flex items-start gap-2 rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2"
          >
            <div className="text-sm font-semibold text-emerald-100 tabular-nums">{label}</div>
            <div className="flex-1 text-[11px] leading-snug text-slate-200">
              {pvText || "No moves yet."}
            </div>
          </div>
        );
      })}
    </div>
  );
};
