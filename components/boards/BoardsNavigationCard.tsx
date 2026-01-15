"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Activity } from "lucide-react";
import Flag from "@/components/live/Flag";
import TitleBadge from "@/components/boards/TitleBadge";
import EvalBar from "@/components/live/EvalBar";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import { formatChessClockMs, isTimeTrouble } from "@/lib/live/clockFormat";
import { formatEvalLabel, mapEvaluationToBar, type EngineEvaluation } from "@/lib/engine/evalMapping";
import { consumeForceEval, peekForceEval } from "@/lib/engine/miniEvalDebug";
import useTweenedNumber from "@/lib/hooks/useTweenedNumber";
import type { GameResult } from "@/lib/tournamentManifest";
import type { BoardNavigationEntry, BoardNavigationPlayer } from "@/lib/boards/navigationTypes";
import { buildBroadcastBoardPath } from "@/lib/paths";

type BoardsNavigationCardProps = {
  board: BoardNavigationEntry;
  currentBoardId?: string;
  isActive?: boolean;
  paneQuery?: string;
  compact?: boolean;
  tournamentSlug?: string;
  mode?: "live" | "replay";
  variant?: "default" | "tournament";
  viewerEvalBars?: boolean;
  clockNowMs?: number | null;
  navEval?: {
    cp?: number;
    mate?: number;
    fenHash?: string;
    requestedFenHash?: string;
    appliedFenHash?: string;
    fenSourceUsed?: "feedFen" | "derivedFromMoves" | "fetchedBoardState" | "initialFallback" | "unknown";
    ts?: number;
  } | null;
  navFen?: NavFenMeta | null;
  navEvalPending?: boolean;
  navEvalNoData?: boolean;
  debug?: boolean;
  debugRoundId?: string | null;
  linkQuery?: string;
  sharedFenCache?: boolean;
  warmLiteEval?: boolean;
  autoEvalEnabled?: boolean;
  onBoardClick?: (board: BoardNavigationEntry) => boolean | void;
  onDebugVisibilityChange?: (boardId: string, isVisible: boolean) => void;
};

const pillBase = "inline-flex items-center justify-center whitespace-nowrap rounded-md border font-semibold leading-tight";
const pillSm = "px-1.5 py-[2px] text-[9px]";
const pillMd = "px-2 py-[3px] text-[10px]";

const normalizeResult = (result?: GameResult): string | null => {
  if (!result || result === "·" || result === "*") return null;
  return result === "1/2-1/2" ? "½-½" : result;
};

const renderEvalFill = (evaluation?: number | null) => {
  if (evaluation === null || evaluation === undefined || Number.isNaN(evaluation)) {
    return 50;
  }
  const clamped = Math.max(-5, Math.min(5, evaluation));
  return 50 + (clamped / 5) * 50;
};

const renderMiniEvalFill = (evaluationCp?: number | null) => {
  if (evaluationCp === null || evaluationCp === undefined || Number.isNaN(evaluationCp)) {
    return 50;
  }
  const clamped = Math.max(-600, Math.min(600, evaluationCp));
  return 50 + (clamped / 600) * 50;
};

const applyMinVisibleDelta = (value: number, minDelta: number) => {
  if (!Number.isFinite(value) || minDelta <= 0) return value;
  if (value > 50 && value < 50 + minDelta) return 50 + minDelta;
  if (value < 50 && value > 50 - minDelta) return 50 - minDelta;
  return value;
};

type MiniEngineEval = {
  value: number;
  label: string;
  cp?: number;
  mate?: number;
};

type NavFenMeta = {
  fen: string | null;
  fenHash: string | null;
  fenSource: "feedFen" | "derivedFromMoves" | "fetchedBoardState" | "initialFallback" | "unknown";
  isFinal: boolean;
  plyOrMoveCount: number;
  updatedAt: number;
};

type MiniEvalDebugMeta = {
  source?: "cache" | "upstream";
  cacheHit?: boolean;
  upstreamOk?: boolean;
  upstreamStatus?: number | "error";
  engineHost?: string;
};

type LiteEvalApiResponse = {
  lines?: Array<{ scoreCp?: number; scoreMate?: number }>;
  debug?: MiniEvalDebugMeta;
  error?: string;
};

type LiteEvalOutcome = {
  eval: MiniEngineEval | null;
  meta: MiniEvalDebugMeta | null;
  ok: boolean;
  status: number;
  errorMessage: string | null;
};

const LITE_EVAL_MOVETIME_MS = 250;
const MINI_EVAL_CACHE = new Map<string, MiniEngineEval>();
const MINI_EVAL_INFLIGHT = new Map<string, Promise<LiteEvalOutcome>>();
const MINI_EVAL_STORAGE_PREFIX = "cv-mini-eval-lite:";
const MINI_EVAL_STORAGE_TTL_MS = 20 * 60 * 1000;
const MINI_EVAL_STORAGE_MAX = 200;
const MINI_EVAL_COOLDOWN_MS = 2500;

const getFenHash = (fen: string, full = false) => {
  const trimmed = fen.trim();
  if (!full) {
    return trimmed.slice(0, 12);
  }
  const [placement] = trimmed.split(/\s+/);
  return placement ?? trimmed;
};

const getEvalCacheKey = (boardId: string, fenHash: string) => `${boardId}:${fenHash}`;

const toWhitePov = (fen: string, value: number) => {
  const sideToMove = fen.split(/\s+/)[1] === "b" ? -1 : 1;
  return value * sideToMove;
};

const buildMiniEngineEval = (
  fen: string,
  scoreCp?: number,
  scoreMate?: number,
  options?: { mapToBar?: boolean }
): MiniEngineEval | null => {
  const mateValue = Number(scoreMate);
  const cpValue = Number(scoreCp);
  const hasMate = Number.isFinite(mateValue);
  const hasCp = Number.isFinite(cpValue);
  if (!hasMate && !hasCp) return null;

  const evaluation: EngineEvaluation = hasMate ? { mate: mateValue } : hasCp ? { cp: cpValue } : null;
  if (!evaluation) return null;

  if (options?.mapToBar) {
    const mapped = mapEvaluationToBar(evaluation, fen);
    if (mapped.value == null || mapped.label == null) return null;
    return {
      value: mapped.value,
      label: mapped.label,
      cp: hasCp ? cpValue : undefined,
      mate: hasMate ? mateValue : undefined,
    };
  }

  if (hasMate) {
    const adjustedMate = toWhitePov(fen, mateValue);
    const mateLabel = adjustedMate === 0 ? formatEvalLabel(0) : `${adjustedMate > 0 ? "" : "-"}M${Math.abs(mateValue)}`;
    const label = formatEvalLabel(null, { isMate: true, mateLabel });
    const cpForFill = adjustedMate > 0 ? 600 : adjustedMate < 0 ? -600 : 0;
    return { value: renderMiniEvalFill(cpForFill), label, mate: mateValue };
  }

  const adjustedCp = toWhitePov(fen, cpValue);
  const label = formatEvalLabel(adjustedCp / 100);
  return { value: renderMiniEvalFill(adjustedCp), label, cp: cpValue };
};

const resolveLiteRawFillInput = (fen: string, evalResult: MiniEngineEval | null): number | null => {
  if (!evalResult) return null;
  if (Number.isFinite(Number(evalResult.mate))) {
    const adjustedMate = toWhitePov(fen, Number(evalResult.mate));
    return adjustedMate > 0 ? 600 : adjustedMate < 0 ? -600 : 0;
  }
  if (Number.isFinite(Number(evalResult.cp))) {
    return toWhitePov(fen, Number(evalResult.cp));
  }
  return null;
};

