"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BoardControls from "@/components/live/BoardControls";
import MainEvalBar from "@/components/live/MainEvalBar";
import RightPaneTabs from "@/components/live/RightPaneTabs";
import type { BoardSwitcherOption } from "@/components/tournament/BoardSwitcher";
import AnimatedBoardPane from "@/components/viewer/AnimatedBoardPane";
import BroadcastReactBoard from "@/components/viewer/BroadcastReactBoard";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import type { Ply } from "@/lib/chess/pgn";
import { buildBoardIdentifier, normalizeBoardIdentifier } from "@/lib/boardId";
import { getTournamentBoardsForRound, getTournamentGameManifest } from "@/lib/tournamentManifest";
import type { GameResult, GameStatus } from "@/lib/tournamentManifest";
import type { StockfishEval, StockfishLine } from "@/lib/engine/useStockfishEvaluation";
import type { EngineBackend, EngineProfileConfig, EngineProfileId } from "@/lib/engine/config";
import type { EvaluationAdvantage } from "@/lib/engine/evalMapping";

type Orientation = "white" | "black";

type ScoreVariant = "winner" | "loser" | "draw" | "neutral";

type PlayerCardProps = {
  name: string;
  rating: number | string;
  countryCode: string;
  flag: string;
  title?: string | null;
  clockLabel: string;
  clockMs?: number | null;
  clockIncrementMs?: number | null;
  score?: string;
  scoreVariant?: ScoreVariant;
};

type VideoPaneProps = {
  containerRef?: RefObject<HTMLDivElement | null>;
  innerRef?: RefObject<HTMLDivElement | null>;
  content?: ReactNode;
  statusPill?: { label: string; className: string };
  secondaryPill?: string | null;
  overlay?: ReactNode;
  controlsOverlay?: ReactNode;
  footer?: ReactNode;
};

type NotationProps = {
  engineOn: boolean;
  setEngineOn: (next: boolean | ((prev: boolean) => boolean)) => void;
  plies: Ply[];
  currentMoveIndex: number;
  onMoveSelect: (idx: number) => void;
  engineEval?: StockfishEval;
  engineLines?: StockfishLine[];
  engineName?: string;
  engineBackend?: EngineBackend;
  setEngineBackend?: (backend: EngineBackend) => void;
  multiPv?: number;
  depthIndex?: number;
  depthSteps?: number[];
  targetDepth?: number;
  setMultiPv?: (value: number) => void;
  setDepthIndex?: (value: number) => void;
  fen?: string | null;
  engineProfileId?: EngineProfileId;
  engineProfile?: EngineProfileConfig;
  setEngineProfileId?: (value: EngineProfileId) => void;
};

const normalizeResult = (result?: GameResult | null): GameResult => {
  if (!result || result === "*") return "·";
  return result === "1/2-1/2" ? "½-½" : result;
};

const derivePlayerPoints = (
  result?: GameResult | null,
  status?: GameStatus | null
): {
  white: { score: string; variant: ScoreVariant };
  black: { score: string; variant: ScoreVariant };
} => {
  const normalized = normalizeResult(result);
  const isFinal = status === "final";

  if (isFinal && normalized === "1-0") {
    return {
      white: { score: "1", variant: "winner" },
      black: { score: "0", variant: "loser" },
    };
  }
  if (isFinal && normalized === "0-1") {
    return {
      white: { score: "0", variant: "loser" },
      black: { score: "1", variant: "winner" },
    };
  }
  if (isFinal && normalized === "½-½") {
    return {
      white: { score: "½", variant: "draw" },
      black: { score: "½", variant: "draw" },
    };
  }

  return {
    white: { score: "0", variant: "neutral" },
    black: { score: "0", variant: "neutral" },
  };
};

const scorePillClasses = (variant: ScoreVariant) => {
  void variant; // variant preserved for potential future use
  return "border-slate-600 bg-slate-900 text-slate-200";
};

const COMPACT_NAME_MAX = 18;
const DEFAULT_NAME_MAX = 24;
const CLOCK_LOW_SECONDS = 120;
const CLOCK_CRITICAL_SECONDS = 30;