type MiniEvalStorageReadResult = {
  eval: MiniEngineEval | null;
  status: "hit" | "miss" | "expired" | "invalid";
};

type StoredMiniEval = {
  value?: number;
  label?: string;
  cp?: number | null;
  mate?: number | null;
  ts?: number;
};

const pruneMiniEvalStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const entries: Array<{ key: string; ts: number }> = [];
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(MINI_EVAL_STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as StoredMiniEval;
        const ts = Number(parsed.ts ?? NaN);
        if (!Number.isFinite(ts)) {
          keysToRemove.push(key);
          continue;
        }
        entries.push({ key, ts });
      } catch {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => window.localStorage.removeItem(key));
    if (entries.length <= MINI_EVAL_STORAGE_MAX) return;
    entries.sort((a, b) => a.ts - b.ts);
    const overflow = entries.length - MINI_EVAL_STORAGE_MAX;
    for (let i = 0; i < overflow; i += 1) {
      window.localStorage.removeItem(entries[i].key);
    }
  } catch {
    return;
  }
};

const buildMiniEvalFromStored = (
  fen: string,
  stored: StoredMiniEval,
  options?: { mapToBar?: boolean }
): MiniEngineEval | null => {
  const hasMate = Number.isFinite(Number(stored.mate));
  const hasCp = Number.isFinite(Number(stored.cp));
  if (hasMate || hasCp) {
    return buildMiniEngineEval(fen, stored.cp ?? undefined, stored.mate ?? undefined, options);
  }
  if (Number.isFinite(Number(stored.value)) && typeof stored.label === "string") {
    return { value: Number(stored.value), label: stored.label };
  }
  return null;
};

const readMiniEvalStorage = (
  fenHash: string,
  fen: string,
  options?: { mapToBar?: boolean }
): MiniEvalStorageReadResult => {
  if (typeof window === "undefined") return { eval: null, status: "miss" };
  try {
    const raw = window.localStorage.getItem(`${MINI_EVAL_STORAGE_PREFIX}${fenHash}`);
    if (!raw) return { eval: null, status: "miss" };
    const parsed = JSON.parse(raw) as StoredMiniEval;
    const ts = Number(parsed.ts ?? NaN);
    if (!Number.isFinite(ts)) {
      window.localStorage.removeItem(`${MINI_EVAL_STORAGE_PREFIX}${fenHash}`);
      return { eval: null, status: "invalid" };
    }
    if (Date.now() - ts > MINI_EVAL_STORAGE_TTL_MS) {
      window.localStorage.removeItem(`${MINI_EVAL_STORAGE_PREFIX}${fenHash}`);
      return { eval: null, status: "expired" };
    }
    const evalValue = buildMiniEvalFromStored(fen, parsed, options);
    if (!evalValue) {
      window.localStorage.removeItem(`${MINI_EVAL_STORAGE_PREFIX}${fenHash}`);
      return { eval: null, status: "invalid" };
    }
    return { eval: evalValue, status: "hit" };
  } catch {
    return { eval: null, status: "invalid" };
  }
};

const writeMiniEvalStorage = (fenHash: string, value: MiniEngineEval | null) => {
  if (typeof window === "undefined" || !value) return;
  if (!Number.isFinite(Number(value.value))) return;
  const payload = JSON.stringify({
    cp: value.cp ?? null,
    mate: value.mate ?? null,
    value: value.value,
    label: value.label,
    ts: Date.now(),
  } satisfies StoredMiniEval);
  window.localStorage.setItem(`${MINI_EVAL_STORAGE_PREFIX}${fenHash}`, payload);
  pruneMiniEvalStorage();
};

const PlayerLine = ({
  player,
  compact,
  scorePill,
}: {
  player: BoardNavigationPlayer;
  compact: boolean;
  scorePill?: string | null;
}) => {
  const ratingValue = Number.isFinite(player?.rating ?? NaN) ? String(player.rating) : "\u2014";
  const ratingTone = ratingValue === "\u2014" ? "text-slate-500/80" : "text-slate-100";
  return (
    <div
      className={`flex min-w-0 items-center rounded-lg border border-slate-700/40 bg-slate-900/70 ${
        compact ? "gap-0.5 px-1 py-[2px]" : "gap-1 px-1.5 py-[3px]"
      }`}
    >
      <div className={`flex min-w-0 flex-1 items-center ${compact ? "gap-0.5" : "gap-0.5"}`}>
        {player.flag ? (
          <Flag country={player.flag} className={`${compact ? "text-base" : "text-lg"} leading-none`} />
        ) : (
          <span
            className={`${compact ? "h-4 w-4" : "h-5 w-5"} rounded-full border border-white/10 bg-slate-800`}
            aria-hidden
          />
        )}
        <div className={`flex min-w-0 flex-1 items-center ${compact ? "gap-0.5" : "gap-0.5"}`}>
          {player.title ? <TitleBadge title={player.title} compact={compact} /> : null}
          <span className={`min-w-0 flex-1 truncate font-semibold leading-[1.1] text-slate-50 ${compact ? "text-[12px]" : "text-[12px]"}`}>
            {player.name}
          </span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {scorePill ? (
          <span className={`${pillBase} border-white/10 bg-white/5 text-slate-200 ${compact ? "px-1 py-[1px] text-[9px]" : "px-1.5 py-[2px] text-[10px]"}`}>
            {scorePill}
          </span>
        ) : null}
        <span
          className={`rating-text whitespace-nowrap tabular-nums ${compact ? "text-[10px]" : "text-[11px]"} ${ratingTone}`}
          aria-label="Rating"
        >
          {ratingValue}
        </span>
      </div>
    </div>
  );
};