const formatPlayerDisplayName = (name: string, maxLength: number) => {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return { label: name, shouldTruncate: false };
  }
  if (cleaned.length <= maxLength) {
    return { label: cleaned, shouldTruncate: false };
  }

  const parts = cleaned.split(" ");
  if (parts.length < 2) {
    return { label: cleaned, shouldTruncate: true };
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  const second = parts[1];

  const initialFrom = (value: string) => {
    const letters = value.replace(/[^A-Za-z]/g, "");
    const base = letters.length > 0 ? letters[0] : value[0] ?? "";
    return base ? `${base}.` : "";
  };

  const candidates: string[] = [];
  const middleLetters = second.replace(/[^A-Za-z]/g, "");
  if (parts.length > 2 && middleLetters.length === 1) {
    const middleInitial = initialFrom(second);
    if (middleInitial) candidates.push(`${first} ${middleInitial}`);
  }

  const firstInitial = initialFrom(first);
  if (firstInitial) candidates.push(`${firstInitial} ${last}`);

  const lastInitial = initialFrom(last);
  if (lastInitial) candidates.push(`${first} ${lastInitial}`);

  for (const candidate of candidates) {
    if (candidate.length <= maxLength) {
      return { label: candidate, shouldTruncate: false };
    }
  }

  if (last.length <= maxLength) {
    return { label: last, shouldTruncate: false };
  }
  const fallback = candidates[0] ?? cleaned;
  return { label: fallback, shouldTruncate: fallback.length > maxLength };
};

const parseClockLabelSeconds = (label?: string | null) => {
  if (!label) return null;
  const cleaned = label.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(":").map(part => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some(part => part.length === 0 || !/^\d+$/.test(part))) return null;
  const numeric = parts.map(part => Number(part));
  if (numeric.some(value => !Number.isFinite(value))) return null;
  if (numeric.length === 2) {
    return numeric[0] * 60 + numeric[1];
  }
  return numeric[0] * 3600 + numeric[1] * 60 + numeric[2];
};

const resolveClockSeconds = (label: string, clockMs?: number | null) => {
  if (Number.isFinite(clockMs ?? NaN)) {
    return Math.max(0, Math.floor((clockMs as number) / 1000));
  }
  return parseClockLabelSeconds(label);
};

const BOARD_SCAN_LIMIT = 20;

type ViewerShellProps = {
  mode: "live" | "replay";
  headerTitle: string;
  headerControls?: ReactNode;
  boardId: string;
  boardDomId?: string;
  boardOrientation: Orientation;
  boardPosition: string;
  onPieceDrop?: (sourceSquare: string, targetSquare: string, piece: string) => boolean;
  analysisViewActive?: boolean;
  analysisBranches?: Array<{
    anchorPly: number;
    anchorFullmoveNumber: number;
    anchorTurn: "w" | "b";
    startFen: string;
    rootChildren: string[];
    rootMainChildId: string | null;
    nodesById: Record<
      string,
      {
        id: string;
        san: string;
        fenAfter: string;
        parentId: string | null;
        children: string[];
        mainChildId: string | null;
      }
    >;
  }> | null;
  activeAnalysisAnchorPly?: number | null;
  analysisCursorNodeId?: string | null;
  onExitAnalysisView?: () => void;
  onSelectAnalysisMove?: (anchorPly: number, nodeId: string | null) => void;
  onPromoteAnalysisNode?: (anchorPly: number, nodeId: string) => void;
  onDeleteAnalysisLine?: (anchorPly: number, nodeId: string) => void;
  onDeleteAnalysisFromHere?: (anchorPly: number, nodeId: string) => void;
  showEval: boolean;
  evaluation?: number | null;
  evaluationLabel?: string | null;
  evaluationAdvantage?: EvaluationAdvantage;
  engineEnabled?: boolean;
  engineThinking?: boolean;
  onToggleEval?: () => void;
  onPrev: () => void;
  onLive: () => void;
  onNext: () => void;
  onFlip: () => void;
  canPrev: boolean;
  canNext: boolean;
  liveActive: boolean;
  boardResult?: GameResult | null;
  boardStatus?: GameStatus | null;
  players: {
    white: PlayerCardProps;
    black: PlayerCardProps;
  };
  tournamentHref?: string | null;
  tournamentLabel?: string | null;
  boardSwitcherOptions?: BoardSwitcherOption[] | null;
  currentBoardId?: string;
  currentBoardLabel?: string;
  canonicalPath?: string | null;
  latestReplayPath?: string | null;
  replayPath?: string | null;
  previousBoardHref?: string | null;
  nextBoardHref?: string | null;
  boardNumber?: number | null;
  videoPane: VideoPaneProps;
  notation: NotationProps;
  mediaContainerClass?: string;
  mainClassName?: string;
  contentClassName?: string;
  density?: "default" | "compact";
  variant?: "full" | "mini";
  statsOverlay?: ReactNode;
  liveVersion?: number;
  onBoardSelect?: (board: BoardNavigationEntry) => boolean | void;
};

export function ViewerShell({
  mode,
  headerTitle,
  headerControls,
  boardId,
  boardDomId = boardId,
  boardOrientation,
  boardPosition,
  onPieceDrop,
  analysisViewActive = false,
  analysisBranches,
  activeAnalysisAnchorPly,
  analysisCursorNodeId,
  onExitAnalysisView,
  onSelectAnalysisMove,
  onPromoteAnalysisNode,
  onDeleteAnalysisLine,
  onDeleteAnalysisFromHere,
  showEval,
  evaluation,
  evaluationLabel,
  evaluationAdvantage,
  engineEnabled: _engineEnabled = true,
  engineThinking: _engineThinking = false,
  onToggleEval,
  onPrev,
  onLive,
  onNext,
  onFlip,
  canPrev,
  canNext,
  liveActive,
  boardResult,
  boardStatus,
  players,
  videoPane,
  notation,
  mediaContainerClass,
  mainClassName,
  contentClassName,
  density,
  variant = "full",
  statsOverlay,
  liveVersion = 0,
  onBoardSelect,
}: ViewerShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMini = variant === "mini";
  const resolvedDensity = density ?? (isMini ? "compact" : "default");
  const isCompact = resolvedDensity === "compact";
  const boardFallbackSize = isMini ? 320 : 520;
  const miniGutterWidth = isCompact ? 20 : 22;
  const miniGapPx = isCompact ? 6 : 8;
  const [miniBoardSize, setMiniBoardSize] = useState<number>(boardFallbackSize);
  const miniBoardContainerRef = useRef<HTMLDivElement | null>(null);
  const upsellParam = searchParams?.get("upsell");
  const returnToParam = searchParams?.get("returnTo");
  const sanitizedReturnTo = useMemo(() => {
    if (!returnToParam) return "/";
    const trimmed = returnToParam.trim();
    if (!trimmed.startsWith("/")) return "/";
    return trimmed;
  }, [returnToParam]);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const resolvedMainClassName =
    mainClassName ??
    (isCompact
      ? `flex h-full min-h-0 flex-col bg-transparent text-slate-100 overflow-hidden${
          isMini ? " w-full min-w-0" : ""
        }`
      : "flex min-h-screen h-[100dvh] flex-col bg-slate-950 text-slate-100 overflow-hidden");
  const resolvedContentClassName =
    contentClassName ??
    (isCompact
      ? `mx-auto flex-1 w-full min-h-0 px-2 py-2${isMini ? " min-w-0" : ""}`
      : "mx-auto flex-1 w-full max-w-[1440px] px-4 py-1.5 lg:px-8");
  const resolvedMediaContainerClass =
    mediaContainerClass ??
    (isMini
      ? "relative mx-auto w-full max-w-[720px] aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm"
      : isCompact
        ? "aspect-video w-full max-h-[24vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[28vh]"
        : "aspect-video w-full max-h-[52vh] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-sm lg:aspect-[16/8.5] lg:max-h-[60vh]");
  const { white, black } = players;
  const normalizedBoardResult = normalizeResult(boardResult);
  const playerPoints = derivePlayerPoints(normalizedBoardResult, boardStatus ?? null);
  const statusPill = videoPane.statusPill ?? {
    label: mode === "live" ? "LIVE" : "REPLAY",
    className: mode === "live" ? "bg-red-600 text-white" : "bg-blue-600/80 text-white",
  };
  const isWhiteAtBottom = boardOrientation === "white";
  const topPlayer = isWhiteAtBottom ? black : white;
  const bottomPlayer = isWhiteAtBottom ? white : black;
  const topPoints = isWhiteAtBottom ? playerPoints.black : playerPoints.white;
  const bottomPoints = isWhiteAtBottom ? playerPoints.white : playerPoints.black;
  const normalizedEvalLabel = evaluationLabel ?? "-";
  const normalizedAdvantage = evaluationAdvantage ?? "equal";
  const analysisDisplayed =
    analysisViewActive &&
    typeof activeAnalysisAnchorPly === "number" &&
    Array.isArray(analysisBranches) &&
    analysisBranches.some(branch => branch.anchorPly === activeAnalysisAnchorPly);
  const isViewingOfficialLivePosition = liveActive && !analysisDisplayed;
  const gameIsRealtimeLive = mode === "live" && boardStatus === "live";
  const liveButtonNeutral = !gameIsRealtimeLive || isViewingOfficialLivePosition;
  const emptyBoardNavLogRef = useRef<string | null>(null);
  const handleUpsellClose = useCallback(() => {
    setUpsellOpen(false);
    router.replace(sanitizedReturnTo);
  }, [router, sanitizedReturnTo]);
  const playerRowClass = isMini
    ? "relative grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-2.5 py-2 text-[10px] text-slate-200 sm:text-[11px]"
    : isCompact
      ? "relative flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-2.5 py-2 text-[10px] text-slate-200 sm:text-[11px]"
      : "relative flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-[11px] text-slate-200 sm:text-xs";
  const playerLeftClusterClass = "flex min-w-0 flex-1 items-center gap-2.5";
  const playerNameStackClass = "flex min-w-0 flex-1 flex-col gap-1.5";
  const playerNameRowClass = "flex w-full min-w-0 items-center gap-2.5";
  const playerTitleClass = isCompact
    ? "rounded-full border border-amber-200/50 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-100"
    : "rounded-full border border-amber-200/50 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100";
  const playerNameClass = isCompact
    ? "text-sm font-semibold text-white sm:text-base"
    : "text-base font-semibold text-white sm:text-lg";
  const playerMetaClass = isCompact
    ? "text-[9px] text-slate-500 sm:text-[10px]"
    : "text-[10px] text-slate-500 sm:text-[11px]";
  const playerCountryClass = isCompact
    ? "text-[9px] uppercase tracking-wide text-slate-500 sm:text-[10px]"
    : "text-[10px] uppercase tracking-wide text-slate-500 sm:text-[11px]";
  const scorePillClass = isCompact
    ? "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight"
    : "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-tight";
  const clockClass = isCompact
    ? "rounded-full border border-white/10 bg-slate-900/70 px-2 py-0.5 font-mono text-[9px] tracking-tight text-slate-200 shadow-inner sm:text-[10px]"
    : "rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 font-mono text-[11px] tracking-tight text-white shadow-inner sm:text-xs";
  const rightClusterClass = isMini
    ? "flex w-[80px] flex-none flex-col items-end gap-1"
    : "flex shrink-0 items-center gap-1.5 sm:gap-2";
  const nameMaxLength = isCompact ? COMPACT_NAME_MAX : DEFAULT_NAME_MAX;
  const showBroadcastCues = isMini;
  const activeColor = boardPosition.trim().split(/\s+/)[1];
  const toMoveColor =
    activeColor === "w" ? "white" : activeColor === "b" ? "black" : null;
  const topRowColor = isWhiteAtBottom ? "black" : "white";
  const bottomRowColor = isWhiteAtBottom ? "white" : "black";
  const renderPlayerRow = (
    player: PlayerCardProps,
    points: { score: string; variant: ScoreVariant },
    options?: { showAnalysis?: boolean; rowColor?: "white" | "black"; isToMove?: boolean }
  ) => {
    const { label: displayName, shouldTruncate } = formatPlayerDisplayName(player.name, nameMaxLength);
    const clockSeconds = resolveClockSeconds(player.clockLabel, player.clockMs);
    const clockUrgencyClass =
      showBroadcastCues && typeof clockSeconds === "number"
        ? clockSeconds <= CLOCK_CRITICAL_SECONDS
          ? "border-rose-300/70 bg-rose-500/15 text-rose-100 ring-1 ring-rose-300/30"
          : clockSeconds <= CLOCK_LOW_SECONDS
            ? "border-amber-300/60 bg-amber-400/10 text-amber-100"
            : ""
        : "";
    const incrementSeconds = Number.isFinite(player.clockIncrementMs ?? NaN)
      ? Math.round((player.clockIncrementMs as number) / 1000)
      : null;
    const incrementLabel = incrementSeconds && incrementSeconds > 0 ? `+${incrementSeconds}` : null;
    const rowColor = options?.rowColor ?? "white";
    const accentClass =
      rowColor === "white" ? "bg-white/25" : "bg-slate-700/60";
    return (
      <div className={playerRowClass}>
        {showBroadcastCues ? (
          <span
            aria-hidden
            className={`pointer-events-none absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${accentClass}`}
          />
        ) : null}
        <div className={playerLeftClusterClass}>
          <span className="flex items-center justify-center text-base leading-none" aria-hidden>
            {player.flag}
          </span>
          <div className={playerNameStackClass}>
            <div className={playerNameRowClass}>
              {player.title ? (
                <span className={playerTitleClass}>
                  {player.title}
                </span>
              ) : null}
              <span
                className={`${playerNameClass} min-w-0 flex-1 whitespace-nowrap ${
                  shouldTruncate ? "truncate" : ""
                }`}
              >
                {displayName}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`${playerMetaClass} rating-text`}>{player.rating}</span>
              <span className="text-slate-600" aria-hidden>
                &middot;
              </span>
              <span className={`${playerCountryClass} rating-text`}>{player.countryCode}</span>
            </div>
          </div>
        </div>
        <div className={rightClusterClass}>
          {options?.showAnalysis ? (
            <span className="rounded-full border border-rose-300/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-100">
              Analysis
            </span>
          ) : null}
          <div className="flex items-center justify-end gap-1.5">
            {showBroadcastCues && options?.isToMove ? (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-emerald-300/70 ring-1 ring-emerald-200/40 animate-pulse"
              />
            ) : null}
            <span className={`${scorePillClass} ${scorePillClasses(points.variant)}`}>{points.score}</span>
          </div>
          <div className={`${clockClass} ${clockUrgencyClass} relative`}>
            {player.clockLabel}
            {incrementLabel ? (
              <span className="pointer-events-none absolute left-full ml-1 text-[8px] font-semibold text-slate-400">
                {incrementLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (isMini) {
      setUpsellOpen(false);
      return;
    }
    setUpsellOpen(upsellParam === "1");
  }, [isMini, upsellParam]);

  useEffect(() => {
    if (!upsellOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleUpsellClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleUpsellClose, upsellOpen]);

  const boardNavigation = useMemo(() => {
    const { normalizedBoardId, parsed } = normalizeBoardIdentifier(boardId);
    const boardNumbers =
      getTournamentBoardsForRound(parsed.tournamentSlug, parsed.round) ??
      Array.from({ length: BOARD_SCAN_LIMIT }, (_, idx) => idx + 1);

    const fromFeed = boardNumbers
      .map(boardNum => {
        const game = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, boardNum);
        if (!game) return null;
        const normalizedResult = normalizeResult(game.result);
        const normalizedStatus: GameStatus =
          game.status ??
          (normalizedResult && normalizedResult !== "·" ? "final" : "live");
        return {
          boardId: buildBoardIdentifier(parsed.tournamentSlug, parsed.round, boardNum),
          boardNumber: boardNum,
          result: normalizedResult,
          status: normalizedStatus,
          whiteTimeMs: game.whiteTimeMs ?? 5 * 60 * 1000,
          blackTimeMs: game.blackTimeMs ?? 5 * 60 * 1000,
          sideToMove: game.sideToMove ?? "white",
          finalFen: game.finalFen ?? null,
          moveList: game.moveList ?? null,
          evaluation: game.evaluation ?? null,
          white: {
            name: game.white,
            title: game.whiteTitle,
            rating: game.whiteRating,
            flag: game.whiteFlag,
          },
          black: {
            name: game.black,
            title: game.blackTitle,
            rating: game.blackRating,
            flag: game.blackFlag,
          },
        } as BoardNavigationEntry;
      })
      .filter((entry): entry is BoardNavigationEntry => Boolean(entry));

    const debug = {
      incomingBoardId: boardId,
      normalizedBoardId,
      tournamentKey: parsed.tournamentSlug,
      roundKey: String(parsed.round),
      feedCount: fromFeed.length,
    };

    if (fromFeed.length > 0) {
      return { boards: fromFeed, normalizedBoardId, source: "feed" as const, debug };
    }

    const fromManifestFallback: BoardNavigationEntry[] = boardNumbers.map(boardNum => ({
      boardId: buildBoardIdentifier(parsed.tournamentSlug, parsed.round, boardNum),
      boardNumber: boardNum,
      status: "unknown",
      result: null,
      evaluation: null,
      whiteTimeMs: null,
      blackTimeMs: null,
      sideToMove: null,
      finalFen: null,
      moveList: null,
      white: { name: "TBD", title: null },
      black: { name: "TBD", title: null },
    }));

    return {
      boards: fromManifestFallback,
      normalizedBoardId,
      source: "manifest" as const,
      debug: { ...debug, manifestCount: fromManifestFallback.length },
    };
  }, [boardId, liveVersion]);

  useEffect(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
    if (!boardNavigation || boardNavigation.boards.length > 0) return;
    const debug = boardNavigation.debug;
    const marker = `${debug.incomingBoardId}|${debug.normalizedBoardId}|${debug.tournamentKey}|${debug.roundKey}`;
    if (emptyBoardNavLogRef.current === marker) return;
    emptyBoardNavLogRef.current = marker;
    console.warn("[boards-navigation] empty boards list", {
      incomingBoardId: debug.incomingBoardId,
      normalizedBoardId: debug.normalizedBoardId,
      tournamentKey: debug.tournamentKey,
      roundKey: debug.roundKey,
      source: boardNavigation.source,
      feedCount: debug.feedCount,
      manifestCount: "manifestCount" in debug ? debug.manifestCount : undefined,
    });
  }, [boardNavigation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFlipHotkey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== "f" && event.key !== "F") return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      onFlip();
    };
    window.addEventListener("keydown", handleFlipHotkey, { capture: true });
    return () => window.removeEventListener("keydown", handleFlipHotkey, { capture: true } as AddEventListenerOptions);
  }, [onFlip]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!analysisViewActive) return;

      if (mode === "live") {
        onLive();
        return;
      }

      onExitAnalysisView?.();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () =>
      window.removeEventListener(
        "keydown",
        handleEscape,
        { capture: true } as AddEventListenerOptions
      );
  }, [analysisViewActive, mode, onExitAnalysisView, onLive]);

  useEffect(() => {
    if (!isMini) return;
    const container = miniBoardContainerRef.current;
    if (!container) return;

    const update = () => {
      const rect = container.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return;
      if (rect.width <= 0 || rect.height <= 0) return;
      const containerPadding = 8;
      const boardPadding = 4;
      const availableWidth = rect.width - containerPadding * 2;
      const availableHeight = rect.height - containerPadding * 2;
      if (availableWidth <= 0 || availableHeight <= 0) return;
      const maxBoardWidth = availableWidth - miniGutterWidth - miniGapPx;
      if (maxBoardWidth <= 0) return;
      const nextSize = Math.floor(Math.min(maxBoardWidth, availableHeight) - boardPadding);
      if (!Number.isFinite(nextSize) || nextSize <= 0) return;
      setMiniBoardSize(prev => (prev === nextSize ? prev : nextSize));
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(container);
    return () => observer.disconnect();
  }, [isMini, miniGapPx, miniGutterWidth]);

  const layoutClassName = `flex flex-1 min-h-0 flex-col overflow-hidden lg:flex-row lg:items-stretch ${
    isCompact ? "gap-2 sm:gap-3" : "gap-3 sm:gap-4"
  }`;
  const boardSectionClassName = `flex min-h-0 w-full flex-1 flex-col border border-white/10 bg-slate-950/80 shadow-xl ring-1 ring-white/5 lg:h-full ${
    isMini ? "lg:flex-[1]" : "lg:flex-[0.9]"
  } ${isMini ? "" : "mx-auto"} ${
    isMini ? "max-w-none" : isCompact ? "max-w-[520px]" : "max-w-[620px]"
  } ${isCompact ? "gap-1 rounded-2xl p-2" : "gap-1.5 rounded-3xl p-3"}`;
  const boardShellClassName = `flex min-h-0 flex-1 flex-col border border-slate-800/70 bg-slate-950/80 shadow-inner ${
    isCompact ? "gap-2 rounded-2xl p-2 sm:p-2.5" : "gap-2.5 rounded-3xl p-3 sm:p-3.5"
  }`;
  const boardStackClassName = isCompact ? "space-y-1.5 sm:space-y-2" : "space-y-2 sm:space-y-2.5";
  const boardRowClassName = isCompact
    ? "grid items-stretch gap-0 md:gap-2 grid-cols-[0_minmax(0,1fr)] md:grid-cols-[24px_minmax(0,1fr)]"
    : "grid items-stretch gap-0 md:gap-3 grid-cols-[0_minmax(0,1fr)] md:grid-cols-[28px_minmax(0,1fr)]";
  const boardSizerClassName = "relative min-w-0 flex-1";
  const evalBarGutterClassName = "flex min-h-0 items-center justify-center";
  const miniBoardRowClassName = isCompact
    ? "grid min-h-0 items-stretch gap-1.5 grid-cols-[20px_minmax(0,1fr)]"
    : "grid min-h-0 items-stretch gap-2 grid-cols-[22px_minmax(0,1fr)]";
  const miniBoardFrameStyle = isMini
    ? { width: miniBoardSize + miniGutterWidth + miniGapPx, height: miniBoardSize }
    : undefined;
  const miniLayoutClassName =
    "grid min-h-0 w-full flex-1 min-w-0 grid-cols-[280px_minmax(480px,1.25fr)_minmax(0,2fr)] gap-3";
  const miniLeftColumnClassName = "flex min-h-0 w-full flex-col min-w-0 max-w-[280px]";
  const boardAutoSizeMode = isMini ? "contain" : "width";
  const boardContainerClassName = isMini
    ? "flex h-full min-h-0 w-full items-center justify-center"
    : "flex w-full items-center justify-center";
  const rightColumnClassName = isMini
    ? "flex min-h-0 w-full flex-1 min-w-0 flex-col overflow-hidden gap-1.5 rounded-2xl border border-white/10 bg-slate-950/80 p-1.5 lg:flex-[1]"
    : `flex flex-none min-h-0 w-full flex-col overflow-hidden lg:h-full lg:flex-[1.1] ${
        isCompact ? "h-[36dvh] gap-1" : "h-[44dvh] gap-1.5 lg:gap-2"
      }`;
  const videoStackClassName = isMini
    ? "flex min-h-0 flex-none flex-col gap-1.5"
    : "flex flex-none flex-col";
  const videoContainerClassName = isMini
    ? resolvedMediaContainerClass
    : `${resolvedMediaContainerClass} relative flex-none`;
  const videoFooterClassName = isMini ? "flex-none pt-1" : "flex-none";

  const headerNode = isMini ? (
    <header
      className={`border border-white/10 bg-slate-900/70 ${
        isCompact ? "rounded-xl px-3 py-2" : "rounded-2xl px-4 py-3"
      }`}
    >
      <div className={`flex w-full flex-col ${isCompact ? "gap-2" : "gap-2.5"}`}>
        <h2 className={`${isCompact ? "text-lg" : "text-xl"} font-semibold text-white`}>
          {headerTitle}
        </h2>
        {headerControls ? <div className="w-full">{headerControls}</div> : null}
      </div>
    </header>
  ) : (
    <header
      className={`flex flex-wrap items-center justify-between border border-white/10 bg-slate-900/70 ${
        isMini ? "gap-2" : "gap-3"
      } ${
        isCompact
          ? isMini
            ? "rounded-xl px-2.5 py-1.5"
            : "rounded-xl px-3 py-2"
          : "rounded-2xl px-4 py-2.5"
      }`}
    >
      <div>
        <h2 className={`${isCompact ? "text-base" : "text-lg"} font-semibold text-white`}>
          {headerTitle}
        </h2>
      </div>
      {headerControls}
    </header>
  );

  const playerRowsNode = (
    <div className={isMini ? "flex flex-col gap-3" : isCompact ? "flex flex-col gap-2" : "flex flex-col gap-2.5"}>
      {renderPlayerRow(topPlayer, topPoints, {
        showAnalysis: analysisDisplayed,
        rowColor: topRowColor,
        isToMove: toMoveColor === topRowColor,
      })}
      {renderPlayerRow(bottomPlayer, bottomPoints, {
        rowColor: bottomRowColor,
        isToMove: toMoveColor === bottomRowColor,
      })}
    </div>
  );

  const boardControlsNode = (
    <BoardControls
      onPrev={onPrev}
      onLive={onLive}
      onNext={onNext}
      onFlip={onFlip}
      showEval={showEval}
      toggleEval={onToggleEval ?? (() => {})}
      canPrev={canPrev}
      canNext={canNext}
      liveActive={liveButtonNeutral}
      density={resolvedDensity}
    />
  );

  const boardNode = (
    <BroadcastReactBoard
      boardId={boardDomId}
      boardOrientation={boardOrientation}
      position={boardPosition}
      draggable={Boolean(onPieceDrop)}
      onPieceDrop={onPieceDrop}
      showNotation
      sizePx={isMini ? miniBoardSize : undefined}
      autoSize={!isMini}
      autoSizeMode={boardAutoSizeMode}
      fallbackSize={boardFallbackSize}
      containerClassName={boardContainerClassName}
    />
  );

  const videoStackNode = (
    <div className={videoStackClassName}>
      <div ref={videoPane.containerRef} className={videoContainerClassName}>
        {videoPane.content ?? (
          <div ref={videoPane.innerRef} className="absolute inset-0 h-full w-full" />
        )}
        {statusPill && (
          <div
            className={`pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 font-semibold uppercase text-white ${statusPill.className} ${
              isCompact ? "px-2 py-0.5 text-[9px] tracking-[0.16em]" : "px-3 py-1 text-[10px] tracking-[0.2em]"
            }`}
          >
            {statusPill.label}
          </div>
        )}
        {videoPane.secondaryPill && (
          <div
            className={`pointer-events-none absolute right-3 top-3 rounded-full border border-white/20 bg-black/50 font-semibold uppercase text-white ${
              isCompact ? "px-2 py-0.5 text-[9px] tracking-[0.16em]" : "px-3 py-1 text-[10px] tracking-wide"
            }`}
          >
            {videoPane.secondaryPill}
          </div>
        )}
        {videoPane.overlay}
        {videoPane.controlsOverlay}
      </div>
      {videoPane.footer ? <div className={videoFooterClassName}>{videoPane.footer}</div> : null}
    </div>
  );

  const tabsNode = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RightPaneTabs
        engineOn={notation.engineOn}
        setEngineOn={notation.setEngineOn}
        plies={notation.plies}
        currentMoveIndex={notation.currentMoveIndex}
        onMoveSelect={notation.onMoveSelect}
        engineEval={notation.engineEval}
        engineLines={notation.engineLines}
        engineName={notation.engineName}
        engineBackend={notation.engineBackend}
        setEngineBackend={notation.setEngineBackend}
        multiPv={notation.multiPv}
        depthIndex={notation.depthIndex}
        depthSteps={notation.depthSteps}
        targetDepth={notation.targetDepth}
        setMultiPv={notation.setMultiPv}
        setDepthIndex={notation.setDepthIndex}
        engineProfileId={notation.engineProfileId}
        engineProfile={notation.engineProfile}
        setEngineProfileId={notation.setEngineProfileId}
        fen={notation.fen}
        analysisViewActive={analysisViewActive}
        analysisBranches={analysisBranches}
        activeAnalysisAnchorPly={activeAnalysisAnchorPly}
        analysisCursorNodeId={analysisCursorNodeId}
        onExitAnalysisView={onExitAnalysisView}
        onSelectAnalysisMove={onSelectAnalysisMove}
        onPromoteAnalysisNode={onPromoteAnalysisNode}
        onDeleteAnalysisLine={onDeleteAnalysisLine}
        onDeleteAnalysisFromHere={onDeleteAnalysisFromHere}
        boardNavigation={boardNavigation.boards}
        currentBoardId={boardNavigation.normalizedBoardId}
        onBoardSelect={onBoardSelect}
        density={resolvedDensity}
        variant={variant}
        mode={mode}
      />
    </div>
  );

  const rightPanelNode = <aside className={rightColumnClassName}>{videoStackNode}{tabsNode}</aside>;
  const upsellModalNode = upsellOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={handleUpsellClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-slate-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upsell-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="upsell-title" className="text-base font-semibold text-white">
            Subscribe to get the best viewing experience
          </h2>
          <button
            type="button"
            onClick={handleUpsellClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-white/30 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleUpsellClose}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => router.push("/subscribe")}
            className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-4 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/25"
          >
            Subscribe
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (isMini) {
    return (
      <>
        <main className={resolvedMainClassName}>
          <div className={`${resolvedContentClassName} flex flex-col min-h-0`}>
            <div className={miniLayoutClassName}>
              <section className={miniLeftColumnClassName}>
                <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-1.5 shadow-xl ring-1 ring-white/5">
                  {headerNode}
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex min-h-0 flex-1 flex-col justify-center">
                      {playerRowsNode}
                    </div>
                    <div className="pt-2">{boardControlsNode}</div>
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 flex-col min-w-0">
                <div
                  ref={miniBoardContainerRef}
                  className="flex min-h-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-slate-950/80 p-2 shadow-xl ring-1 ring-white/5"
                >
                  <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                    <div className={miniBoardRowClassName} style={miniBoardFrameStyle}>
                      <div className={evalBarGutterClassName}>
                        <MainEvalBar
                          show={showEval}
                          forceMount
                          value={evaluation ?? null}
                          label={normalizedEvalLabel}
                          advantage={normalizedAdvantage}
                          orientation={boardOrientation}
                          density={resolvedDensity}
                          variant={variant}
                        />
                      </div>
                      <div className={boardSizerClassName}>
                        <AnimatedBoardPane boardKey={boardId}>{boardNode}</AnimatedBoardPane>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {rightPanelNode}
            </div>
          </div>
        </main>
        {statsOverlay}
        {upsellModalNode}
      </>
    );
  }

  return (
    <>
      <main className={resolvedMainClassName}>
        <div className={`${resolvedContentClassName} flex flex-col min-h-0`}>
          <div className={layoutClassName}>
            <section className={boardSectionClassName}>
              {headerNode}

              <div className="flex min-h-0 flex-1 flex-col">
                <AnimatedBoardPane boardKey={boardId}>
                  <div className={boardShellClassName}>
                      <div className={boardStackClassName}>
                      {renderPlayerRow(topPlayer, topPoints, {
                        showAnalysis: analysisDisplayed,
                        rowColor: topRowColor,
                        isToMove: toMoveColor === topRowColor,
                      })}

                      <div className={boardRowClassName}>
                        <div className={evalBarGutterClassName}>
                          <MainEvalBar
                            show={showEval}
                            forceMount
                            value={evaluation ?? null}
                            label={normalizedEvalLabel}
                            advantage={normalizedAdvantage}
                            orientation={boardOrientation}
                            density={resolvedDensity}
                            variant={variant}
                          />
                        </div>
                        <div className={boardSizerClassName}>{boardNode}</div>
                      </div>

                      {renderPlayerRow(bottomPlayer, bottomPoints, {
                        rowColor: bottomRowColor,
                        isToMove: toMoveColor === bottomRowColor,
                      })}
                      </div>

                    <div className={isCompact ? "pt-0.5" : "pt-1 sm:pt-1.5"}>
                      {boardControlsNode}
                    </div>
                  </div>
                </AnimatedBoardPane>
              </div>
            </section>

            {rightPanelNode}
          </div>
        </div>
      </main>
      {statsOverlay}
      {upsellModalNode}
    </>
  );
}

export default ViewerShell;