const PlayerStrip = ({
  player,
  scorePill,
  clockLabel,
  isTimeTrouble,
}: {
  player: BoardNavigationPlayer;
  scorePill?: string | null;
  clockLabel?: string | null;
  isTimeTrouble?: boolean;
}) => {
  const ratingValue = Number.isFinite(player?.rating ?? NaN) ? String(player.rating) : "\u2014";
  const ratingTone = ratingValue === "\u2014" ? "text-slate-500/80" : "text-slate-400";
  const resolvedClockLabel = clockLabel ?? "\u2014:\u2014";
  const clockTone = clockLabel
    ? isTimeTrouble
      ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
      : "border-slate-600/60 text-slate-100"
    : "border-slate-700/60 text-slate-500/80";
  return (
    <div className="flex min-h-[26px] items-center gap-1 rounded-lg border border-slate-800/60 bg-slate-950/70 px-1 py-0.5">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {player.flag ? (
          <Flag
            country={player.flag}
            className="text-[16px] leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          />
        ) : (
          <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {player.title ? <TitleBadge title={player.title} /> : null}
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold leading-tight text-slate-50">
            {player.name}
          </span>
          <span className={`whitespace-nowrap text-[9px] font-semibold tabular-nums ${ratingTone}`}>
            {ratingValue}
          </span>
          {scorePill ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-slate-200">
              {scorePill}
            </span>
          ) : null}
        </div>
      </div>
      <span
        className={`${pillBase} ${pillSm} min-w-[54px] tabular-nums ${clockTone}`}
        aria-label="Clock"
      >
        {resolvedClockLabel}
      </span>
    </div>
  );
};

export const BoardsNavigationCard = ({
  board,
  currentBoardId,
  isActive,
  paneQuery,
  compact = false,
  tournamentSlug,
  mode,
  variant = "default",
  viewerEvalBars = false,
  clockNowMs = null,
  navEval,
  navFen,
  navEvalPending = false,
  navEvalNoData = false,
  debug = false,
  debugRoundId = null,
  linkQuery,
  sharedFenCache = false,
  warmLiteEval = false,
  autoEvalEnabled = false,
  onBoardClick,
  onDebugVisibilityChange,
}: BoardsNavigationCardProps) => {
  const resolvedActive = typeof isActive === "boolean" ? isActive : currentBoardId === board.boardId;
  const resolvedPaneQuery = paneQuery ?? null;
  const normalizedResult = normalizeResult(board.result);
  const isLiveResult = board.result === "*";
  const isExplicitLive = board.status === "live" || isLiveResult;
  const hasClockData =
    Number.isFinite(Number(board.whiteTimeMs ?? NaN)) || Number.isFinite(Number(board.blackTimeMs ?? NaN));
  const isFinished = Boolean(normalizedResult) || board.status === "final";
  const isScheduled = board.status === "scheduled";
  const isLive = !isFinished && !isScheduled && isExplicitLive;
  const clockBaseWhiteMs = Number.isFinite(board.whiteTimeMs ?? NaN)
    ? Number(board.whiteTimeMs)
    : null;
  const clockBaseBlackMs = Number.isFinite(board.blackTimeMs ?? NaN)
    ? Number(board.blackTimeMs)
    : null;
  const clockUpdatedAtMs = Number.isFinite(board.clockUpdatedAtMs ?? NaN)
    ? Number(board.clockUpdatedAtMs)
    : null;
  const resolvedClockUpdatedAtMs = clockUpdatedAtMs ?? (hasClockData && isLive ? clockNowMs : null);
  const clockTickMs =
    typeof clockNowMs === "number" && Number.isFinite(clockNowMs) ? clockNowMs : null;
  const resolveClockMs = useCallback(
    (baseMs: number | null, side: "white" | "black") => {
      if (!Number.isFinite(baseMs ?? NaN)) return null;
      if (!isLive) return baseMs as number;
      if (!resolvedClockUpdatedAtMs || !clockTickMs) return baseMs as number;
      if (board.sideToMove !== side) return baseMs as number;
      const elapsed = Math.max(0, clockTickMs - resolvedClockUpdatedAtMs);
      return Math.max(0, (baseMs as number) - elapsed);
    },
    [board.sideToMove, clockTickMs, isLive, resolvedClockUpdatedAtMs]
  );
  const resolvedWhiteClockMs = resolveClockMs(clockBaseWhiteMs, "white");
  const resolvedBlackClockMs = resolveClockMs(clockBaseBlackMs, "black");
  const whiteClockLabel = Number.isFinite(resolvedWhiteClockMs ?? NaN)
    ? formatChessClockMs(resolvedWhiteClockMs as number)
    : null;
  const blackClockLabel = Number.isFinite(resolvedBlackClockMs ?? NaN)
    ? formatChessClockMs(resolvedBlackClockMs as number)
    : null;
  const isWhiteInTimeTrouble = isTimeTrouble(resolvedWhiteClockMs, { enabled: isLive });
  const isBlackInTimeTrouble = isTimeTrouble(resolvedBlackClockMs, { enabled: isLive });
  const resolvedFen = navFen ? navFen.fen : board.previewFen ?? (isFinished ? board.finalFen : null);
  const showClocks = !isFinished && (isExplicitLive || hasClockData);
  const normalizedPreviewFen = useMemo(
    () => (typeof resolvedFen === "string" ? resolvedFen.trim() : ""),
    [resolvedFen]
  );
  const fenHash = useMemo(
    () => (normalizedPreviewFen ? getFenHash(normalizedPreviewFen, debug) : ""),
    [debug, normalizedPreviewFen]
  );
  const evalCacheKey = useMemo(
    () => (fenHash ? getEvalCacheKey(board.boardId, fenHash) : ""),
    [board.boardId, fenHash]
  );
  const viewerEvalBarsEnabled = viewerEvalBars && variant === "default";
  const externalEvalEnabled = viewerEvalBarsEnabled && navEval !== undefined;
  const lastStableNavEvalRef = useRef<BoardsNavigationCardProps["navEval"] | null>(null);
  const [debugFlags, setDebugFlags] = useState(() => ({
    debugLabelEnabled: debug,
    navDebugEnabled: false,
    debugVerbose: false,
  }));
  const rootRef = useRef<HTMLAnchorElement | null>(null);
  const fenHashRef = useRef(fenHash);
  const lastStableFenRef = useRef<string>("");
  const [engineEval, setEngineEval] = useState<MiniEngineEval | null>(() =>
    evalCacheKey ? MINI_EVAL_CACHE.get(evalCacheKey) ?? null : null
  );
  const [isEvalLoading, setIsEvalLoading] = useState(false);
  const [liteStatus, setLiteStatus] = useState<"idle" | "loading" | "success" | "error" | "cache">("idle");
  const [lastClickAt, setLastClickAt] = useState<number | null>(null);
  const [lastLiteEval, setLastLiteEval] = useState<MiniEngineEval | null>(null);
  const [lastLiteMeta, setLastLiteMeta] = useState<MiniEvalDebugMeta | null>(null);
  const [lastLiteError, setLastLiteError] = useState<string | null>(null);
  const [lastPersistStatus, setLastPersistStatus] = useState<MiniEvalStorageReadResult["status"] | null>(null);
  const [lastEvalSource, setLastEvalSource] = useState<"lite" | "persist" | null>(null);
  const [statusReason, setStatusReason] = useState<string | null>(() => (autoEvalEnabled ? "auto-enabled" : null));
  const [retryCount, setRetryCount] = useState(0);
  const [clickCounter, setClickCounter] = useState(0);
  const [liteBadge, setLiteBadge] = useState<"lite" | "cached" | null>(null);
  const [evalEnabled, setEvalEnabled] = useState(() => viewerEvalBarsEnabled || autoEvalEnabled);
  const [enabledByUser, setEnabledByUser] = useState(false);
  const [isEvalArming, setIsEvalArming] = useState(false);
  const badgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCounterRef = useRef(0);
  const enableClickRef = useRef(false);
  const lastEvaluatedFenHashRef = useRef<string | null>(null);
  const lastRequestedFenHashRef = useRef<string | null>(null);
  const lastEvalRequestAtRef = useRef<number | null>(null);
  const encodedPaneQuery = resolvedPaneQuery ? encodeURIComponent(resolvedPaneQuery) : "";
  const statusMode = isFinished ? "replay" : "live";
  const resolvedMode = variant === "tournament" ? statusMode : mode ?? statusMode;
  const baseHref = buildBroadcastBoardPath(board.boardId, resolvedMode, tournamentSlug);
  const querySuffix =
    typeof linkQuery === "string" ? linkQuery : resolvedPaneQuery ? `?pane=${encodedPaneQuery}` : "";
  const href = `${baseHref}${querySuffix}`;


  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const debugParam = params.get("debug") === "1";
    const debugVerboseParam = params.get("debugVerbose") === "1";
    setDebugFlags({
      debugLabelEnabled: debugParam,
      navDebugEnabled: debugParam,
      debugVerbose: debugParam && debugVerboseParam,
    });
  }, [debug]);

  const { debugLabelEnabled, navDebugEnabled, debugVerbose } = debugFlags;
  const shouldLog = debug;

  useEffect(() => {
    if (!navEval) return;
    if (Number.isFinite(Number(navEval.cp)) || Number.isFinite(Number(navEval.mate))) {
      lastStableNavEvalRef.current = navEval;
    }
  }, [navEval?.cp, navEval?.mate, navEval?.fenHash]);

  useEffect(() => {
    fenHashRef.current = fenHash;
  }, [fenHash]);

  useEffect(() => {
    if (!onDebugVisibilityChange) return;
    if (typeof window === "undefined") return;
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          onDebugVisibilityChange(board.boardId, entry.isIntersecting);
        });
      },
      { root: null, rootMargin: "0px", threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [board.boardId, onDebugVisibilityChange]);

  useEffect(() => {
    if (normalizedPreviewFen) {
      lastStableFenRef.current = normalizedPreviewFen;
    }
  }, [normalizedPreviewFen]);

  useEffect(() => {
    if (!fenHash) {
      setEngineEval(null);
      setLastPersistStatus(null);
      setLastEvalSource(null);
      setLiteStatus("idle");
      setStatusReason(null);
      lastEvaluatedFenHashRef.current = null;
      return;
    }
    const cached = MINI_EVAL_CACHE.get(evalCacheKey);
    if (cached) {
      const resolvedCached =
        viewerEvalBarsEnabled
          ? buildMiniEngineEval(normalizedPreviewFen, cached.cp ?? undefined, cached.mate ?? undefined, {
              mapToBar: true,
            }) ?? cached
          : cached;
      if (resolvedCached !== cached) {
        MINI_EVAL_CACHE.set(evalCacheKey, resolvedCached);
      }
      setEngineEval(resolvedCached);
      setLastLiteEval(resolvedCached);
      setLastLiteMeta({ source: "cache", cacheHit: true });
      setLiteStatus("cache");
      setLastEvalSource("lite");
      setStatusReason("memory-cache");
      if (navDebugEnabled) {
        const rawScore = Number.isFinite(Number(resolvedCached.mate))
          ? resolvedCached.mate
          : Number.isFinite(Number(resolvedCached.cp))
            ? resolvedCached.cp
            : null;
        console.log("NAV_EVAL_APPLY", {
          boardId: board.boardId,
          fenHash,
          rawScore,
          normalized: resolvedCached.value,
        });
      }
      lastEvaluatedFenHashRef.current = fenHash;
      return;
    }
    const stored = readMiniEvalStorage(fenHash, normalizedPreviewFen, {
      mapToBar: viewerEvalBarsEnabled,
    });
    setLastPersistStatus(stored.status);
    if (stored.eval) {
      MINI_EVAL_CACHE.set(evalCacheKey, stored.eval);
      setEngineEval(stored.eval);
      setLastLiteEval(stored.eval);
      setLastLiteMeta({ source: "cache", cacheHit: true });
      setLiteStatus("cache");
      setLastEvalSource("persist");
      setStatusReason("persist-hit");
      if (navDebugEnabled) {
        const rawScore = Number.isFinite(Number(stored.eval.mate))
          ? stored.eval.mate
          : Number.isFinite(Number(stored.eval.cp))
            ? stored.eval.cp
            : null;
        console.log("NAV_EVAL_APPLY", {
          boardId: board.boardId,
          fenHash,
          rawScore,
          normalized: stored.eval.value,
        });
      }
      lastEvaluatedFenHashRef.current = fenHash;
      return;
    }
    setEngineEval(null);
    setLastEvalSource(null);
    setLiteStatus("idle");
    setStatusReason(null);
  }, [board.boardId, evalCacheKey, fenHash, navDebugEnabled, normalizedPreviewFen, viewerEvalBarsEnabled]);

  useEffect(() => {
    if (autoEvalEnabled && !evalEnabled) {
      setEvalEnabled(true);
      setStatusReason("auto-enabled");
    }
  }, [autoEvalEnabled, evalEnabled]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || evalEnabled) return;
    setEvalEnabled(true);
    setStatusReason("always-enabled");
  }, [evalEnabled, viewerEvalBarsEnabled]);

  const startEvalArming = useCallback((durationMs: number) => {
    if (armingTimeoutRef.current) {
      clearTimeout(armingTimeoutRef.current);
    }
    setIsEvalArming(true);
    armingTimeoutRef.current = setTimeout(() => {
      setIsEvalArming(false);
      armingTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const runLiteEval = useCallback(
    async (source: "click" | "prefetch") => {
      if (externalEvalEnabled) return;
      const isClick = source === "click";
      const isPrefetch = source === "prefetch";
      const isEnableClick = isClick && enableClickRef.current;
      if (isClick && enableClickRef.current) {
        enableClickRef.current = false;
      }
      let nextClickCount = clickCounterRef.current;
      if (isClick) {
        nextClickCount = clickCounterRef.current + 1;
        clickCounterRef.current = nextClickCount;
        setClickCounter(nextClickCount);
        if (debugVerbose) {
          console.info("mini eval click", { boardId: board.boardId, fenHash, clickCounter: nextClickCount });
        }
      }
      if (!normalizedPreviewFen || !fenHash) {
        if (isClick) {
          setLiteStatus("error");
          setLastLiteEval(null);
          setLastLiteMeta(null);
          setLastPersistStatus(null);
          setStatusReason("missing-fen");
          setLastLiteError("missing fen");
          if (debugVerbose) {
            console.warn("mini eval early return", {
              reason: "missingFen",
              boardId: board.boardId,
              fenHash,
              clickCounter: nextClickCount,
            });
          }
        }
        return;
      }
      const requestFenHash = fenHash;
      const requestEvalKey = evalCacheKey;
      lastEvaluatedFenHashRef.current = fenHash;
      if (isClick) {
        const clickAt = Date.now();
        setLastClickAt(clickAt);
      }
      const forceFetch = isClick && debug;
      const queuedForceNonce = debug ? peekForceEval(board.boardId, fenHash) : null;
      const forceUpstream = Boolean(queuedForceNonce);
      const shouldForceFetch = forceFetch || forceUpstream;
      if (forceFetch) {
        setLastPersistStatus(null);
      }
      if (forceUpstream) {
        setStatusReason("debug-force-upstream");
      }
      if (!shouldForceFetch) {
        const cached = MINI_EVAL_CACHE.get(evalCacheKey);
        if (cached) {
          const resolvedCached =
            viewerEvalBarsEnabled
              ? buildMiniEngineEval(normalizedPreviewFen, cached.cp ?? undefined, cached.mate ?? undefined, {
                  mapToBar: true,
                }) ?? cached
              : cached;
          if (resolvedCached !== cached) {
            MINI_EVAL_CACHE.set(evalCacheKey, resolvedCached);
          }
          setEngineEval(resolvedCached);
          setLastLiteEval(resolvedCached);
          setLastLiteMeta({ source: "cache", cacheHit: true });
          setLastLiteError(null);
          setLiteStatus("cache");
          setLastEvalSource("lite");
          setStatusReason("memory-cache");
          if (navDebugEnabled) {
            const rawScore = Number.isFinite(Number(resolvedCached.mate))
              ? resolvedCached.mate
              : Number.isFinite(Number(resolvedCached.cp))
                ? resolvedCached.cp
                : null;
            console.log("NAV_EVAL_APPLY", {
              boardId: board.boardId,
              fenHash,
              rawScore,
              normalized: resolvedCached.value,
            });
          }
          if (isEnableClick) {
            startEvalArming(700);
          }
          if (debugVerbose && isClick) {
            console.info("mini eval early return", {
              reason: "cacheHit",
              boardId: board.boardId,
              fenHash,
              clickCounter: nextClickCount,
            });
          }
          if (isClick) {
            setLiteBadge("cached");
          }
          return;
        }
        const stored = readMiniEvalStorage(fenHash, normalizedPreviewFen, {
          mapToBar: viewerEvalBarsEnabled,
        });
        setLastPersistStatus(stored.status);
        if (stored.eval) {
          MINI_EVAL_CACHE.set(evalCacheKey, stored.eval);
          setEngineEval(stored.eval);
          setLastLiteEval(stored.eval);
          setLastLiteMeta({ source: "cache", cacheHit: true });
          setLastLiteError(null);
          setLiteStatus("cache");
          setLastEvalSource("persist");
          setStatusReason("persist-hit");
          if (navDebugEnabled) {
            const rawScore = Number.isFinite(Number(stored.eval.mate))
              ? stored.eval.mate
              : Number.isFinite(Number(stored.eval.cp))
                ? stored.eval.cp
                : null;
            console.log("NAV_EVAL_APPLY", {
              boardId: board.boardId,
              fenHash,
              rawScore,
              normalized: stored.eval.value,
            });
          }
          if (isEnableClick) {
            startEvalArming(700);
          }
          if (debugVerbose && isClick) {
            console.info("mini eval early return", {
              reason: "persistHit",
              boardId: board.boardId,
              fenHash,
              clickCounter: nextClickCount,
            });
          }
          if (isClick) {
            setLiteBadge("cached");
          }
          return;
        }
      }

      if (!shouldForceFetch) {
        const inflight = MINI_EVAL_INFLIGHT.get(evalCacheKey);
        if (inflight) {
          if (isPrefetch) return;
          setStatusReason("inflight");
          if (debugVerbose) {
            console.info("mini eval early return", {
              reason: "inflight",
              boardId: board.boardId,
              fenHash,
              clickCounter: nextClickCount,
            });
          }
          setIsEvalLoading(true);
          setLiteStatus("loading");
          try {
            const result = await inflight;
            setLastLiteMeta(result.meta);
            if (result.ok && result.eval) {
              if (fenHashRef.current !== requestFenHash || evalCacheKey !== requestEvalKey) return;
              setEngineEval(result.eval);
              setLastLiteEval(result.eval);
              setLiteStatus("success");
              setLastEvalSource("lite");
              setStatusReason("inflight-success");
              setLiteBadge("lite");
              if (navDebugEnabled) {
                const rawScore = Number.isFinite(Number(result.eval.mate))
                  ? result.eval.mate
                  : Number.isFinite(Number(result.eval.cp))
                    ? result.eval.cp
                    : null;
                console.log("NAV_EVAL_APPLY", {
                  boardId: board.boardId,
                  fenHash: requestFenHash,
                  rawScore,
                  normalized: result.eval.value,
                });
              }
              if (debugVerbose) {
                console.info("mini eval response applied", {
                  boardId: board.boardId,
                  fenHash,
                  clickCounter: nextClickCount,
                  status: result.status,
                  meta: result.meta,
                });
              }
            } else {
              setLiteStatus("error");
              setLastLiteError(result.errorMessage ?? "lite eval failed");
              setStatusReason("inflight-error");
              if (debugVerbose) {
                console.warn("mini eval response error", {
                  boardId: board.boardId,
                  fenHash,
                  clickCounter: nextClickCount,
                  status: result.status,
                  meta: result.meta,
                });
              }
            }
          } finally {
            setIsEvalLoading(false);
          }
          return;
        }
      }

      const now = Date.now();
      const lastRequestedFenHash = lastRequestedFenHashRef.current;
      if (lastRequestedFenHash === fenHash) {
        if (shouldLog) {
          console.info("mini eval skip", {
            reason: "same-fen",
            boardId: board.boardId,
            fenHash,
            clickCounter: nextClickCount,
          });
        }
        return;
      }
      const lastRequestedAt = lastEvalRequestAtRef.current;
      if (lastRequestedAt && now - lastRequestedAt < MINI_EVAL_COOLDOWN_MS) {
        if (shouldLog) {
          console.info("mini eval skip", {
            reason: "cooldown",
            boardId: board.boardId,
            fenHash,
            clickCounter: nextClickCount,
            elapsedMs: now - lastRequestedAt,
          });
        }
        return;
      }

      const requestId = `lite-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const payload = {
        boardId: board.boardId,
        fen: normalizedPreviewFen,
        movetimeMs: LITE_EVAL_MOVETIME_MS,
        multiPv: 1,
        requestId,
        searchMode: "time",
        profileId: "light",
      };

      const forceUpstreamNonce = forceUpstream ? consumeForceEval(board.boardId, fenHash) : null;
      const nonceValue =
        forceUpstreamNonce ?? (forceFetch ? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}` : "");
      const nonceParam = nonceValue ? `&nonce=${nonceValue}` : "";
      const debugParam = debug ? "&debug=1" : "";
      const requestUrl = `/api/engine/eval?mode=lite${debugParam}${nonceParam}`;
      if (shouldLog && (isClick || forceUpstream)) {
        console.info("mini eval request", {
          boardId: board.boardId,
          fenHash,
          clickCounter: nextClickCount,
          url: requestUrl,
          forced: forceUpstream,
        });
      }

      if (isClick && liteStatus === "error") {
        setRetryCount(prev => prev + 1);
      }
      if (isClick) {
        setLastLiteError(null);
        setLastLiteMeta(null);
      }

      const runRequest = async (): Promise<LiteEvalOutcome> => {
        const response = await fetch(requestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        const status = response.status;
        let json: LiteEvalApiResponse | null = null;
        try {
          json = (await response.json()) as LiteEvalApiResponse;
        } catch {
          json = null;
        }
        const meta = json?.debug ?? null;
        if (debugVerbose && isClick) {
          console.info("mini eval after response", {
            boardId: board.boardId,
            fenHash,
            clickCounter: nextClickCount,
            status,
            meta,
          });
        }
        if (!response.ok) {
          return {
            eval: null,
            meta,
            ok: false,
            status,
            errorMessage: json?.error ?? "lite eval failed",
          };
        }
        const line = Array.isArray(json?.lines) ? json.lines[0] : undefined;
        const evalResult = buildMiniEngineEval(normalizedPreviewFen, line?.scoreCp, line?.scoreMate, {
          mapToBar: viewerEvalBarsEnabled,
        });
        if (!evalResult) {
          return {
            eval: null,
            meta,
            ok: false,
            status,
            errorMessage: json?.error ?? "lite eval failed",
          };
        }
        return {
          eval: evalResult,
          meta,
          ok: true,
          status,
          errorMessage: null,
        };
      };

      lastRequestedFenHashRef.current = fenHash;
      lastEvalRequestAtRef.current = now;
      const requestPromise = runRequest();
      MINI_EVAL_INFLIGHT.set(evalCacheKey, requestPromise);
      if (isClick) {
        setIsEvalLoading(true);
        setLiteStatus("loading");
      }
      try {
        const result = await requestPromise;
        if (isClick) {
          setLastLiteMeta(result.meta);
        }
        if (result.ok && result.eval) {
          if (fenHashRef.current !== requestFenHash || evalCacheKey !== requestEvalKey) return;
          MINI_EVAL_CACHE.set(evalCacheKey, result.eval);
          writeMiniEvalStorage(fenHash, result.eval);
          setEngineEval(result.eval);
          setLastLiteEval(result.eval);
          setLiteStatus("success");
          setLastEvalSource("lite");
          setStatusReason(isClick ? "network-success" : "prefetch-success");
          if (isClick) {
            setLiteBadge("lite");
          }
          if (navDebugEnabled) {
            const rawScore = Number.isFinite(Number(result.eval.mate))
              ? result.eval.mate
              : Number.isFinite(Number(result.eval.cp))
                ? result.eval.cp
                : null;
            console.log("NAV_EVAL_APPLY", {
              boardId: board.boardId,
              fenHash: requestFenHash,
              rawScore,
              normalized: result.eval.value,
            });
          }
        } else if (isClick) {
          setLiteStatus("error");
          setLastLiteError(result.errorMessage ?? "lite eval failed");
          setStatusReason("network-error");
        }
      } finally {
        MINI_EVAL_INFLIGHT.delete(evalCacheKey);
        if (isClick) {
          setIsEvalLoading(false);
        }
      }
    },
    [
      board.boardId,
      debug,
      debugVerbose,
      evalCacheKey,
      externalEvalEnabled,
      fenHash,
      liteStatus,
      navDebugEnabled,
      normalizedPreviewFen,
      shouldLog,
      startEvalArming,
      viewerEvalBarsEnabled,
    ]
  );

  const handleEnableEval = useCallback(() => {
    if (externalEvalEnabled) return;
    if (viewerEvalBarsEnabled) return;
    if (evalEnabled) return;
    setEvalEnabled(true);
    setEnabledByUser(true);
    setStatusReason("enabled-gauge");
    enableClickRef.current = true;
    startEvalArming(1500);
    void runLiteEval("click");
  }, [evalEnabled, externalEvalEnabled, runLiteEval, startEvalArming, viewerEvalBarsEnabled]);

  const requestLiteEval = useCallback(async () => {
    if (externalEvalEnabled) return;
    await runLiteEval("click");
  }, [externalEvalEnabled, runLiteEval]);

  useEffect(() => {
    if (externalEvalEnabled) return;
    if (!evalEnabled) return;
    if (!viewerEvalBarsEnabled && !warmLiteEval && !enabledByUser && !autoEvalEnabled) return;
    if (!fenHash || !normalizedPreviewFen) return;
    const previousHash = lastEvaluatedFenHashRef.current;
    if (previousHash === fenHash) return;
    lastEvaluatedFenHashRef.current = fenHash;
    if (debugVerbose) {
      console.info("mini eval auto trigger", {
        boardId: board.boardId,
        previousHash,
        nextHash: fenHash,
        autoEnabled: autoEvalEnabled,
        enabledByUser,
      });
    }
    void runLiteEval("prefetch");
  }, [
    autoEvalEnabled,
    enabledByUser,
    evalEnabled,
    fenHash,
    normalizedPreviewFen,
    runLiteEval,
    debugVerbose,
    warmLiteEval,
    board.boardId,
    externalEvalEnabled,
    viewerEvalBarsEnabled,
  ]);

  useEffect(() => {
    if (!liteBadge) return;
    if (badgeTimeoutRef.current) {
      clearTimeout(badgeTimeoutRef.current);
    }
    badgeTimeoutRef.current = setTimeout(() => {
      setLiteBadge(null);
    }, 3000);
    return () => {
      if (badgeTimeoutRef.current) {
        clearTimeout(badgeTimeoutRef.current);
        badgeTimeoutRef.current = null;
      }
    };
  }, [liteBadge]);

  useEffect(() => {
    return () => {
      if (armingTimeoutRef.current) {
        clearTimeout(armingTimeoutRef.current);
        armingTimeoutRef.current = null;
      }
    };
  }, []);

  const focusClass =
    variant === "tournament"
      ? " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/50 focus-visible:-translate-y-0.5"
      : "";
  const compactHeightClass = variant === "tournament" ? "min-h-[70px]" : "min-h-[74px]";
  const regularHeightClass = variant === "tournament" ? "min-h-[74px]" : "min-h-[78px]";
  const baseClass = compact
    ? `relative flex w-full min-w-0 items-stretch gap-0.5 rounded-xl border px-2 py-[2px] ${compactHeightClass} transition-all duration-150 cursor-pointer shadow-sm${focusClass}`
    : `relative flex w-full min-w-0 items-stretch gap-1 rounded-2xl border px-2 py-[3px] ${regularHeightClass} transition-all duration-150 cursor-pointer shadow-sm${focusClass}`;
  const activeClass = resolvedActive
    ? "border-sky-100/90 bg-slate-800/95 ring-2 ring-sky-300/25 shadow-[0_14px_38px_rgba(56,189,248,0.16)]"
    : "border-slate-700/80 bg-slate-900/95";
  const hoverClass =
    variant === "tournament"
      ? resolvedActive
        ? "hover:-translate-y-0.5 hover:border-sky-100 hover:bg-slate-800/90 hover:shadow-[0_14px_36px_rgba(0,0,0,0.4)] hover:z-20"
        : "hover:-translate-y-0.5 hover:border-slate-500/85 hover:bg-slate-800/90 hover:shadow-[0_14px_36px_rgba(0,0,0,0.4)] hover:z-20"
      : resolvedActive
        ? "hover:border-sky-100 hover:bg-slate-800/90"
        : "hover:border-slate-500/85 hover:bg-slate-800/90 hover:shadow-[0_12px_34px_rgba(0,0,0,0.38)]";
  const evalFillPercent = engineEval ? engineEval.value : 50;
  const evalFillClass = engineEval ? "bg-emerald-400/80" : "bg-emerald-400/0";
  const resolvedNavEval = navEval ?? lastStableNavEvalRef.current;
  const hasResolvedNavEval =
    Boolean(resolvedNavEval) &&
    (Number.isFinite(Number(resolvedNavEval?.cp)) || Number.isFinite(Number(resolvedNavEval?.mate)));
  const viewerEvalDisplay = externalEvalEnabled
    ? hasResolvedNavEval
      ? resolvedNavEval
      : null
    : viewerEvalBarsEnabled
      ? engineEval ?? lastLiteEval
      : null;
  const mappingFen = normalizedPreviewFen || lastStableFenRef.current;
  const viewerEvalMapping =
    viewerEvalBarsEnabled &&
    viewerEvalDisplay &&
    (Number.isFinite(Number(viewerEvalDisplay.mate)) || Number.isFinite(Number(viewerEvalDisplay.cp)))
      ? mapEvaluationToBar(
          Number.isFinite(Number(viewerEvalDisplay.mate))
            ? { mate: Number(viewerEvalDisplay.mate) }
            : { cp: Number(viewerEvalDisplay.cp) },
          mappingFen
        )
      : null;
  const viewerEvalValue = viewerEvalMapping?.value ?? 50;
  const viewerEvalLabel = viewerEvalMapping?.label ?? "—";
  const viewerEvalAdvantage = viewerEvalMapping?.advantage ?? undefined;
  const tweenedEvalValue = useTweenedNumber(viewerEvalValue, { durationMs: 200 });
  const animatedEvalValue = typeof tweenedEvalValue === "number" ? tweenedEvalValue : viewerEvalValue;
  const evalAgeMs = typeof resolvedNavEval?.ts === "number" ? Date.now() - resolvedNavEval.ts : null;
  const pendingEval = Boolean(navEvalPending && !hasResolvedNavEval);
  const noDataEval = Boolean(navEvalNoData && !hasResolvedNavEval);
  const equalEval = Boolean(!pendingEval && !noDataEval && viewerEvalAdvantage === "equal");
  const evalState: "equal" | "advantage" | "pending" | "noData" = pendingEval
    ? "pending"
    : noDataEval
      ? "noData"
      : equalEval
        ? "equal"
        : "advantage";
  const viewerEvalPulseClass = isEvalLoading || isEvalArming || pendingEval ? "animate-pulse" : "";
  const scorePillWhite =
    isFinished && normalizedResult
      ? normalizedResult === "1-0"
        ? "1"
        : normalizedResult === "0-1"
          ? "0"
          : normalizedResult === "½-½"
            ? "½"
            : null
      : null;
  const scorePillBlack =
    isFinished && normalizedResult
      ? normalizedResult === "1-0"
        ? "0"
        : normalizedResult === "0-1"
          ? "1"
          : normalizedResult === "½-½"
            ? "½"
            : null
      : null;

  useEffect(() => {
    if (!viewerEvalBarsEnabled || !navDebugEnabled) return;
    console.log("NAV_BAR_VALUE", {
      boardId: board.boardId,
      normalizedUsed: viewerEvalValue,
    });
  }, [board.boardId, navDebugEnabled, viewerEvalBarsEnabled, viewerEvalValue]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || !navDebugEnabled) return;
    console.log("NAV_BAR_STATE", {
      boardId: board.boardId,
      state: evalState,
      hasEval: hasResolvedNavEval,
      cp: resolvedNavEval?.cp ?? null,
      mate: resolvedNavEval?.mate ?? null,
      ageMs: typeof evalAgeMs === "number" ? Math.max(0, Math.round(evalAgeMs)) : null,
    });
  }, [
    board.boardId,
    evalAgeMs,
    evalState,
    navDebugEnabled,
    resolvedNavEval?.cp,
    resolvedNavEval?.mate,
    viewerEvalBarsEnabled,
  ]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || !navDebugEnabled) return;
    const fenHash6 = navEval?.fenHash ? navEval.fenHash.slice(0, 6) : "";
    const hasEval =
      Boolean(navEval) &&
      (Number.isFinite(Number(navEval?.cp)) || Number.isFinite(Number(navEval?.mate)));
    console.log("NAV_CARD_EVAL_PROP", {
      boardId: board.boardId,
      hasEval,
      cp: navEval?.cp ?? null,
      mate: navEval?.mate ?? null,
      fenHash6,
    });
  }, [board.boardId, navDebugEnabled, viewerEvalBarsEnabled, navEval?.cp, navEval?.mate, navEval?.fenHash]);

  if (variant === "tournament") {
    const tournamentBaseClass = "relative flex w-full min-w-0 flex-col gap-0.5 rounded-2xl border px-1.5 py-1 transition-all duration-150 cursor-pointer shadow-sm";
    const heuristicFill = renderMiniEvalFill(board.miniEvalCp ?? null);
    const evalSource = engineEval ? (lastEvalSource ?? "lite") : "heuristic";
    const rawEvalValue =
      evalSource !== "heuristic" ? resolveLiteRawFillInput(normalizedPreviewFen, engineEval) : (board.miniEvalCp ?? null);
    const baseEvalValue = engineEval?.value ?? heuristicFill;
    const evalValue =
      debug && evalSource === "lite" ? applyMinVisibleDelta(baseEvalValue, 2) : baseEvalValue;
    const heuristicLabel = Number.isFinite(Number(board.miniEvalCp ?? NaN))
      ? formatEvalLabel(Number(board.miniEvalCp ?? 0) / 100)
      : "—";
    const evalLabel = engineEval?.label ?? heuristicLabel;
    const miniBoardOutline = debug ? "1px dashed rgba(56,189,248,0.9)" : undefined;
    const debugFill = Number.isFinite(evalValue) ? Math.max(0, Math.min(100, evalValue)).toFixed(2) : "--";
    const debugRawValue = Number.isFinite(Number(rawEvalValue)) ? Number(rawEvalValue).toFixed(1) : "--";
    const evalRailClass = "items-stretch";
    const hasEvalData = Boolean(engineEval) || Number.isFinite(Number(board.miniEvalCp ?? NaN));
    const evalTone = hasEvalData ? "active" : "idle";
    const liteDebugLabel = debugLabelEnabled
      ? [
          `lite:${liteStatus}${liteStatus === "error" && retryCount ? ` retry:${retryCount}` : ""} click:${clickCounter} fh:${fenHash || "--"} t:${lastClickAt ? new Date(lastClickAt).toISOString().slice(11, 19) : "--"}`,
          `eval:${lastLiteEval?.label ?? "--"} vsrc:${evalSource} raw:${debugRawValue} fill:${debugFill}`,
          `persist:${lastPersistStatus ?? "--"} reason:${statusReason ?? "--"} src:${lastLiteMeta?.source ?? "--"} cache:${lastLiteMeta?.cacheHit ?? "--"} up:${lastLiteMeta?.upstreamOk ?? "--"} us:${lastLiteMeta?.upstreamStatus ?? "--"}${lastLiteError ? ` err:${lastLiteError}` : ""}`,
        ].join("\n")
      : "";
    const miniBoardContainerClassName = "h-full w-full";
    return (
      <Link
        key={board.boardId}
        ref={rootRef}
        href={href}
        scroll={false}
        aria-pressed={resolvedActive}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (debug) {
            const gameIndex = Math.max(0, board.boardNumber - 1);
            console.log("BOARD_CLICK", {
              boardId: board.boardId,
              roundId: debugRoundId ?? null,
              gameIndex,
              route: href,
            });
          }
          if (!onBoardClick) return;
          const result = onBoardClick(board);
          if (result === false) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        className={`${tournamentBaseClass} ${activeClass} ${hoverClass}`}
      >
        <PlayerStrip
          player={board.black}
          scorePill={scorePillBlack}
          clockLabel={blackClockLabel}
          isTimeTrouble={isBlackInTimeTrouble}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-0">
          <div className="mx-auto w-full rounded-2xl border border-white/15 bg-slate-900/80 p-[1px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
            <div className="relative aspect-square w-full bg-slate-950/60">
              {normalizedPreviewFen ? (
                <div className="pointer-events-none h-full w-full">
                  <BroadcastReactBoard
                    boardId={`${board.boardId}-mini`}
                    position={normalizedPreviewFen}
                    boardOrientation="white"
                    variant="mini"
                    autoSize
                    autoSizeMode="width"
                    containerClassName={miniBoardContainerClassName}
                    boardStyleOverrides={{
                      borderRadius: "0px",
                      outline: miniBoardOutline,
                      outlineOffset: miniBoardOutline ? "-1px" : undefined,
                    }}
                  />
                </div>
              ) : (
                <div
                  className={`absolute inset-0 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950/70 via-slate-900/70 to-black/80 ${
                    !normalizedPreviewFen ? "animate-pulse" : ""
                  }`}
                />
              )}
            </div>
          </div>
          <div className={`relative ml-0.5 flex w-3 justify-center ${evalRailClass}`}>
            <button
              type="button"
              aria-label="Run lite evaluation"
              aria-busy={isEvalLoading}
              className="group relative flex h-full items-stretch transition-opacity duration-300"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                event.nativeEvent.stopImmediatePropagation?.();
                void requestLiteEval();
              }}
            >
              <EvalBar value={evalValue} scoreLabel={evalLabel} size="mini" orientation="white" tone={evalTone} />
              {liteBadge ? (
                <span className="pointer-events-none absolute -right-6 top-1.5 select-none rounded-full border border-slate-700/60 bg-slate-950/80 px-1.5 py-0.5 text-[9px] font-semibold text-slate-200 shadow-sm">
                  {liteBadge === "lite" ? "Lite" : "Cached"}
                  {liteBadge === "cached" && sharedFenCache ? (
                    <span className="pointer-events-none absolute left-1/2 top-5 w-max -translate-x-1/2 rounded-md border border-slate-700/60 bg-slate-950/90 px-2 py-1 text-[9px] font-semibold normal-case tracking-normal text-slate-200 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100">
                      Cached from identical position
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          </div>
        </div>
        <PlayerStrip
          player={board.white}
          scorePill={scorePillWhite}
          clockLabel={whiteClockLabel}
          isTimeTrouble={isWhiteInTimeTrouble}
        />
        {debugLabelEnabled ? (
          <div className="pointer-events-none rounded-xl border border-white/10 bg-slate-950/70 px-2 py-1 text-[10px] font-mono font-semibold leading-snug text-slate-500/80">
            <div className="max-h-[42px] overflow-hidden whitespace-pre-line">
              {liteDebugLabel}
            </div>
          </div>
        ) : null}
      </Link>
    );
  }

  return (
    <Link
      key={board.boardId}
      ref={rootRef}
      href={href}
      scroll={false}
      aria-pressed={resolvedActive}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (debug) {
          const gameIndex = Math.max(0, board.boardNumber - 1);
          console.log("BOARD_CLICK", {
            boardId: board.boardId,
            roundId: debugRoundId ?? null,
            gameIndex,
            route: href,
          });
        }
        if (!onBoardClick) return;
        const result = onBoardClick(board);
        if (result === false) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={`${baseClass} ${activeClass} ${hoverClass} group overflow-hidden`}
    >
      <div
        className={`flex shrink-0 self-center items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/80 text-center ${
          compact ? "h-8 w-8 px-0.5" : "h-9 w-9 px-1"
        }`}
      >
        <span
          className={`inline-flex items-center justify-center rounded-md border border-slate-600/70 bg-slate-800/70 font-semibold leading-tight text-slate-50 tabular-nums ${
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
          }`}
        >
          #{board.boardNumber}
        </span>
      </div>

      <div className={`flex min-w-0 flex-1 flex-col justify-center ${compact ? "gap-0.5" : "gap-[2px]"}`}>
        <div className={`transition-colors duration-200 ${showClocks && isWhiteInTimeTrouble ? "text-rose-50" : ""}`}>
          <PlayerLine player={board.white} compact={compact} scorePill={scorePillWhite} />
        </div>
        {showClocks ? (
          <div className={`mx-auto flex justify-center ${compact ? "w-[112px]" : "w-[128px]"}`}>
            <div className={`flex w-full flex-nowrap items-center justify-center ${compact ? "gap-1" : "gap-1.5"}`}>
              <span
                className={`${pillBase} bg-slate-800/80 transition-colors transition-shadow duration-200 ${
                  compact ? pillSm : pillMd
                } ${
                  isWhiteInTimeTrouble
                    ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
                    : "border-slate-600/60 text-slate-100"
                }`}
              >
                {whiteTimeLabel ?? "—:—"}
              </span>
              <span
                className={`${pillBase} bg-slate-800/80 transition-colors transition-shadow duration-200 ${
                  compact ? pillSm : pillMd
                } ${
                  isBlackInTimeTrouble
                    ? "border-rose-400/70 text-rose-50 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]"
                    : "border-slate-600/60 text-slate-100"
                }`}
              >
                {blackTimeLabel ?? "—:—"}
              </span>
            </div>
          </div>
        ) : null}
        <div className={`transition-colors duration-200 ${showClocks && isBlackInTimeTrouble ? "text-rose-50" : ""}`}>
          <PlayerLine player={board.black} compact={compact} scorePill={scorePillBlack} />
        </div>
      </div>

      {viewerEvalBarsEnabled ? (
        <div className={`flex shrink-0 items-stretch ${compact ? "w-5" : "w-6"} pl-1`}>
          <button
            type="button"
            aria-label={evalEnabled ? "Run lite evaluation" : "Enable evaluation"}
            aria-busy={isEvalLoading}
            className={`flex h-full w-full items-stretch justify-center py-1 transition ${viewerEvalPulseClass}`}
            title={undefined}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation?.();
              void requestLiteEval();
            }}
          >
              <span className="relative flex h-full items-stretch">
                <EvalBar
                  value={animatedEvalValue}
                  scoreLabel={viewerEvalLabel}
                  advantage={viewerEvalAdvantage}
                  size="mini"
                  orientation="white"
                  showLabel={false}
                  tone={pendingEval || noDataEval ? "idle" : "active"}
                />
                {equalEval ? (
                  <span className="pointer-events-none absolute inset-x-0 top-1.5 flex justify-center text-[9px] font-semibold text-slate-200/80">
                    =
                  </span>
                ) : null}
                {pendingEval ? (
                  <span className="pointer-events-none absolute inset-x-0 top-1.5 flex justify-center text-[9px] font-semibold text-slate-200/70">
                    …
                  </span>
                ) : null}
              </span>
          </button>
        </div>
      ) : (
        <div className={`relative flex shrink-0 items-stretch ${compact ? "w-6" : "w-7"}`} aria-hidden={evalEnabled}>
          <div className="absolute inset-y-1 right-1.5 flex items-center justify-center">
            {evalEnabled ? (
              <div
                className={`relative w-3 overflow-hidden rounded-full border border-slate-700/60 bg-slate-800 ${
                  compact ? "h-9" : "h-10"
                }`}
              >
                <div className="absolute inset-x-[-2px] top-1/2 h-px bg-amber-200/80" />
                <div className={`absolute inset-x-0 bottom-0 w-full ${evalFillClass}`} style={{ height: `${evalFillPercent}%` }} />
              </div>
            ) : (
              <button
                type="button"
                aria-label="Enable evaluation"
                className={`flex items-center justify-center rounded-full border border-white/20 bg-slate-900/80 text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200 ${
                  compact ? "h-6 w-6" : "h-7 w-7"
                }`}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.nativeEvent.stopImmediatePropagation?.();
                  handleEnableEval();
                }}
              >
                <Activity size={compact ? 12 : 13} />
              </button>
            )}
          </div>
        </div>
      )}

      {debugLabelEnabled ? (
        <span className="absolute bottom-1 right-2 max-w-[220px] overflow-hidden text-[9px] font-mono font-semibold leading-snug text-slate-500/80">
          {board.boardId} | {fenHash.slice(0, 6) || "--"} | {engineEval?.label ?? "--"}
        </span>
      ) : null}

      {resolvedActive ? (
        <>
          <span
            className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-sky-200 via-sky-300 to-emerald-300"
            aria-hidden
          />
          <span className="absolute inset-x-2 top-0 h-px bg-sky-200/70" aria-hidden />
        </>
      ) : null}
    </Link>
  );
};
