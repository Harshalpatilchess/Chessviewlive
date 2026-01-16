"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import Flag from "@/components/live/Flag";
import TitleBadge from "@/components/boards/TitleBadge";
import type { TournamentGame } from "@/lib/tournamentManifest";
import { buildBoardIdentifier, normalizeBoardIdentifier, parseBoardIdentifier } from "@/lib/boardId";
import type { DgtBoardState, DgtLivePayload } from "@/lib/live/dgtPayload";
import { BoardsNavigationCard } from "@/components/boards/BoardsNavigationCard";
import useTournamentLiveFeed from "@/lib/live/useTournamentLiveFeed";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";
import { getMiniEvalCp } from "@/lib/miniEval";
import { mapEvaluationToBar } from "@/lib/engine/evalMapping";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import { pgnToDgtBoard } from "@/lib/live/pgnToDgtPayload";
import { getBoardStatusLabel, normalizeResultValue } from "@/lib/boards/boardStatus";
import { buildBroadcastBoardPath } from "@/lib/paths";

type BoardsNavigationProps = {
  boards?: BoardNavigationEntry[] | null;
  sidebarBoards?: BoardNavigationEntry[] | null;
  currentBoardId?: string;
  selectedBoardId?: string;
  paneQuery?: string;
  compact?: boolean;
  gridColsClassName?: string;
  tournamentSlug?: string;
  mode?: "live" | "replay";
  layout?: "grid" | "list";
  variant?: "default" | "tournament";
  viewerEvalBars?: boolean;
  debug?: boolean;
  debugRoundId?: string | null;
  sidebarOnly?: boolean;
  onBoardClick?: (board: BoardNavigationEntry) => boolean | void;
  emptyLabel?: string;
};

const WARM_LITE_PREFETCH_COUNT = 4;
const WARM_LITE_PREFETCH_DELAY_MS = 1000;
const NAV_LITE_EVAL_MOVETIME_MS = 250;
const NAV_EVAL_COOLDOWN_MS = 2500;
const NAV_EVAL_CACHE_TTL_MS = 60000;
const NAV_EVAL_MAX_INFLIGHT = 4;
const NAV_EVAL_QUEUE_MAX = 12;
const NAV_EVAL_STALE_TOP_MS = 15000;
const NAV_EVAL_STALE_OTHER_MS = 30000;
const NAV_BAR_FRESH_MS = 60000;
const NAV_BAR_SOFT_STALE_MS = 120000;
const NAV_BAR_HARD_STALE_MS = 300000;
const NAV_FEN_TOP_REFRESH_MS = 4000;
const NAV_FEN_OTHER_REFRESH_MS = 20000;
const NAV_FEN_FETCH_CONCURRENCY = 3;
const NAV_FEN_POLL_TICK_MS = 2000;
const NAV_COLDSTART_MAX_PER_MINUTE = 36;
const NAV_COLDSTART_QUEUE_LOW_WATERMARK = 2;
const NAV_COLDSTART_RETRY_MS = 15000;
const NAV_FEN_RESCUE_PENDING_EARLY_MS = 250;
const NAV_FEN_RESCUE_PENDING_LATE_MS = 5000;
const NAV_FEN_RESCUE_MAX_ATTEMPTS = 2;
const NAV_FEN_RESCUE_EARLY_COUNT = 12;
const NAV_ROW_FEN_LOG_MS = 5000;
const NAV_EVAL_SKIP_LOG_MS = 5000;
const INITIAL_CHESS_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type NavEvalEntry = {
  cp?: number;
  mate?: number;
  fenHash: string;
  requestedFenHash?: string;
  appliedFenHash?: string;
  fenSourceUsed?: NavResolvedFenSource;
  ts: number;
};

type NavFenEvalCacheEntry = {
  cp?: number;
  mate?: number;
  normalized: number | null;
  ts: number;
};

type DerivedFenCacheEntry = {
  plyCount: number;
  fen: string;
};

type NavResolvedFenSource = "feedFen" | "derivedFromMoves" | "fetchedBoardState" | "initialFallback" | "unknown";

type NavResolvedFenEntry = {
  fen: string | null;
  fenHash: string | null;
  fenSource: NavResolvedFenSource;
  isFinal: boolean;
  plyOrMoveCount: number;
  updatedAt: number;
};

type NavFetchedBoardState = {
  fen: string | null;
  isFinal: boolean;
  plyOrMoveCount: number;
  updatedAt: number;
};

type NavFenStatus = "ready" | "pending" | "noData" | "error";

type NavBoardFetchTask = {
  roundKey: string;
  slug: string;
  round: number;
  boardIds: string[];
  tier: "top" | "rest" | "mixed";
};

type LiteEvalApiResponse = {
  lines?: Array<{ scoreCp?: number; scoreMate?: number }>;
  error?: string;
};

type NavEvalOutcome = {
  eval: { cp?: number; mate?: number } | null;
  ok: boolean;
  status: number;
  errorMessage: string | null;
};

type NavEvalTask = {
  boardId: string;
  boardKey: string;
  normalizedFen: string;
  fenHash: string;
  cacheKeyHash: string;
  cacheKey6: string;
  resolvedFen: NavResolvedFenSnapshot;
  tier: "top" | "rest";
  enqueuedAt: number;
  reason?: "coldStart" | "fenChange" | "manual";
};

type NavColdStartEntry = {
  boardId: string;
  boardKey: string;
  fenHash: string;
  enqueuedAt: number;
};

type NavEvalTelemetry = {
  enqueued: number;
  evicted: number;
  started: number;
  completed: number;
  applied: number;
  startedSamples: number[];
  completedSamples: number[];
  appliedSamples: number[];
};

type NavResolvedFenSnapshot = {
  fen: string;
  fenHash: string;
  fenSource: NavResolvedFenSource;
};

declare global {
  interface Window {
    __navQueueDump?: () => unknown;
  }
}

const getFenHash = (fen: string, full = false) => {
  const trimmed = fen.trim();
  if (!full) {
    return trimmed.slice(0, 12);
  }
  const [placement] = trimmed.split(/\s+/);
  return placement ?? trimmed;
};

const normalizeFen = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const buildFenFromMoveList = (moveList?: string[] | null): string | null => {
  if (!Array.isArray(moveList) || moveList.length === 0) return null;
  const chess = new Chess();
  for (const move of moveList) {
    try {
      // chess.js typings omit sloppy option; keep runtime behavior.
      chess.move(move, { sloppy: true } as { sloppy?: boolean });
    } catch {
      break;
    }
  }
  return chess.fen();
};

const buildResolvedFenEntry = (
  fen: string | null,
  fenSource: NavResolvedFenSource,
  options: { isFinal: boolean; plyOrMoveCount: number; updatedAt: number; hashFull: boolean }
): NavResolvedFenEntry => {
  const normalizedFen = normalizeFen(fen);
  const fenHash = normalizedFen ? getFenHash(normalizedFen, options.hashFull) : null;
  return {
    fen: normalizedFen,
    fenHash,
    fenSource,
    isFinal: options.isFinal,
    plyOrMoveCount: options.plyOrMoveCount,
    updatedAt: options.updatedAt,
  };
};

const hasBoardStartSignal = (entry: BoardNavigationEntry): boolean => {
  const moveCount = Array.isArray(entry.moveList) ? entry.moveList.length : 0;
  const hasClockData =
    Number.isFinite(Number(entry.whiteTimeMs ?? NaN)) || Number.isFinite(Number(entry.blackTimeMs ?? NaN));
  const hasSideToMove = Boolean(entry.sideToMove);
  const hasEval = Number.isFinite(Number(entry.evaluation ?? NaN));
  return entry.status === "live" || moveCount > 0 || hasClockData || hasSideToMove || hasEval;
};

const resolveLivePreviewFen = (
  entry: BoardNavigationEntry,
  game: TournamentGame | null
): string | null => {
  if (!game) return entry.previewFen ?? entry.finalFen ?? null;
  if (game.finalFen) return game.finalFen;
  const fenFromMoves = buildFenFromMoveList(game.moveList);
  if (fenFromMoves) return fenFromMoves;
  return entry.previewFen ?? entry.finalFen ?? null;
};

export const BoardsNavigation = ({
  boards,
  sidebarBoards,
  currentBoardId,
  selectedBoardId,
  paneQuery,
  compact = false,
  gridColsClassName,
  tournamentSlug,
  mode,
  layout = "grid",
  variant = "default",
  viewerEvalBars = false,
  debug = false,
  debugRoundId = null,
  sidebarOnly = false,
  onBoardClick,
  emptyLabel = "No other boards available for this round yet.",
}: BoardsNavigationProps) => {
  const resolvedLayout = sidebarOnly ? "list" : variant === "tournament" ? "grid" : layout;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkQuery = useMemo(() => {
    if (!searchParams) return "";
    const query = new URLSearchParams(searchParams);
    query.delete("tab");
    query.delete("round");
    query.delete("page");
    if (paneQuery === undefined) {
      // Preserve existing pane when no override is provided.
    } else if (paneQuery) {
      query.set("pane", paneQuery);
    } else {
      query.delete("pane");
    }
    const queryString = query.toString();
    return queryString ? `?${queryString}` : "";
  }, [paneQuery, searchParams]);
  const selectedRowRef = useRef<HTMLAnchorElement | null>(null);
  const hasAutoScrolledRef = useRef(false);
  const warmTimeoutRef = useRef<number | null>(null);
  const warmTriggeredRef = useRef(false);
  const [warmBoardIds, setWarmBoardIds] = useState<Record<string, true>>({});
  const viewerEvalBarsEnabled = viewerEvalBars && variant === "default";
  const [navEvalMap, setNavEvalMap] = useState<Record<string, NavEvalEntry>>({});
  const navEvalMapRef = useRef<Record<string, NavEvalEntry>>({});
  const navResolvedFenMapRef = useRef<Record<string, NavResolvedFenEntry>>({});
  const [navBoardStateMap, setNavBoardStateMap] = useState<Record<string, NavFetchedBoardState>>({});
  const [navFetchTick, setNavFetchTick] = useState(0);
  const [navDebugEnabled, setNavDebugEnabled] = useState(false);
  const [navDebugCacheEnabled, setNavDebugCacheEnabled] = useState(false);
  const [fenStatusTick, setFenStatusTick] = useState(0);
  const [navVisibilityTick, setNavVisibilityTick] = useState(0);
  const navDebugWiredLoggedRef = useRef(false);
  const navQueueFunctionsWiredRef = useRef(false);
  const navTopSetWiredRef = useRef(false);
  const navRowFenLoggedRef = useRef<Record<string, number>>({});
  const navFenHashLogRef = useRef<Record<string, string>>({});
  const navFenChangeAtRef = useRef<Record<string, number>>({});
  const navEvalHashLogRef = useRef<Record<string, string>>({});
  const navMismatchSamplesRef = useRef<number[]>([]);
  const navEvalSkipLoggedRef = useRef<Record<string, number>>({});
  const navEvalDesyncLoggedRef = useRef<Record<string, number>>({});
  const navTraceLoggedRef = useRef(false);
  const navBoardStatusRef = useRef<Record<string, string>>({});
  const lastRequestedFenHashRef = useRef<Record<string, string | null>>({});
  const lastRequestAtRef = useRef<Record<string, number>>({});
  const lastEvalAppliedAtRef = useRef<Record<string, number>>({});
  const hasEverAppliedEvalRef = useRef<Record<string, true>>({});
  const latestFenHashRef = useRef<Record<string, string>>({});
  const appliedFenHashRef = useRef<Record<string, string>>({});
  const fenStatusRef = useRef<Record<string, NavFenStatus>>({});
  const fenPendingSinceRef = useRef<Record<string, number>>({});
  const fenRescueAttemptsRef = useRef<Record<string, number>>({});
  const fenRescueInflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const fenRescueLastSourceRef = useRef<Record<string, "live" | "manifest" | "pgn" | "none">>({});
  const fenRescueResolvedSourceRef = useRef<Record<string, "fen" | "moves" | "pgn">>({});
  const fenRescueFenSourceRef = useRef<Record<string, string>>({});
  const boardKeyMatchRef = useRef<Record<string, string>>({});
  const fenKeyMatchLogRef = useRef<Record<string, string>>({});
  const coldStartQueueRef = useRef<{ order: string[]; byId: Map<string, NavColdStartEntry> }>({
    order: [],
    byId: new Map(),
  });
  const coldStartEnqueuedFenHashRef = useRef<Record<string, string>>({});
  const coldStartEligibleLateRef = useRef(0);
  const coldStartLateEligibleRef = useRef<Record<string, true>>({});
  const lastSeenFenHashRef = useRef<Record<string, string | null>>({});
  const firstSeenAtRef = useRef<Record<string, number>>({});
  const noEvalReasonLoggedRef = useRef<Record<string, number>>({});
  const coldStartRateRef = useRef<number[]>([]);
  const coldStartAppliedCountRef = useRef(0);
  const navEvalQueueRef = useRef<{
    order: string[];
    byId: Map<string, NavEvalTask>;
    lastServedTier: "top" | "rest" | null;
  }>({ order: [], byId: new Map(), lastServedTier: null });
  const enqueueEvalTaskRef = useRef<((task: NavEvalTask, options?: { prepend?: boolean }) => void) | null>(
    null
  );
  const runEvalQueueRef = useRef<(() => void) | null>(null);
  const navVisibleBoardIdsRef = useRef<Record<string, boolean>>({});
  const navEvalTelemetryRef = useRef<NavEvalTelemetry>({
    enqueued: 0,
    evicted: 0,
    started: 0,
    completed: 0,
    applied: 0,
    startedSamples: [],
    completedSamples: [],
    appliedSamples: [],
  });
  const inflightRef = useRef<Map<string, Promise<NavEvalOutcome>>>(new Map());
  const fenEvalCacheRef = useRef<Record<string, NavFenEvalCacheEntry>>({});
  const derivedFenCacheRef = useRef<Record<string, DerivedFenCacheEntry>>({});
  const fetchQueueRef = useRef<{ queue: NavBoardFetchTask[]; inFlight: number }>({ queue: [], inFlight: 0 });
  const fetchPendingRef = useRef<Record<string, true>>({});
  const lastBoardFetchAtRef = useRef<Record<string, number>>({});
  const roundFetchInflightRef = useRef<Map<string, Promise<Record<number, NavFetchedBoardState>>>>(new Map());
  const navBootstrapRef = useRef<Record<string, true>>({});
  const navFenSourceLogRef = useRef<Record<string, string>>({});
  const navFenResolveLogRef = useRef<Record<string, string>>({});
  const navFetchErrorRef = useRef<Record<string, { status?: number; textSnippet?: string; ts: number }>>({});
  const viewerEvalBarsEnabledRef = useRef(viewerEvalBarsEnabled);
  const baseBoards = boards ?? [];
  const liveFeedConfig = useMemo(() => {
    if (variant !== "tournament" || !tournamentSlug || baseBoards.length === 0) return null;
    const candidateId = baseBoards[0]?.boardId;
    if (!candidateId) return null;
    const parsed = parseBoardIdentifier(candidateId, tournamentSlug);
    return { tournamentSlug: parsed.tournamentSlug, round: parsed.round };
  }, [baseBoards, tournamentSlug, variant]);
  const liveFeedVersion = useTournamentLiveFeed({
    tournamentSlug: liveFeedConfig?.tournamentSlug ?? null,
    round: liveFeedConfig?.round ?? null,
  });
  const resolveBoardKey = useCallback(
    (boardId: string) =>
      normalizeBoardIdentifier(boardId, tournamentSlug ?? undefined).normalizedBoardId,
    [tournamentSlug]
  );
  const getEvalKey = useCallback((boardId: string) => resolveBoardKey(boardId), [resolveBoardKey]);
  const navTrace = useMemo(() => {
    if (!navDebugEnabled) return "";
    return (searchParams?.get("trace") ?? "").trim();
  }, [navDebugEnabled, searchParams]);
  const shouldLogBoard = useCallback(
    (boardId: string, boardKey?: string) => {
      if (!navDebugEnabled) return false;
      if (!navTrace) return true;
      const key = boardKey ?? getEvalKey(boardId);
      return boardId === navTrace || key === navTrace;
    },
    [getEvalKey, navDebugEnabled, navTrace]
  );
  const getBoardKeyCandidates = useCallback(
    (boardId: string) => {
      const candidates: string[] = [];
      const seen = new Set<string>();
      const add = (value?: string | null) => {
        if (!value) return;
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        candidates.push(trimmed);
      };
      const raw = boardId ?? "";
      add(raw);
      const normalized = normalizeBoardIdentifier(raw, tournamentSlug ?? undefined).normalizedBoardId;
      add(normalized);
      const parsed = parseBoardIdentifier(raw, tournamentSlug ?? undefined);
      add(`${parsed.tournamentSlug}-board${parsed.round}.${parsed.board}`);
      add(`board${parsed.round}.${parsed.board}`);
      if (raw.includes("-")) {
        add(raw.slice(raw.lastIndexOf("-") + 1));
      }
      return candidates;
    },
    [tournamentSlug]
  );
  const getBoardKeyMatch = useCallback(
    (boardId: string, record: Record<string, unknown>) => {
      const cached = boardKeyMatchRef.current[boardId];
      if (cached && Object.prototype.hasOwnProperty.call(record, cached)) {
        return { matchedKey: cached, tried: 1, candidates: [cached] };
      }
      const candidates = getBoardKeyCandidates(boardId);
      for (let idx = 0; idx < candidates.length; idx += 1) {
        const candidate = candidates[idx];
        if (Object.prototype.hasOwnProperty.call(record, candidate)) {
          boardKeyMatchRef.current[boardId] = candidate;
          return { matchedKey: candidate, tried: idx + 1, candidates };
        }
      }
      return { matchedKey: null, tried: candidates.length, candidates };
    },
    [getBoardKeyCandidates]
  );
  const updateFenStatus = useCallback(
    (boardKey: string, nextStatus: NavFenStatus) => {
      const prevStatus = fenStatusRef.current[boardKey];
      if (prevStatus === nextStatus) return;
      fenStatusRef.current[boardKey] = nextStatus;
      if (nextStatus !== "pending") {
        delete fenPendingSinceRef.current[boardKey];
      }
      setFenStatusTick(tick => tick + 1);
    },
    []
  );
  const resolveDerivedFen = useCallback(
    (boardId: string, moveList?: string[] | null): string | null => {
      const moves = Array.isArray(moveList) ? moveList : null;
      const plyCount = moves?.length ?? 0;
      if (!moves || plyCount === 0) return null;
      const cached = derivedFenCacheRef.current[boardId];
      if (cached && cached.plyCount === plyCount) return cached.fen;
      const derived = buildFenFromMoveList(moves);
      if (!derived) return null;
      derivedFenCacheRef.current[boardId] = { plyCount, fen: derived };
      return derived;
    },
    []
  );
  const resolvedBoards = useMemo(() => {
    const baseResolvedBoards = (() => {
      if (!liveFeedConfig) {
        return baseBoards;
      }
      return baseBoards.map(entry => {
        const game = getTournamentGameManifest(
          liveFeedConfig.tournamentSlug,
          liveFeedConfig.round,
          entry.boardNumber
        );
        if (!game) return entry;
        const previewFen = resolveLivePreviewFen(entry, game);
        const miniEvalCp = previewFen ? getMiniEvalCp(previewFen) : entry.miniEvalCp ?? null;
        return {
          ...entry,
          result: game.result ?? entry.result,
          status: game.status ?? entry.status,
          evaluation: game.evaluation ?? entry.evaluation ?? null,
          whiteTimeMs: game.whiteTimeMs ?? entry.whiteTimeMs ?? null,
          blackTimeMs: game.blackTimeMs ?? entry.blackTimeMs ?? null,
          clockUpdatedAtMs: game.clockUpdatedAtMs ?? entry.clockUpdatedAtMs ?? null,
          sideToMove: game.sideToMove ?? entry.sideToMove ?? null,
          finalFen: game.finalFen ?? entry.finalFen ?? null,
          moveList: game.moveList ?? entry.moveList ?? null,
          previewFen,
          miniEvalCp,
        };
      });
    })();

    return baseResolvedBoards;
  }, [baseBoards, liveFeedConfig, liveFeedVersion, resolveDerivedFen]);
  const isEmpty = resolvedBoards.length === 0;
  const hasLiveClocks = useMemo(() => {
    return resolvedBoards.some(board => {
      const hasClock =
        Number.isFinite(board.whiteTimeMs ?? NaN) || Number.isFinite(board.blackTimeMs ?? NaN);
      const normalizedResult = normalizeResultValue(board.result);
      const isLive = board.status === "live" || normalizedResult === "*";
      return hasClock && isLive;
    });
  }, [resolvedBoards]);
  const [clockNowMs, setClockNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!hasLiveClocks) {
      setClockNowMs(null);
      return;
    }
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveClocks]);

  const gridCols = gridColsClassName ?? "grid-cols-2";
  const gridGaps = compact
    ? variant === "tournament"
      ? "gap-x-2.5 gap-y-2"
      : "gap-x-2 gap-y-1.5"
    : variant === "tournament"
      ? "gap-x-2.5 gap-y-2"
      : "gap-x-3 gap-y-1";
  const gridWrapperPadding = compact
    ? "px-1 pb-0.5"
    : variant === "tournament"
      ? "px-0 pb-1 pt-2"
      : "px-1.5 pb-1 sm:px-2";
  const gridOverflowClass = variant === "tournament" ? "relative z-10 overflow-visible" : "overflow-x-hidden";
  const resolvedSidebarBoards =
    sidebarBoards && liveFeedConfig
      ? sidebarBoards.map(entry => {
          const game = getTournamentGameManifest(
            liveFeedConfig.tournamentSlug,
            liveFeedConfig.round,
            entry.boardNumber
          );
          if (!game) return entry;
          const previewFen = resolveLivePreviewFen(entry, game);
          const miniEvalCp = previewFen ? getMiniEvalCp(previewFen) : entry.miniEvalCp ?? null;
          return {
            ...entry,
            result: game.result ?? entry.result,
            status: game.status ?? entry.status,
            evaluation: game.evaluation ?? entry.evaluation ?? null,
            whiteTimeMs: game.whiteTimeMs ?? entry.whiteTimeMs ?? null,
            blackTimeMs: game.blackTimeMs ?? entry.blackTimeMs ?? null,
            clockUpdatedAtMs: game.clockUpdatedAtMs ?? entry.clockUpdatedAtMs ?? null,
            sideToMove: game.sideToMove ?? entry.sideToMove ?? null,
            finalFen: game.finalFen ?? entry.finalFen ?? null,
            moveList: game.moveList ?? entry.moveList ?? null,
            previewFen,
            miniEvalCp,
          };
        })
      : sidebarBoards ?? resolvedBoards;
  const autoEnableEnabled =
    variant === "default" || (tournamentSlug === "worldcup2025" && variant === "tournament");
  const autoEnableCandidates = autoEnableEnabled ? resolvedBoards.slice(0, WARM_LITE_PREFETCH_COUNT) : [];
  const autoEnabledBoardIds = autoEnableCandidates.reduce<Record<string, true>>((acc, board) => {
    acc[board.boardId] = true;
    return acc;
  }, {});
  const warmEnabled = !debug && autoEnableEnabled;
  const warmCandidates = warmEnabled ? autoEnableCandidates : [];
  const navResolvedFenMap = useMemo(() => {
    const resolved: Record<string, NavResolvedFenEntry> = {};
    resolvedBoards.forEach(board => {
      const normalizedResult = normalizeResultValue(board.result);
      const isFinal = board.status === "final" || Boolean(normalizedResult);
      const moveList = Array.isArray(board.moveList) ? board.moveList : null;
      const moveCount = moveList?.length ?? 0;
      const feedFinalFen = normalizeFen(board.finalFen);
      const feedFen = normalizeFen(
        board.previewFen ??
          (board as { currentFen?: string | null }).currentFen ??
          (board as { liveFen?: string | null }).liveFen ??
          (board as { fen?: string | null }).fen ??
          null
      );
      const fetchedMatch = getBoardKeyMatch(board.boardId, navBoardStateMap);
      const fetched = fetchedMatch.matchedKey ? navBoardStateMap[fetchedMatch.matchedKey] ?? null : null;
      const timestamp = Date.now();
      if (isFinal && feedFinalFen) {
        resolved[board.boardId] = buildResolvedFenEntry(feedFinalFen, "feedFen", {
          isFinal: true,
          plyOrMoveCount: moveCount,
          updatedAt: timestamp,
          hashFull: debug,
        });
        return;
      }
      if (feedFen) {
        resolved[board.boardId] = buildResolvedFenEntry(feedFen, "feedFen", {
          isFinal,
          plyOrMoveCount: moveCount,
          updatedAt: timestamp,
          hashFull: debug,
        });
        return;
      }
      const derivedFen = resolveDerivedFen(board.boardId, moveList);
      if (derivedFen) {
        resolved[board.boardId] = buildResolvedFenEntry(derivedFen, "derivedFromMoves", {
          isFinal,
          plyOrMoveCount: moveCount,
          updatedAt: timestamp,
          hashFull: debug,
        });
        return;
      }
      if (fetched?.fen) {
        resolved[board.boardId] = buildResolvedFenEntry(fetched.fen, "fetchedBoardState", {
          isFinal: fetched.isFinal,
          plyOrMoveCount: fetched.plyOrMoveCount,
          updatedAt: fetched.updatedAt,
          hashFull: debug,
        });
        return;
      }
      if (!hasBoardStartSignal(board)) {
        resolved[board.boardId] = buildResolvedFenEntry(INITIAL_CHESS_FEN, "initialFallback", {
          isFinal: false,
          plyOrMoveCount: moveCount,
          updatedAt: timestamp,
          hashFull: debug,
        });
        return;
      }
      resolved[board.boardId] = buildResolvedFenEntry(null, "unknown", {
        isFinal,
        plyOrMoveCount: moveCount,
        updatedAt: timestamp,
        hashFull: debug,
      });
    });
    return resolved;
  }, [debug, getBoardKeyMatch, navBoardStateMap, resolveDerivedFen, resolvedBoards]);
  const navEvalPendingMap = useMemo(() => {
    const pending: Record<string, boolean> = {};
    resolvedBoards.forEach(board => {
      const boardKey = getEvalKey(board.boardId);
      const entry = navResolvedFenMap[board.boardId];
      if (!entry) return;
      const hasStart = hasBoardStartSignal(board);
      const basePending = hasStart && (entry.fenSource === "initialFallback" || entry.fenSource === "unknown");
      const status = fenStatusRef.current[boardKey];
      pending[boardKey] = basePending && status !== "noData" && status !== "error";
    });
    return pending;
  }, [fenStatusTick, getEvalKey, navResolvedFenMap, resolvedBoards]);
  const topBoardIdSet = useMemo(() => {
    return new Set(resolvedBoards.slice(0, 4).map(board => getEvalKey(board.boardId)));
  }, [getEvalKey, resolvedBoards]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const now = Date.now();
    resolvedBoards.forEach(board => {
      const boardKey = getEvalKey(board.boardId);
      const resolved = navResolvedFenMap[board.boardId];
      const hasStart = hasBoardStartSignal(board);
      const isPending = hasStart && (resolved?.fenSource === "initialFallback" || resolved?.fenSource === "unknown");
      if (resolved?.fen) {
        updateFenStatus(boardKey, "ready");
        delete fenRescueAttemptsRef.current[boardKey];
        delete fenRescueLastSourceRef.current[boardKey];
        if (navDebugEnabled) {
          const match = getBoardKeyMatch(board.boardId, navBoardStateMap);
          const matchedKey = match.matchedKey ?? resolveBoardKey(board.boardId);
          const matchLogKey = `${resolved.fen}:${resolved.fenSource}:${matchedKey}`;
          if (fenKeyMatchLogRef.current[board.boardId] !== matchLogKey) {
            fenKeyMatchLogRef.current[board.boardId] = matchLogKey;
            const rescueSource = fenRescueResolvedSourceRef.current[boardKey] ?? null;
            const source =
              resolved.fenSource === "fetchedBoardState"
                ? rescueSource ?? "live"
                : resolved.fenSource === "derivedFromMoves"
                  ? "moves"
                  : "fen";
            console.log("NAV_FEN_KEY_MATCH", {
              boardId: board.boardId,
              matchedKey,
              tried: match.tried,
              source,
            });
          }
        }
        return;
      }
      if (isPending) {
        updateFenStatus(boardKey, "pending");
        if (!fenPendingSinceRef.current[boardKey]) {
          fenPendingSinceRef.current[boardKey] = now;
        }
        return;
      }
    updateFenStatus(boardKey, "noData");
  });
  }, [
    getEvalKey,
    getBoardKeyMatch,
    navBoardStateMap,
    navDebugEnabled,
    navResolvedFenMap,
    resolveBoardKey,
    resolvedBoards,
    updateFenStatus,
    viewerEvalBarsEnabled,
  ]);

  useEffect(() => {
    if (!navDebugEnabled || resolvedBoards.length === 0) return;
    const now = Date.now();
    resolvedBoards.forEach(board => {
      const resolved = navResolvedFenMap[board.boardId];
      const fenHash = resolved?.fenHash ?? "";
      const fenHash6 = fenHash ? fenHash.slice(0, 6) : "";
      const lastHash = navFenHashLogRef.current[board.boardId] ?? "";
      if (fenHash6 && lastHash && fenHash6 !== lastHash) {
        navFenChangeAtRef.current[board.boardId] = now;
        if (shouldLogBoard(board.boardId)) {
          console.log("NAV_FEN_CHANGE", {
            boardId: board.boardId,
            fromHash6: lastHash,
            toHash6: fenHash6,
            source: resolved?.fenSource ?? "unknown",
            moveCount: resolved?.plyOrMoveCount ?? 0,
            line: `FEN_CHANGE boardId=${board.boardId} from=${lastHash} to=${fenHash6} source=${resolved?.fenSource ?? "unknown"} moves=${resolved?.plyOrMoveCount ?? 0}`,
          });
        }
      }
      if (fenHash6) {
        navFenHashLogRef.current[board.boardId] = fenHash6;
      }
    });
}, [navDebugEnabled, navResolvedFenMap, resolvedBoards, shouldLogBoard]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const visibleMap = navVisibleBoardIdsRef.current;
    const now = Date.now();
    const firstBoard = resolvedBoards[0];
    const firstBoardFenHash = firstBoard ? navResolvedFenMap[firstBoard.boardId]?.fenHash ?? "" : "";
    resolvedBoards.forEach(board => {
      const isVisible = Boolean(visibleMap[board.boardId]);
      if (!isVisible) return;
      const boardKey = getEvalKey(board.boardId);
      const resolved = navResolvedFenMap[board.boardId];
      const normalizedFen = resolved?.fen ?? "";
      const fenHash = resolved?.fenHash ?? "";
      const cacheKeyHash =
        navDebugCacheEnabled && firstBoardFenHash ? firstBoardFenHash : fenHash;
      const cacheKey6 = cacheKeyHash ? cacheKeyHash.slice(0, 6) : "";
      const fenHash6 = fenHash ? fenHash.slice(0, 6) : "";
      const existingEval = navEvalMapRef.current[boardKey];
      const appliedHash = appliedFenHashRef.current[boardKey] ?? "";
      const appliedHash6 = appliedHash ? appliedHash.slice(0, 6) : "";
      const hasNavEvalValue = Boolean(existingEval);
      const hasEvalForHash = Boolean(appliedHash) && appliedHash === cacheKeyHash;
      const existingTask = navEvalQueueRef.current.byId.get(boardKey);
      const inflightKey = `${boardKey}:${cacheKeyHash}`;
      const hasInflight = inflightRef.current.has(inflightKey);
      const lastRequestedFenHash = lastRequestedFenHashRef.current[boardKey] ?? "";
      const lastRequestedAt = lastRequestAtRef.current[boardKey] ?? 0;
      const pendingEval = navEvalPendingMap[boardKey] ?? false;
      const isTopTier = topBoardIdSet.has(boardKey);
      const status = board.status ?? "unknown";
      let reason: string | null = null;
      if (!normalizedFen || !fenHash) {
        reason = "noFen";
      } else if (pendingEval) {
        reason = "pending";
      } else if (hasEvalForHash) {
        reason = "hasEval";
      } else if (existingTask?.cacheKeyHash === cacheKeyHash) {
        reason = "queued";
      } else if (hasInflight) {
        reason = "inFlight";
      } else if (lastRequestedFenHash === cacheKeyHash && now - lastRequestedAt < NAV_EVAL_COOLDOWN_MS) {
        reason = "cooldown";
      } else if (lastRequestedFenHash === cacheKeyHash) {
        reason = "sameFen";
      }
      if (navDebugEnabled && shouldLogBoard(board.boardId, boardKey)) {
        const desync =
          (hasNavEvalValue && (!appliedHash || appliedHash !== existingEval?.fenHash)) ||
          (!hasNavEvalValue && Boolean(appliedHash));
        if (desync) {
          const lastLoggedAt = navEvalDesyncLoggedRef.current[boardKey] ?? 0;
          if (now - lastLoggedAt >= 30000) {
            navEvalDesyncLoggedRef.current[boardKey] = now;
            const currentHash6 = cacheKey6;
            console.log("NAV_EVAL_CACHE_DESYNC", {
              boardId: board.boardId,
              key: boardKey,
              currentHash6,
              appliedHash6,
              hasEvalFlag: hasNavEvalValue,
              hasNavEvalValue,
            });
          }
        }
      }
      if (reason) {
        if (navDebugEnabled) {
          const lastLoggedAt = navEvalSkipLoggedRef.current[boardKey] ?? 0;
          if (now - lastLoggedAt >= NAV_EVAL_SKIP_LOG_MS) {
            navEvalSkipLoggedRef.current[boardKey] = now;
            if (shouldLogBoard(board.boardId, boardKey)) {
              const cooldownMsLeft = lastRequestedAt
                ? Math.max(0, NAV_EVAL_COOLDOWN_MS - (now - lastRequestedAt))
                : 0;
              console.log("NAV_EVAL_SKIP", {
                boardId: board.boardId,
                key: boardKey,
                fenHash6,
                appliedHash6,
                currentHash6: cacheKey6,
                reason,
                isVisible,
                enabled: viewerEvalBarsEnabled,
                hasEvalForHash,
                hasNavEvalValue,
                lastReqHash6: lastRequestedFenHash ? lastRequestedFenHash.slice(0, 6) : "",
                status,
                tier: isTopTier ? "top" : "rest",
                line: `EVAL_SKIP boardId=${board.boardId} key=${boardKey} fenHash6=${fenHash6} reason=${reason} hasEvalForHash=${hasEvalForHash} appliedHash6=${appliedHash6} currentHash6=${cacheKey6} hasNavEvalValue=${hasNavEvalValue} lastReqHash6=${lastRequestedFenHash ? lastRequestedFenHash.slice(0, 6) : ""} cooldownMsLeft=${cooldownMsLeft} visible=${isVisible} enabled=${viewerEvalBarsEnabled}`,
              });
            }
          }
        }
        return;
      }
      if (!cacheKeyHash) return;
      latestFenHashRef.current[boardKey] = fenHash;
      const enqueue = enqueueEvalTaskRef.current;
      if (!enqueue) return;
      if (!resolved?.fenSource || !resolved?.fenHash) return;
      enqueue(
        {
          boardId: board.boardId,
          boardKey,
          normalizedFen,
          fenHash,
          cacheKeyHash,
          cacheKey6,
          resolvedFen: {
            fen: normalizedFen,
            fenHash: resolved.fenHash,
            fenSource: resolved.fenSource,
          },
          tier: isTopTier ? "top" : "rest",
          enqueuedAt: now,
          reason: "fenChange",
        },
        { prepend: true }
      );
      if (navDebugEnabled) {
        navEvalSkipLoggedRef.current[boardKey] = now;
      }
      runEvalQueueRef.current?.();
    });
  }, [
    getEvalKey,
    navDebugCacheEnabled,
    navDebugEnabled,
    navEvalPendingMap,
    navResolvedFenMap,
    navVisibilityTick,
    resolvedBoards,
    shouldLogBoard,
    topBoardIdSet,
    viewerEvalBarsEnabled,
  ]);

  const navEvalNoDataMap = useMemo(() => {
    const noData: Record<string, boolean> = {};
    resolvedBoards.forEach(board => {
      const boardKey = getEvalKey(board.boardId);
      const status = fenStatusRef.current[boardKey];
      noData[board.boardId] = status === "noData" || status === "error";
    });
    return noData;
  }, [fenStatusTick, getEvalKey, resolvedBoards]);

  const earlyRescueSet = useMemo(
    () => new Set(resolvedBoards.slice(0, NAV_FEN_RESCUE_EARLY_COUNT).map(board => board.boardId)),
    [resolvedBoards]
  );

  const handleDebugVisibilityChange = useCallback(
    (boardId: string, isVisible: boolean) => {
      const prev = navVisibleBoardIdsRef.current[boardId];
      navVisibleBoardIdsRef.current[boardId] = isVisible;
      if (prev !== isVisible) {
        setNavVisibilityTick(tick => tick + 1);
      }
    },
    []
  );

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const queueState = coldStartQueueRef.current;
    const eligibleSet = new Set<string>();
    const now = Date.now();
    resolvedBoards.forEach(board => {
      const boardId = board.boardId;
      const boardKey = getEvalKey(boardId);
      if (!firstSeenAtRef.current[boardKey]) {
        firstSeenAtRef.current[boardKey] = now;
      }
      if (hasEverAppliedEvalRef.current[boardKey]) {
        delete coldStartLateEligibleRef.current[boardKey];
        return;
      }
      const resolved = navResolvedFenMap[boardId];
      const pendingEval = navEvalPendingMap[boardKey] ?? false;
      const normalizedFen = resolved?.fen ?? "";
      const fenHash = resolved?.fenHash ?? "";
      const hasSeenBefore = Object.prototype.hasOwnProperty.call(lastSeenFenHashRef.current, boardKey);
      const previousSeen = lastSeenFenHashRef.current[boardKey] ?? null;
      const becameAvailable = Boolean(fenHash) && hasSeenBefore && !previousSeen;
      if (fenHash) {
        lastSeenFenHashRef.current[boardKey] = fenHash;
      } else {
        lastSeenFenHashRef.current[boardKey] = null;
      }
      if (!fenHash || pendingEval) {
        delete coldStartEnqueuedFenHashRef.current[boardKey];
        delete coldStartLateEligibleRef.current[boardKey];
        return;
      }
      if (becameAvailable) {
        coldStartLateEligibleRef.current[boardKey] = true;
      }
      eligibleSet.add(boardKey);
      const existing = queueState.byId.get(boardKey);
      const enqueuedForHash = coldStartEnqueuedFenHashRef.current[boardKey];
      if (enqueuedForHash !== fenHash) {
        const reason: "initial" | "late" = becameAvailable ? "late" : "initial";
        if (!existing) {
          queueState.byId.set(boardKey, { boardId, boardKey, fenHash, enqueuedAt: now });
          queueState.order.push(boardKey);
        } else if (existing.fenHash !== fenHash) {
          queueState.byId.set(boardKey, { ...existing, fenHash });
        }
        coldStartEnqueuedFenHashRef.current[boardKey] = fenHash;
        if (navDebugEnabled) {
          console.log("NAV_COLDSTART_ENQUEUE", { boardId, fenHash6: fenHash.slice(0, 6), reason });
        }
      } else if (existing && existing.fenHash !== fenHash) {
        queueState.byId.set(boardKey, { ...existing, fenHash });
      }
    });
    coldStartEligibleLateRef.current = Object.keys(coldStartLateEligibleRef.current).length;
    if (queueState.order.length > 0) {
      queueState.order = queueState.order.filter(boardKey => {
        if (eligibleSet.has(boardKey)) return true;
        queueState.byId.delete(boardKey);
        return false;
      });
    }
  }, [
    debug,
    getEvalKey,
    navDebugEnabled,
    navEvalPendingMap,
    navResolvedFenMap,
    resolvedBoards,
    viewerEvalBarsEnabled,
  ]);

  const fenHashCounts = useMemo(() => {
    return resolvedBoards.reduce<Record<string, number>>((acc, board) => {
      const fenHash = navResolvedFenMap[board.boardId]?.fenHash ?? "";
      if (!fenHash) return acc;
      acc[fenHash] = (acc[fenHash] ?? 0) + 1;
      return acc;
    }, {});
  }, [navResolvedFenMap, resolvedBoards]);

  useEffect(() => {
    hasAutoScrolledRef.current = false;
  }, [selectedBoardId]);

  useEffect(() => {
    const debugParam = searchParams?.get("debug") === "1";
    const debugCacheParam = searchParams?.get("debugCache") === "1";
    setNavDebugEnabled(debugParam);
    setNavDebugCacheEnabled(debugParam && debugCacheParam);
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const debugParamValue = searchParams?.get("debug") ?? null;
    const paneParamValue = searchParams?.get("pane") ?? null;
    if (!navDebugEnabled) return;
    if (navDebugWiredLoggedRef.current) return;
    navDebugWiredLoggedRef.current = true;
    const payload = {
      ok: true,
      debug: navDebugEnabled,
      debugParamValue,
      paneParamValue,
    };
    console.log("NAV_DEBUG_GATE", payload);
    console.log("NAV_FEN_RESCUE_WIRED", payload);
  }, [navDebugEnabled, searchParams]);

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    if (!navTrace) return;
    if (navTraceLoggedRef.current) return;
    navTraceLoggedRef.current = true;
    console.log("NAV_TRACE_ENABLED", { trace: navTrace, debug: true });
  }, [navDebugEnabled, navTrace]);

  useEffect(() => {
    navEvalMapRef.current = navEvalMap;
  }, [navEvalMap]);

  useEffect(() => {
    navResolvedFenMapRef.current = navResolvedFenMap;
  }, [navResolvedFenMap]);

  useEffect(() => {
    viewerEvalBarsEnabledRef.current = viewerEvalBarsEnabled;
  }, [viewerEvalBarsEnabled]);

  useEffect(() => {
    const next: Record<string, string> = {};
    resolvedBoards.forEach(board => {
      const boardKey = getEvalKey(board.boardId);
      next[boardKey] = board.status ?? "unknown";
    });
    navBoardStatusRef.current = next;
  }, [getEvalKey, resolvedBoards]);

  const markColdStartApplied = useCallback(
    (boardKey: string, boardId: string, fenHash: string) => {
      if (hasEverAppliedEvalRef.current[boardKey]) return;
      hasEverAppliedEvalRef.current[boardKey] = true;
      coldStartAppliedCountRef.current += 1;
      delete coldStartEnqueuedFenHashRef.current[boardKey];
      delete coldStartLateEligibleRef.current[boardKey];
      const queueState = coldStartQueueRef.current;
      if (queueState.byId.has(boardKey)) {
        queueState.byId.delete(boardKey);
        queueState.order = queueState.order.filter(id => id !== boardKey);
      }
      if (navDebugEnabled) {
        console.log("NAV_COLDSTART_APPLY", {
          boardId,
          fenHash6: fenHash ? fenHash.slice(0, 6) : "",
        });
      }
    },
    [navDebugEnabled]
  );

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    const dumpQueue = () => {
      const queueState = navEvalQueueRef.current;
      const queuedSet = new Set(queueState.order);
      const inflightKeys = Array.from(inflightRef.current.keys());
      const inflightSet = new Set(inflightKeys.map(key => key.split(":")[0]));
      const allBoardIds = new Set<string>();
      queueState.order.forEach(id => allBoardIds.add(id));
      Object.keys(navResolvedFenMap).forEach(id => allBoardIds.add(id));
      inflightSet.forEach(id => allBoardIds.add(id));
      const snapshot = Array.from(allBoardIds).map(boardId => {
        const boardKey = getEvalKey(boardId);
        const task = queueState.byId.get(boardKey);
        const lastAppliedAt = lastEvalAppliedAtRef.current[boardKey] ?? null;
        const lastRequestedAt = lastRequestAtRef.current[boardKey] ?? null;
        const latestFen = latestFenHashRef.current[boardKey] ?? navResolvedFenMap[boardId]?.fen ?? null;
        const lastFenHash6 = latestFen ? getFenHash(latestFen, debug).slice(0, 6) : "";
        return {
          boardId,
          tier: task?.tier ?? "rest",
          lastAppliedAt,
          lastRequestedAt,
          lastFenHash6,
          isQueued: queuedSet.has(boardKey),
          isInFlight: inflightSet.has(boardKey),
        };
      });
      console.log("NAV_QUEUE_DUMP", snapshot);
      return snapshot;
    };
    window.__navQueueDump = dumpQueue;
    console.log("NAV_QUEUE_DUMP_READY", { hasDump: true });
    return () => {
      delete window.__navQueueDump;
    };
  }, [debug, getEvalKey, navDebugEnabled, navResolvedFenMap]);

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    if (!window.__navQueueDump) {
      console.log("NAV_QUEUE_DUMP_MISSING");
    }
  }, [markColdStartApplied, navDebugEnabled]);

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    console.log("NAV_ENQUEUE_WIRED", { ok: true });
  }, [navDebugEnabled, shouldLogBoard]);

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    if (navTopSetWiredRef.current) return;
    navTopSetWiredRef.current = true;
    console.log("NAV_TOPSET_WIRED", { ok: true, size: topBoardIdSet.size });
  }, [navDebugEnabled, topBoardIdSet]);

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    if (navQueueFunctionsWiredRef.current) return;
    navQueueFunctionsWiredRef.current = true;
    console.log("NAV_QUEUE_FUNCTIONS_WIRED", {
      ok: true,
      wired: ["runEvalQueue", "enqueueEvalTask", "runFenRescue"],
    });
  }, [navDebugEnabled]);

  useEffect(() => {
    if (!navDebugEnabled) return;
    console.log("NAV_FEN_RESCUE_WIRED", { ok: true });
  }, [navDebugEnabled]);

  useEffect(() => {
    if (!navDebugEnabled || typeof window === "undefined") return;
    const heartbeat = () => {
      const now = Date.now();
      const telemetry = navEvalTelemetryRef.current;
      const prune = (values: number[]) => values.filter(ts => now - ts <= 30000);
      telemetry.startedSamples = prune(telemetry.startedSamples);
      telemetry.completedSamples = prune(telemetry.completedSamples);
      telemetry.appliedSamples = prune(telemetry.appliedSamples);
      const queueLen = navEvalQueueRef.current.order.length;
      const inFlight = inflightRef.current.size;
      const remainingColdStarts = coldStartQueueRef.current.order.length;
      const appliedColdStarts = coldStartAppliedCountRef.current;
      const eligibleLate = coldStartEligibleLateRef.current;
      const boardsWithFenReady = resolvedBoards.reduce((count, board) => {
        const resolved = navResolvedFenMap[board.boardId];
        return resolved?.fen ? count + 1 : count;
      }, 0);
      const boardsWithEval = resolvedBoards.reduce((count, board) => {
        const boardKey = getEvalKey(board.boardId);
        return navEvalMapRef.current[boardKey] ? count + 1 : count;
      }, 0);
      navMismatchSamplesRef.current = navMismatchSamplesRef.current.filter(ts => now - ts <= 30000);
      const mismatchesLast30s = navMismatchSamplesRef.current.length;
      const recentChanges = Object.entries(navFenChangeAtRef.current)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([boardId]) => ({
          boardId,
          lastFenHash6: navFenHashLogRef.current[boardId] ?? "",
          lastEvalHash6: navEvalHashLogRef.current[getEvalKey(boardId)] ?? "",
        }));
      const firstEvalPending = resolvedBoards.reduce((count, board) => {
        const resolved = navResolvedFenMap[board.boardId];
        if (!resolved?.fen) return count;
        const boardKey = getEvalKey(board.boardId);
        if (navEvalMapRef.current[boardKey]) return count;
        return count + 1;
      }, 0);
      const staleCandidates = resolvedBoards
        .map(board => {
          const boardKey = getEvalKey(board.boardId);
          const lastAppliedAt =
            lastEvalAppliedAtRef.current[boardKey] ?? navEvalMapRef.current[boardKey]?.ts ?? 0;
          if (!lastAppliedAt) return null;
          return {
            boardId: board.boardId,
            ageMs: Math.max(0, now - lastAppliedAt),
          };
        })
        .filter(Boolean) as Array<{ boardId: string; ageMs: number }>;
      staleCandidates.sort((a, b) => b.ageMs - a.ageMs);
      const stalest = staleCandidates.slice(0, 5);
      const stalestDetail = stalest.map(item => {
        const boardKey = getEvalKey(item.boardId);
        const lastAppliedAt = lastEvalAppliedAtRef.current[boardKey] ?? null;
        const lastRequestedAt = lastRequestAtRef.current[boardKey] ?? null;
        const task = navEvalQueueRef.current.byId.get(boardKey);
        const latestFen = latestFenHashRef.current[boardKey] ?? navResolvedFenMap[item.boardId]?.fen ?? null;
        const fenHash6 = latestFen ? getFenHash(latestFen, debug).slice(0, 6) : "";
        return {
          boardId: item.boardId,
          ageMs: Math.round(item.ageMs),
          priorityOrTier: task?.tier ?? "rest",
          lastAppliedAt,
          lastRequestedAt,
          fenHash6,
        };
      });
      const recentChangesLine = recentChanges
        .map(item => `${item.boardId}:${item.lastFenHash6 || "--"}:${item.lastEvalHash6 || "--"}`)
        .join(",");
      const line = `q ${queueLen}/${NAV_EVAL_QUEUE_MAX} | inFlight ${inFlight}/${NAV_EVAL_MAX_INFLIGHT} | enq ${telemetry.enqueued} evict ${telemetry.evicted} start ${telemetry.started} complete ${telemetry.completed} apply ${telemetry.applied} | NAV_COLDSTART_STATUS pending=${remainingColdStarts} applied=${appliedColdStarts} eligibleLate=${eligibleLate} | firstEvalPending=${firstEvalPending} | boardsWithFenReady=${boardsWithFenReady} boardsWithEval=${boardsWithEval} mismatchesLast30s=${mismatchesLast30s} | recentChanges=${recentChangesLine || "--"} | NAV_BAR_THRESHOLDS freshMs=${NAV_BAR_FRESH_MS} softStaleMs=${NAV_BAR_SOFT_STALE_MS} hardStaleMs=${NAV_BAR_HARD_STALE_MS} | thr30s start ${telemetry.startedSamples.length} complete ${telemetry.completedSamples.length} apply ${telemetry.appliedSamples.length} | stalest: ${stalestDetail
        .map(item => `${item.boardId}=${item.ageMs}ms`)
        .join(",")}`;
      console.log("NAV_QUEUE_HEARTBEAT", {
        line,
        queue: `${queueLen}/${NAV_EVAL_QUEUE_MAX}`,
        inFlight: `${inFlight}/${NAV_EVAL_MAX_INFLIGHT}`,
        coldStartStatus: {
          pending: remainingColdStarts,
          applied: appliedColdStarts,
          eligibleLate,
        },
        counters: {
          enqueued: telemetry.enqueued,
          evicted: telemetry.evicted,
          started: telemetry.started,
          completed: telemetry.completed,
          applied: telemetry.applied,
        },
        throughput30s: {
          started: telemetry.startedSamples.length,
          completed: telemetry.completedSamples.length,
          applied: telemetry.appliedSamples.length,
        },
        summary: {
          boardsWithFenReady,
          boardsWithEval,
          mismatchesLast30s,
          recentChanges,
        },
        stalest,
        stalestDetail,
      });
      const visibleMap = navVisibleBoardIdsRef.current;
      if (navDebugEnabled) {
        resolvedBoards.forEach(board => {
          if (!visibleMap[board.boardId]) return;
          const lastLoggedAt = navRowFenLoggedRef.current[board.boardId] ?? 0;
          if (now - lastLoggedAt < NAV_ROW_FEN_LOG_MS) return;
          const resolved = navResolvedFenMap[board.boardId];
          const fenHash6 = resolved?.fenHash ? resolved.fenHash.slice(0, 6) : "";
          navRowFenLoggedRef.current[board.boardId] = now;
          const boardKey = getEvalKey(board.boardId);
          if (shouldLogBoard(board.boardId, boardKey)) {
            console.log("NAV_ROW_FEN", {
              boardId: board.boardId,
              fenHash6,
              fenSource: resolved?.fenSource ?? "unknown",
              moveCount: resolved?.plyOrMoveCount ?? 0,
              status: board.status ?? "unknown",
              isVisible: true,
              line: `ROW_FEN boardId=${board.boardId} fenHash6=${fenHash6} source=${resolved?.fenSource ?? "unknown"} moves=${resolved?.plyOrMoveCount ?? 0} status=${board.status ?? "unknown"}`,
            });
          }
        });
      }
      resolvedBoards.forEach(board => {
        const boardId = board.boardId;
        const boardKey = getEvalKey(boardId);
        if (hasEverAppliedEvalRef.current[boardKey]) return;
        const lastLoggedAt = noEvalReasonLoggedRef.current[boardKey] ?? 0;
        if (now - lastLoggedAt < 30000) return;
        const firstSeenAt = firstSeenAtRef.current[boardKey];
        if (!firstSeenAt || now - firstSeenAt < 30000) return;
        const resolved = navResolvedFenMap[boardId];
        const pendingEval = navEvalPendingMap[boardKey] ?? false;
        const normalizedFen = resolved?.fen ?? "";
        const fenHash = resolved?.fenHash ?? "";
        let reason: "missingFen" | "fenPending" | "requestSkipped" | "error" | "unknown" = "unknown";
        if (pendingEval) {
          reason = "fenPending";
        } else if (!normalizedFen || !fenHash) {
          const parsed = parseBoardIdentifier(boardId, tournamentSlug ?? undefined);
          const roundKey = `${parsed.tournamentSlug}:${parsed.round}`;
          reason = navFetchErrorRef.current[roundKey] ? "error" : "missingFen";
        } else {
          const hasQueued =
            navEvalQueueRef.current.byId.has(boardKey) || coldStartQueueRef.current.byId.has(boardKey);
          const isInflight = Array.from(inflightRef.current.keys()).some(key => key.startsWith(`${boardKey}:`));
          const lastRequestedFenHash = lastRequestedFenHashRef.current[boardKey];
          if (hasQueued || isInflight || lastRequestedFenHash === fenHash) {
            reason = "requestSkipped";
          }
        }
        noEvalReasonLoggedRef.current[boardKey] = now;
        if (reason === "fenPending") {
          const parsed = parseBoardIdentifier(boardId, tournamentSlug ?? undefined);
          const manifestGame = getTournamentGameManifest(
            parsed.tournamentSlug,
            parsed.round,
            parsed.board
          );
          const match = getBoardKeyMatch(boardId, navBoardStateMap);
          const candidates = getBoardKeyCandidates(boardId);
          const liveRecord = match.matchedKey ? navBoardStateMap[match.matchedKey] ?? null : null;
          const liveFen = normalizeFen(liveRecord?.fen ?? null);
          const liveMovesCount = liveRecord?.plyOrMoveCount ?? 0;
          const hasPgn = parsed.tournamentSlug === "worldcup2025" && parsed.round === 1;
          console.log("NAV_NO_EVAL_REASON", {
            boardId,
            reason,
            candidatesTried: candidates.slice(0, 5),
            hasAnyMatch: Boolean(match.matchedKey),
            hasLiveRecord: Boolean(liveRecord),
            liveHasFen: Boolean(liveFen),
            liveMovesCount,
            pgnCacheHit: hasPgn,
          });
          return;
        }
        console.log("NAV_NO_EVAL_REASON", { boardId, reason });
      });
    };
    const interval = window.setInterval(heartbeat, 5000);
    heartbeat();
    return () => window.clearInterval(interval);
  }, [
    debug,
    getBoardKeyCandidates,
    getBoardKeyMatch,
    getEvalKey,
    navBoardStateMap,
    navDebugEnabled,
    navEvalPendingMap,
    navResolvedFenMap,
    resolvedBoards,
    shouldLogBoard,
    tournamentSlug,
  ]);

  const applyFetchedBoardStates = useCallback((updates: Record<string, NavFetchedBoardState>) => {
    const updateIds = Object.keys(updates);
    if (updateIds.length === 0) return;
    setNavBoardStateMap(prev => {
      let changed = false;
      const next = { ...prev };
      updateIds.forEach(boardId => {
        const incoming = updates[boardId];
        const existing = prev[boardId];
        if (
          existing &&
          existing.fen === incoming.fen &&
          existing.isFinal === incoming.isFinal &&
          existing.plyOrMoveCount === incoming.plyOrMoveCount
        ) {
          return;
        }
        next[boardId] = incoming;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, []);

  const buildFetchedBoardState = useCallback(
    (boardId: string, boardState: DgtBoardState): NavFetchedBoardState => {
      const moveList = Array.isArray(boardState.moveList)
        ? boardState.moveList
        : Array.isArray(boardState.moves)
          ? boardState.moves
          : null;
      const moveCount = moveList?.length ?? 0;
      const status = boardState.status ?? null;
      const isFinal = status === "finished" || status === "final";
      const finalFen = normalizeFen(boardState.finalFen);
      const feedFen = normalizeFen(boardState.fen);
      let fen: string | null = null;
      if (isFinal && finalFen) {
        fen = finalFen;
      } else if (feedFen) {
        fen = feedFen;
      } else if (moveCount > 0) {
        fen = resolveDerivedFen(boardId, moveList);
      }
      return {
        fen,
        isFinal,
        plyOrMoveCount: moveCount,
        updatedAt: Date.now(),
      };
    },
    [resolveDerivedFen]
  );

  const fetchRoundBoardStates = useCallback(
    async (
      slug: string,
      round: number,
      options?: { bootstrap?: boolean }
    ): Promise<Record<string, NavFetchedBoardState>> => {
      const roundKey = `${slug}:${round}`;
      const isBootstrap = options?.bootstrap === true;
      const inflightKey = isBootstrap ? `${roundKey}:bootstrap` : roundKey;
      const query = new URLSearchParams({ slug, round: String(round) });
      if (isBootstrap) {
        query.set("bootstrap", "1");
        query.set("ts", String(Date.now()));
      }
      const url = `/api/tournament/live?${query.toString()}`;
      const inflight = roundFetchInflightRef.current.get(inflightKey);
      if (inflight) return inflight;
      const getCachedBoardCount = () =>
        Object.keys(navBoardStateMap).filter(boardId =>
          boardId.startsWith(`${slug}-board${round}.`)
        ).length;
      const promise = (async () => {
        try {
          if (navDebugEnabled && isBootstrap) {
            console.log("NAV_LIVE_BOOTSTRAP_START", { url });
            console.log("NAV_LIVE_BOOTSTRAP_URL", { url });
          }
          const response = await fetch(url, { cache: "no-store" });
          if (navDebugEnabled && isBootstrap) {
            console.log("NAV_LIVE_BOOTSTRAP_STATUS", { status: response.status, ok: response.ok });
          }
          if (navDebugEnabled) {
            console.log("NAV_LIVE_FETCH_DONE", { url, status: response.status, ok: response.ok });
          }
          if (response.status === 204) {
            if (navDebugEnabled && !isBootstrap) {
              console.log("NAV_LIVE_POLL_204", { url, keptSnapshotBoardsCount: getCachedBoardCount() });
            }
            return {};
          }
          if (!response.ok) {
            if (navDebugEnabled) {
              let textSnippet = "";
              try {
                textSnippet = (await response.text()).slice(0, 160);
              } catch {
                textSnippet = "";
              }
              if (!response.ok) {
                const error = textSnippet ? `status:${response.status} ${textSnippet}` : `status:${response.status}`;
                console.log("NAV_LIVE_FETCH_FAIL", { url, error });
              }
            }
            navFetchErrorRef.current[roundKey] = {
              status: response.status,
              textSnippet: "response-not-ok",
              ts: Date.now(),
            };
            return {};
          }
          let payload: DgtLivePayload | null = null;
          try {
            payload = (await response.json()) as DgtLivePayload | null;
          } catch {
            if (navDebugEnabled) {
              console.log("NAV_LIVE_FETCH_FAIL", { url, error: "invalid-json" });
            }
            navFetchErrorRef.current[roundKey] = {
              status: response.status,
              textSnippet: "invalid-json",
              ts: Date.now(),
            };
            return {};
          }
          if (navDebugEnabled) {
            const topKeys = payload ? Object.keys(payload) : [];
            const boards = Array.isArray(payload?.boards) ? payload.boards : [];
            const boardsCount = boards.length;
            const sampleBoard = boards[0] ?? null;
            const sampleBoardKeys = sampleBoard ? Object.keys(sampleBoard) : [];
            const hasFen = Boolean(sampleBoard && ("fen" in sampleBoard || "finalFen" in sampleBoard));
            const hasMoves = Boolean(sampleBoard && ("moves" in sampleBoard || "moveList" in sampleBoard));
            const hasPgn = Boolean(sampleBoard && "pgn" in sampleBoard);
            console.log("NAV_LIVE_PAYLOAD_SHAPE", {
              topKeys,
              boardsCount,
              sampleBoardKeys,
              hasFen,
              hasMoves,
              hasPgn,
            });
            console.log("NAV_LIVE_FETCH_200", { url, boardsCount, hasFen, hasMoves });
            if (isBootstrap) {
              console.log("NAV_LIVE_BOOTSTRAP_OK", { status: 200, boardsCount, hasFen, hasMoves, hasPgn });
            }
          }
          if (!payload || !Array.isArray(payload.boards)) return {};
          const updates: Record<string, NavFetchedBoardState> = {};
          payload.boards.forEach(boardState => {
            if (!Number.isFinite(Number(boardState.board))) return;
            const boardId = buildBoardIdentifier(slug, round, Number(boardState.board));
            updates[boardId] = buildFetchedBoardState(boardId, boardState);
          });
          return updates;
        } catch (error) {
          if (navDebugEnabled) {
            const message = error instanceof Error ? error.message : "fetch-error";
            console.log("NAV_LIVE_FETCH_FAIL", { url, error: message });
          }
          navFetchErrorRef.current[roundKey] = { textSnippet: "fetch-error", ts: Date.now() };
          return {};
        }
      })();
      roundFetchInflightRef.current.set(inflightKey, promise);
      try {
        return await promise;
      } finally {
        roundFetchInflightRef.current.delete(inflightKey);
      }
    },
    [buildFetchedBoardState, navBoardStateMap, navDebugEnabled]
  );

  const runFenRescue = useCallback(
    async (boardId: string, pendingMs: number) => {
      const { normalizedBoardId, parsed } = normalizeBoardIdentifier(boardId, tournamentSlug ?? undefined);
      const boardKey = normalizedBoardId;
      if (fenRescueInflightRef.current.has(boardKey)) return;
      const attempt = (fenRescueAttemptsRef.current[boardKey] ?? 0) + 1;
      fenRescueAttemptsRef.current[boardKey] = attempt;
      if (navDebugEnabled) {
        console.log("NAV_FEN_RESCUE_START", {
          boardId,
          attempt,
          pendingMs: Math.max(0, Math.round(pendingMs)),
        });
      }
      const rescuePromise = (async () => {
        let resolvedFen: string | null = null;
        let resolvedSource: "fen" | "moves" | "pgn" | "none" = "none";
        let lastSourceTried: "live" | "manifest" | "pgn" | "none" = "none";
        let errorMessage: string | undefined;
        let plyOrMoveCount = 0;
        let isFinal = false;
        let responseFenSource: string | null = null;
        let previousFenSource: string | null = null;
        let fetchFailed = false;
        let fetchErrorMessage: string | null = null;
        let fetchStatus: number | null = null;

        const manifestGame = getTournamentGameManifest(
          parsed.tournamentSlug,
          parsed.round,
          parsed.board
        );
        if (manifestGame) {
          lastSourceTried = "manifest";
          const manifestFen = normalizeFen(manifestGame.previewFen ?? manifestGame.finalFen ?? null);
          const manifestMoves = Array.isArray(manifestGame.moveList) ? manifestGame.moveList : null;
          if (manifestFen) {
            resolvedFen = manifestFen;
            resolvedSource = "fen";
            plyOrMoveCount = manifestMoves?.length ?? 0;
            isFinal = manifestGame.status === "final" || Boolean(normalizeResultValue(manifestGame.result));
          } else if (manifestMoves && manifestMoves.length > 0) {
            const derived = buildFenFromMoveList(manifestMoves);
            if (derived) {
              resolvedFen = derived;
              resolvedSource = "moves";
              plyOrMoveCount = manifestMoves.length;
              isFinal = manifestGame.status === "final" || Boolean(normalizeResultValue(manifestGame.result));
            }
          }
        }

        if (!resolvedFen) {
          lastSourceTried = "live";
          try {
            const query = new URLSearchParams({
              slug: parsed.tournamentSlug,
              round: String(parsed.round),
              boardId,
              bootstrap: "1",
              ts: String(Date.now()),
            });
            if (navDebugEnabled) {
              query.set("debug", "1");
              query.set("rescue", "1");
              query.set("rescueBoard", normalizedBoardId);
            }
            const url = `/api/tournament/live?${query.toString()}`;
            const response = await fetch(url, { cache: "no-store" });
            fetchStatus = response.status;
            let json: unknown = null;
            try {
              json = (await response.json()) as unknown;
            } catch {
              json = null;
            }
            let boardState: DgtBoardState | null = null;
            const debugError =
              json &&
              typeof json === "object" &&
              "debug" in json &&
              typeof (json as { debug?: { error?: { message?: string; name?: string } | null } }).debug ===
                "object"
                ? (json as { debug?: { error?: { message?: string; name?: string } | null } }).debug?.error ??
                  null
                : null;
            if (!response.ok || response.status !== 200) {
              fetchFailed = true;
              fetchErrorMessage = `status:${response.status}`;
            } else if (debugError && navDebugEnabled) {
              fetchFailed = true;
              fetchErrorMessage = debugError.message ?? "debug-error";
            }
            if (json && typeof json === "object") {
              const payload = json as { board?: DgtBoardState | null; boards?: DgtBoardState[] | null };
              if (payload.board) {
                boardState = payload.board;
              } else if (Array.isArray(payload.boards)) {
                boardState =
                  payload.boards.find(board => board?.board === parsed.board) ?? null;
              }
            }
            const hasFen = Boolean(boardState?.fen || boardState?.finalFen);
            const moveList = Array.isArray(boardState?.moveList)
              ? boardState?.moveList
              : Array.isArray(boardState?.moves)
                ? boardState?.moves
                : null;
            const movesCount = moveList?.length ?? 0;
            const hasPgn = Boolean(boardState?.pgn);
            const nextFenSource =
              typeof boardState?.fenSource === "string" ? boardState.fenSource : null;
            if (nextFenSource) {
              previousFenSource = fenRescueFenSourceRef.current[boardKey] ?? null;
              fenRescueFenSourceRef.current[boardKey] = nextFenSource;
              responseFenSource = nextFenSource;
            }
            if (navDebugEnabled) {
              console.log("NAV_FEN_RESCUE_FETCH", {
                boardId,
                url,
                status: response.status,
                hasFen,
                movesCount,
                hasPgn,
              });
            }
            if (fetchFailed) {
              if (navDebugEnabled) {
                console.log("NAV_FEN_RESCUE_FETCH_ERROR", {
                  boardId,
                  status: response.status,
                  message: fetchErrorMessage,
                });
              }
              errorMessage = fetchErrorMessage ?? "fetch-failed";
            } else {
              const directFen = normalizeFen(boardState?.fen ?? boardState?.finalFen ?? null);
              if (directFen) {
                resolvedFen = directFen;
                resolvedSource = "fen";
                plyOrMoveCount = movesCount;
              } else if (moveList && moveList.length > 0) {
                const derived = buildFenFromMoveList(moveList);
                if (derived) {
                  resolvedFen = derived;
                  resolvedSource = "moves";
                  plyOrMoveCount = moveList.length;
                }
              } else if (boardState?.pgn) {
                const parsedBoard = pgnToDgtBoard(boardState.pgn, { board: parsed.board });
                if (parsedBoard.finalFen) {
                  resolvedFen = parsedBoard.finalFen;
                  resolvedSource = "pgn";
                  plyOrMoveCount = parsedBoard.moveList?.length ?? 0;
                  isFinal = true;
                } else if (Array.isArray(parsedBoard.moveList) && parsedBoard.moveList.length > 0) {
                  const derived = buildFenFromMoveList(parsedBoard.moveList);
                  if (derived) {
                    resolvedFen = derived;
                    resolvedSource = "pgn";
                    plyOrMoveCount = parsedBoard.moveList.length;
                  }
                }
              }
              if (boardState?.status === "finished" || boardState?.status === "final") {
                isFinal = true;
              }
            }
          } catch (error) {
            fetchFailed = true;
            errorMessage = error instanceof Error ? error.message : "fetch-failed";
            fetchErrorMessage = errorMessage;
          }
        }

        if (
          !resolvedFen &&
          parsed.tournamentSlug === "worldcup2025" &&
          parsed.round === 1
        ) {
          lastSourceTried = "pgn";
          try {
            const pgn = getWorldCupPgnForBoard(parsed.board);
            if (pgn) {
              const parsedBoard = pgnToDgtBoard(pgn, { board: parsed.board });
              if (parsedBoard.finalFen) {
                resolvedFen = parsedBoard.finalFen;
                resolvedSource = "pgn";
                plyOrMoveCount = parsedBoard.moveList?.length ?? 0;
                isFinal = true;
              } else if (Array.isArray(parsedBoard.moveList) && parsedBoard.moveList.length > 0) {
                const derived = buildFenFromMoveList(parsedBoard.moveList);
                if (derived) {
                  resolvedFen = derived;
                  resolvedSource = "pgn";
                  plyOrMoveCount = parsedBoard.moveList.length;
                }
              }
            }
          } catch (error) {
            errorMessage = error instanceof Error ? error.message : "pgn-failed";
          }
        }

        fenRescueLastSourceRef.current[boardKey] = lastSourceTried;

        const isFallbackSource = (value?: string | null) =>
          value === "initialFallback" || value === "errorFallback";

        if (resolvedFen && resolvedSource !== "none") {
          fenRescueResolvedSourceRef.current[boardKey] = resolvedSource;
          if (
            responseFenSource &&
            !isFallbackSource(responseFenSource) &&
            isFallbackSource(previousFenSource)
          ) {
            const oldHash6 = (latestFenHashRef.current[boardKey] ?? "").slice(0, 6);
            const newHash = resolvedFen ? getFenHash(resolvedFen, debug) : "";
            const newHash6 = newHash ? newHash.slice(0, 6) : "";
            if (newHash) {
              latestFenHashRef.current[boardKey] = newHash;
            }
            delete lastRequestedFenHashRef.current[boardKey];
            delete lastRequestAtRef.current[boardKey];
            if (navDebugEnabled) {
              console.log("NAV_FEN_UPGRADE", {
                boardId,
                from: "initialFallback",
                to: responseFenSource,
                oldHash6,
                newHash6,
              });
            }
          }
          const normalizedFen = resolvedFen.trim();
          const fenHash = normalizedFen ? getFenHash(normalizedFen, debug) : "";
          const fenHash6 = fenHash ? fenHash.slice(0, 6) : "";
          const firstBoard = resolvedBoards[0];
          const firstBoardFenHash = firstBoard ? navResolvedFenMap[firstBoard.boardId]?.fenHash ?? "" : "";
          const cacheKeyHash =
            navDebugCacheEnabled && firstBoardFenHash ? firstBoardFenHash : fenHash;
          const cacheKey6 = cacheKeyHash ? cacheKeyHash.slice(0, 6) : "";
          const fenSourceForLog = responseFenSource ?? resolvedSource;
          if (navDebugEnabled && fenHash) {
            console.log("NAV_FEN_READY", {
              boardId,
              fenHash6,
              source: fenSourceForLog,
            });
          }
          const resolvedSnapshot: NavResolvedFenSnapshot = {
            fen: normalizedFen,
            fenHash,
            fenSource: "fetchedBoardState",
          };
          applyFetchedBoardStates({
            [normalizedBoardId]: {
              fen: resolvedFen,
              isFinal,
              plyOrMoveCount,
              updatedAt: Date.now(),
            },
          });
          updateFenStatus(boardKey, "ready");
          if (fenHash && cacheKeyHash) {
            const appliedHash = appliedFenHashRef.current[boardKey] ?? "";
            const existingTask = navEvalQueueRef.current.byId.get(boardKey);
            const inflightKey = `${boardKey}:${cacheKeyHash}`;
            const lastRequestedFenHash = lastRequestedFenHashRef.current[boardKey];
            const hasInflight = inflightRef.current.has(inflightKey);
            const alreadyQueued = existingTask?.cacheKeyHash === cacheKeyHash;
            const alreadyApplied = Boolean(appliedHash) && appliedHash === cacheKeyHash;
            if (!alreadyQueued && !hasInflight && !alreadyApplied && lastRequestedFenHash !== cacheKeyHash) {
              latestFenHashRef.current[boardKey] = fenHash;
              coldStartEnqueuedFenHashRef.current[boardKey] = fenHash;
              const isTopTier = topBoardIdSet.has(boardKey);
              const enqueue = enqueueEvalTaskRef.current;
              if (!enqueue) return;
              enqueue(
                {
                  boardId,
                  boardKey,
                  normalizedFen,
                  fenHash,
                  cacheKeyHash,
                  cacheKey6,
                  resolvedFen: resolvedSnapshot,
                  tier: isTopTier ? "top" : "rest",
                  enqueuedAt: Date.now(),
                  reason: "coldStart",
                },
                { prepend: true }
              );
              if (navDebugEnabled) {
                console.log("NAV_COLDSTART_IMMEDIATE", {
                  boardId,
                  fenHash6,
                  reason: "fenReady",
                });
              }
              runEvalQueueRef.current?.();
            }
          }
        } else if (fetchFailed) {
          updateFenStatus(boardKey, "pending");
          fenPendingSinceRef.current[boardKey] = Date.now();
        } else {
          updateFenStatus(boardKey, errorMessage ? "error" : "noData");
        }

        if (navDebugEnabled) {
          console.log("NAV_FEN_RESCUE_RESULT", {
            boardId,
            ok: Boolean(resolvedFen),
            source: resolvedSource,
            error: errorMessage ?? null,
          });
        }
      })();

      fenRescueInflightRef.current.set(boardKey, rescuePromise);
      try {
        await rescuePromise;
      } finally {
        fenRescueInflightRef.current.delete(boardKey);
      }
    },
    [
      applyFetchedBoardStates,
      debug,
      navDebugCacheEnabled,
      navDebugEnabled,
      navResolvedFenMap,
      resolvedBoards,
      topBoardIdSet,
      tournamentSlug,
      updateFenStatus,
    ]
  );

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const now = Date.now();
    resolvedBoards.forEach(board => {
      const boardKey = getEvalKey(board.boardId);
      if (fenStatusRef.current[boardKey] !== "pending") return;
      const pendingSince = fenPendingSinceRef.current[boardKey] ?? now;
      const pendingMs = Math.max(0, now - pendingSince);
      const attempts = fenRescueAttemptsRef.current[boardKey] ?? 0;
      const thresholdMs = earlyRescueSet.has(board.boardId)
        ? NAV_FEN_RESCUE_PENDING_EARLY_MS
        : NAV_FEN_RESCUE_PENDING_LATE_MS;
      if (pendingMs < thresholdMs) return;
      if (fenRescueInflightRef.current.has(boardKey)) return;
      if (attempts >= NAV_FEN_RESCUE_MAX_ATTEMPTS) {
        updateFenStatus(boardKey, "noData");
        return;
      }
      void runFenRescue(board.boardId, pendingMs);
    });
  }, [
    navFetchTick,
    earlyRescueSet,
    getEvalKey,
    resolvedBoards,
    runFenRescue,
    updateFenStatus,
    viewerEvalBarsEnabled,
  ]);

  const runFetchQueue = useCallback(() => {
    const queueState = fetchQueueRef.current;
    if (queueState.inFlight >= NAV_FEN_FETCH_CONCURRENCY) return;
    const nextTask = queueState.queue.shift();
    if (!nextTask) return;
    queueState.inFlight += 1;
    const { roundKey, slug, round, boardIds } = nextTask;
    if (navDebugEnabled) {
      const query = new URLSearchParams({ slug, round: String(round) });
      const url = `/api/tournament/live?${query.toString()}`;
      console.log("NAV_LIVE_FETCH_START", { url });
    }
    fetchRoundBoardStates(slug, round)
      .then(updates => {
        if (updates && Object.keys(updates).length > 0) {
          applyFetchedBoardStates(updates);
          const now = Date.now();
          Object.keys(updates).forEach(boardId => {
            lastBoardFetchAtRef.current[boardId] = now;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        const now = Date.now();
        boardIds.forEach(boardId => {
          lastBoardFetchAtRef.current[boardId] = now;
        });
        delete fetchPendingRef.current[roundKey];
        queueState.inFlight -= 1;
        runFetchQueue();
      });
  }, [applyFetchedBoardStates, fetchRoundBoardStates, navDebugEnabled]);

  const enqueueRoundFetch = useCallback(
    (task: NavBoardFetchTask) => {
      if (fetchPendingRef.current[task.roundKey]) return;
      fetchPendingRef.current[task.roundKey] = true;
      fetchQueueRef.current.queue.push(task);
      runFetchQueue();
    },
    [runFetchQueue]
  );

  const enqueueEvalTask = useCallback(
    (task: NavEvalTask, options?: { prepend?: boolean }) => {
      const queueState = navEvalQueueRef.current;
      const queueKey = task.boardKey;
      const insertAtFront = options?.prepend === true;
      const insertTask = (boardId: string) => {
        if (insertAtFront) {
          queueState.order.unshift(boardId);
        } else {
          queueState.order.push(boardId);
        }
      };
      const existing = queueState.byId.get(queueKey);
      if (existing) {
        queueState.byId.set(queueKey, { ...existing, ...task, enqueuedAt: Date.now() });
        if (existing.cacheKeyHash !== task.cacheKeyHash) {
          queueState.order = queueState.order.filter(id => id !== queueKey);
          insertTask(queueKey);
        }
        if (navDebugEnabled) {
          console.log("NAV_QUEUE_REPLACE", {
            boardId: task.boardId,
            oldFenHash6: existing.cacheKey6,
            newFenHash6: task.cacheKey6,
          });
        }
        return;
      }

      if (queueState.order.length >= NAV_EVAL_QUEUE_MAX) {
        const counts = queueState.order.reduce(
          (acc, id) => {
            const tier = queueState.byId.get(id)?.tier;
            if (tier === "top") acc.top += 1;
            if (tier === "rest") acc.rest += 1;
            return acc;
          },
          { top: 0, rest: 0 }
        );
        const oldestRest = queueState.order.find(id => queueState.byId.get(id)?.tier === "rest");
        const oldestTop = queueState.order.find(id => queueState.byId.get(id)?.tier === "top");
        let evictId: string | undefined;
        if (task.tier === "top") {
          evictId = counts.rest > 1 ? oldestRest ?? oldestTop : oldestTop ?? oldestRest;
        } else {
          evictId = counts.rest === 0 ? oldestTop ?? oldestRest : oldestRest ?? oldestTop;
        }
        if (!evictId && queueState.order.length > 0) {
          evictId = queueState.order[0];
        }
        if (evictId) {
          const evictedTask = queueState.byId.get(evictId);
          queueState.byId.delete(evictId);
          queueState.order = queueState.order.filter(id => id !== evictId);
          if (navDebugEnabled) {
            const lastAppliedAt = lastEvalAppliedAtRef.current[evictId] ?? 0;
            const evictAgeMs = lastAppliedAt ? Math.max(0, Date.now() - lastAppliedAt) : null;
            console.log("NAV_QUEUE_EVICT", {
              evictedBoardId: evictedTask?.boardId ?? evictId,
              reason: "capacity",
              ageMs: evictAgeMs,
              tier: evictedTask?.tier ?? "rest",
              queueLen: queueState.order.length,
            });
          }
          navEvalTelemetryRef.current.evicted += 1;
        }
      }

      if (queueState.order.length >= NAV_EVAL_QUEUE_MAX) {
        if (navDebugEnabled) {
          console.log("NAV_QUEUE_FULL", { capacity: NAV_EVAL_QUEUE_MAX, pendingCount: queueState.order.length });
        }
        return;
      }

      queueState.byId.set(queueKey, task);
      insertTask(queueKey);
      navEvalTelemetryRef.current.enqueued += 1;
      if (navDebugEnabled) {
        console.log("NAV_QUEUE_ENQUEUE", {
          boardId: task.boardId,
          fenHash6: task.cacheKey6,
          tier: task.tier,
          pendingCount: queueState.order.length,
        });
      }
    },
    [navDebugEnabled]
  );

  useEffect(() => {
    enqueueEvalTaskRef.current = enqueueEvalTask;
  }, [enqueueEvalTask]);

  const runEvalQueue = useCallback(() => {
    const queueState = navEvalQueueRef.current;
    while (queueState.order.length > 0 && inflightRef.current.size < NAV_EVAL_MAX_INFLIGHT) {
      const hasTop = queueState.order.some(id => queueState.byId.get(id)?.tier === "top");
      const hasRest = queueState.order.some(id => queueState.byId.get(id)?.tier === "rest");
      let nextId = queueState.order[0];
      if (hasTop && hasRest) {
        const preferredTier = queueState.lastServedTier === "top" ? "rest" : "top";
        const match = queueState.order.find(id => queueState.byId.get(id)?.tier === preferredTier);
        if (match) nextId = match;
      }
      const task = queueState.byId.get(nextId);
      queueState.byId.delete(nextId);
      queueState.order = queueState.order.filter(id => id !== nextId);
      if (!task) continue;
      queueState.lastServedTier = task.tier;

      const boardKey = task.boardKey;
      const appliedHash = appliedFenHashRef.current[boardKey] ?? "";
      const appliedHash6 = appliedHash ? appliedHash.slice(0, 6) : "";
      const hasNavEvalValue = Boolean(navEvalMapRef.current[boardKey]);
      const latestFenHash = latestFenHashRef.current[boardKey];
      if (latestFenHash && latestFenHash !== task.fenHash) {
        if (navDebugEnabled) {
          if (shouldLogBoard(task.boardId, boardKey)) {
            const lastRequestedAt = lastRequestAtRef.current[boardKey] ?? 0;
            const cooldownMsLeft = lastRequestedAt
              ? Math.max(0, NAV_EVAL_COOLDOWN_MS - (Date.now() - lastRequestedAt))
              : 0;
            console.log("NAV_EVAL_SKIP", {
              boardId: task.boardId,
              key: boardKey,
              reason: "staleFen",
              appliedHash6,
              currentHash6: task.cacheKey6,
              hasNavEvalValue,
              line: `EVAL_SKIP boardId=${task.boardId} key=${boardKey} fenHash6=${task.cacheKey6} reason=staleFen hasEvalForHash=${Boolean(
                appliedHash && appliedHash === task.cacheKeyHash
              )} appliedHash6=${appliedHash6} currentHash6=${task.cacheKey6} hasNavEvalValue=${hasNavEvalValue} lastReqHash6=${
                (lastRequestedFenHashRef.current[boardKey] ?? "").slice(0, 6)
              } cooldownMsLeft=${cooldownMsLeft} visible=${Boolean(
                navVisibleBoardIdsRef.current[task.boardId]
              )} enabled=${viewerEvalBarsEnabledRef.current}`,
            });
          }
        }
        continue;
      }

      const inflightKey = `${boardKey}:${task.cacheKeyHash}`;
      if (inflightRef.current.has(inflightKey)) continue;

      const now = Date.now();
      const lastRequestedAt = lastRequestAtRef.current[boardKey];
      if (lastRequestedAt && now - lastRequestedAt < NAV_EVAL_COOLDOWN_MS) {
        if (navDebugEnabled) {
          if (shouldLogBoard(task.boardId, boardKey)) {
            const cooldownMsLeft = Math.max(0, NAV_EVAL_COOLDOWN_MS - (now - lastRequestedAt));
            console.log("NAV_EVAL_SKIP", {
              boardId: task.boardId,
              key: boardKey,
              reason: "cooldown",
              appliedHash6,
              currentHash6: task.cacheKey6,
              hasNavEvalValue,
              line: `EVAL_SKIP boardId=${task.boardId} key=${boardKey} fenHash6=${task.cacheKey6} reason=cooldown hasEvalForHash=${Boolean(
                appliedHash && appliedHash === task.cacheKeyHash
              )} appliedHash6=${appliedHash6} currentHash6=${task.cacheKey6} hasNavEvalValue=${hasNavEvalValue} lastReqHash6=${
                (lastRequestedFenHashRef.current[boardKey] ?? "").slice(0, 6)
              } cooldownMsLeft=${cooldownMsLeft} visible=${Boolean(
                navVisibleBoardIdsRef.current[task.boardId]
              )} enabled=${viewerEvalBarsEnabledRef.current}`,
            });
          }
        }
        continue;
      }

      const requestId = `nav-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const payload = {
        boardId: task.boardId,
        fen: task.resolvedFen.fen,
        movetimeMs: NAV_LITE_EVAL_MOVETIME_MS,
        multiPv: 1,
        requestId,
        searchMode: "time",
        profileId: "light",
      };
      const requestUrl = `/api/engine/eval?mode=lite${navDebugEnabled ? "&debug=1" : ""}`;
      if (navDebugEnabled) {
        const fenSource = task.resolvedFen.fenSource;
        const reason = task.reason ?? "fenChange";
        if (shouldLogBoard(task.boardId, boardKey)) {
          const isVisible = Boolean(navVisibleBoardIdsRef.current[task.boardId]);
          const status = navBoardStatusRef.current[boardKey] ?? "unknown";
          const requestFenHash6 = task.resolvedFen.fenHash.slice(0, 6);
          console.log("NAV_EVAL_REQUEST", {
            boardId: task.boardId,
            fenHash6: requestFenHash6,
            cacheKey6: task.cacheKey6,
            fenSource,
            reason,
            line: `EVAL_REQ boardId=${task.boardId} key=${boardKey} fenHash6=${requestFenHash6} source=${fenSource} reason=${reason} visible=${isVisible} status=${status}`,
          });
        }
      }

      lastRequestedFenHashRef.current[boardKey] = task.cacheKeyHash;
      lastRequestAtRef.current[boardKey] = now;

      const startedAt = now;
      const runRequest = async (): Promise<NavEvalOutcome> => {
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
        const line = Array.isArray(json?.lines) ? json.lines[0] : undefined;
        const cpRaw = Number(line?.scoreCp);
        const mateRaw = Number(line?.scoreMate);
        if (navDebugEnabled) {
          console.log("NAV_EVAL_RESPONSE", {
            boardId: task.boardId,
            fenHash6: task.cacheKey6,
            hasCp: Number.isFinite(cpRaw),
            hasMate: Number.isFinite(mateRaw),
          });
        }
        if (!response.ok) {
          return {
            eval: null,
            ok: false,
            status,
            errorMessage: json?.error ?? "lite eval failed",
          };
        }
        const evalPayload =
          Number.isFinite(mateRaw) ? { mate: mateRaw } : Number.isFinite(cpRaw) ? { cp: cpRaw } : null;
        if (!evalPayload) {
          return {
            eval: null,
            ok: false,
            status,
            errorMessage: json?.error ?? "lite eval failed",
          };
        }
        return { eval: evalPayload, ok: true, status, errorMessage: null };
      };

      const promise = runRequest();
      inflightRef.current.set(inflightKey, promise);
      navEvalTelemetryRef.current.started += 1;
      navEvalTelemetryRef.current.startedSamples.push(now);
      if (navDebugEnabled) {
        console.log("NAV_QUEUE_START", {
          boardId: task.boardId,
          fenHash6: task.cacheKey6,
          inFlight: inflightRef.current.size,
        });
      }
      promise
        .then(result => {
          inflightRef.current.delete(inflightKey);
          navEvalTelemetryRef.current.completed += 1;
          navEvalTelemetryRef.current.completedSamples.push(Date.now());
          if (navDebugEnabled) {
            console.log("NAV_QUEUE_COMPLETE", {
              boardId: task.boardId,
              fenHash6: task.cacheKey6,
              elapsedMs: Math.max(0, Date.now() - startedAt),
              inFlight: inflightRef.current.size,
            });
          }
          const evalResult = result.eval;
          if (!result.ok || !evalResult) return;
          if (latestFenHashRef.current[boardKey] !== task.fenHash) {
            if (navDebugEnabled) {
              console.log("NAV_EVAL_IGNORE_STALE", { boardId: task.boardId, fenHash6: task.fenHash.slice(0, 6) });
            }
            return;
          }
          const normalized = mapEvaluationToBar(evalResult, task.normalizedFen).value;
          setNavEvalMap(prev => ({
            ...prev,
            [boardKey]: {
              cp: evalResult.cp,
              mate: evalResult.mate,
              fenHash: task.cacheKeyHash,
              requestedFenHash: task.resolvedFen.fenHash,
              appliedFenHash: task.resolvedFen.fenHash,
              fenSourceUsed: task.resolvedFen.fenSource,
              ts: Date.now(),
            },
          }));
          appliedFenHashRef.current[boardKey] = task.cacheKeyHash;
          const appliedAt = Date.now();
          lastEvalAppliedAtRef.current[boardKey] = appliedAt;
          markColdStartApplied(boardKey, task.boardId, task.fenHash);
          navEvalTelemetryRef.current.applied += 1;
          navEvalTelemetryRef.current.appliedSamples.push(appliedAt);
          if (navDebugEnabled) {
            console.log("NAV_QUEUE_APPLY", {
              boardId: task.boardId,
              fenHash6: task.cacheKey6,
              cp: evalResult.cp ?? null,
              mate: evalResult.mate ?? null,
              appliedAt,
            });
          }
          if (task.cacheKeyHash) {
            fenEvalCacheRef.current[task.cacheKeyHash] = {
              cp: result.eval.cp,
              mate: result.eval.mate,
              normalized,
              ts: Date.now(),
            };
          }
          if (navDebugEnabled) {
            const currentResolvedFenHash6 = navResolvedFenMapRef.current[task.boardId]?.fenHash
              ? navResolvedFenMapRef.current[task.boardId]?.fenHash?.slice(0, 6)
              : "";
            navEvalHashLogRef.current[boardKey] = task.cacheKey6;
            const mismatch =
              Boolean(currentResolvedFenHash6) &&
              Boolean(task.cacheKey6) &&
              currentResolvedFenHash6 !== task.cacheKey6;
            if (shouldLogBoard(task.boardId, boardKey)) {
              const appliedRequestHash6 = task.resolvedFen.fenHash.slice(0, 6);
              console.log("NAV_EVAL_APPLY", {
                boardId: task.boardId,
                appliedFenHash6: appliedRequestHash6,
                appliedFenSource: task.resolvedFen.fenSource,
                cp: result.eval.cp ?? null,
                mate: result.eval.mate ?? null,
                currentResolvedFenHash6,
                line: `EVAL_APPLY boardId=${task.boardId} key=${boardKey} appliedHash6=${appliedRequestHash6} source=${task.resolvedFen.fenSource} currentHash6=${currentResolvedFenHash6} cp=${result.eval.cp ?? "null"} mate=${result.eval.mate ?? "null"} mismatch=${mismatch}`,
              });
              if (mismatch) {
                navMismatchSamplesRef.current.push(Date.now());
                console.log("NAV_EVAL_MISMATCH", {
                  boardId: task.boardId,
                  appliedFenHash6: appliedRequestHash6,
                  currentResolvedFenHash6,
                  line: `EVAL_MISMATCH boardId=${task.boardId} key=${boardKey} appliedHash6=${appliedRequestHash6} currentHash6=${currentResolvedFenHash6}`,
                });
              }
            }
          }
        })
        .catch(() => {
          inflightRef.current.delete(inflightKey);
        })
        .finally(() => {
          runEvalQueueRef.current?.();
        });
    }
  }, [navDebugEnabled]);

  useEffect(() => {
    runEvalQueueRef.current = runEvalQueue;
  }, [runEvalQueue]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled) return;
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      setNavFetchTick(tick => tick + 1);
    }, NAV_FEN_POLL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [viewerEvalBarsEnabled]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const roundKeyMap = new Map<string, { slug: string; round: number }>();
    resolvedBoards.forEach(board => {
      const parsed = parseBoardIdentifier(board.boardId, tournamentSlug ?? undefined);
      const roundKey = `${parsed.tournamentSlug}:${parsed.round}`;
      if (!roundKeyMap.has(roundKey)) {
        roundKeyMap.set(roundKey, { slug: parsed.tournamentSlug, round: parsed.round });
      }
    });
    roundKeyMap.forEach(({ slug, round }, roundKey) => {
      if (navBootstrapRef.current[roundKey]) return;
      navBootstrapRef.current[roundKey] = true;
      fetchRoundBoardStates(slug, round, { bootstrap: true })
        .then(updates => {
          if (!updates || Object.keys(updates).length === 0) return;
          applyFetchedBoardStates(updates);
          const now = Date.now();
          Object.keys(updates).forEach(boardId => {
            lastBoardFetchAtRef.current[boardId] = now;
          });
        })
        .catch(() => {});
    });
  }, [applyFetchedBoardStates, fetchRoundBoardStates, resolvedBoards, tournamentSlug, viewerEvalBarsEnabled]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const now = Date.now();
    const roundBuckets: Record<string, NavBoardFetchTask> = {};
    resolvedBoards.forEach(board => {
      const resolved = navResolvedFenMap[board.boardId];
      if (!resolved || resolved.isFinal) return;
      const needsFetch =
        resolved.fenSource === "fetchedBoardState" ||
        resolved.fenSource === "initialFallback" ||
        resolved.fenSource === "unknown";
      if (!needsFetch) return;
      const boardKey = getEvalKey(board.boardId);
      const isTopTier = topBoardIdSet.has(boardKey);
      const intervalMs = isTopTier ? NAV_FEN_TOP_REFRESH_MS : NAV_FEN_OTHER_REFRESH_MS;
      const lastFetchAt = lastBoardFetchAtRef.current[board.boardId] ?? 0;
      if (now - lastFetchAt < intervalMs) return;
      const parsed = parseBoardIdentifier(board.boardId, tournamentSlug ?? undefined);
      const roundKey = `${parsed.tournamentSlug}:${parsed.round}`;
      if (!roundBuckets[roundKey]) {
        roundBuckets[roundKey] = {
          roundKey,
          slug: parsed.tournamentSlug,
          round: parsed.round,
          boardIds: [],
          tier: isTopTier ? "top" : "rest",
        };
      } else if (isTopTier && roundBuckets[roundKey].tier === "rest") {
        roundBuckets[roundKey].tier = "mixed";
      } else if (!isTopTier && roundBuckets[roundKey].tier === "top") {
        roundBuckets[roundKey].tier = "mixed";
      }
      roundBuckets[roundKey].boardIds.push(board.boardId);
    });
    Object.values(roundBuckets).forEach(task => {
      if (task.boardIds.length === 0) return;
      enqueueRoundFetch(task);
    });
  }, [
    enqueueRoundFetch,
    getEvalKey,
    navFetchTick,
    navResolvedFenMap,
    resolvedBoards,
    topBoardIdSet,
    tournamentSlug,
    viewerEvalBarsEnabled,
  ]);

  useEffect(() => {
    if (!navDebugEnabled) return;
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
    resolvedBoards.forEach(board => {
      const resolved = navResolvedFenMap[board.boardId];
      const source = resolved?.fenSource ?? "unknown";
      const fenHash6 = resolved?.fenHash ? resolved.fenHash.slice(0, 6) : "";
      const plyOrMoveCount = resolved?.plyOrMoveCount ?? 0;
      const isFinal = resolved?.isFinal ?? false;
      const key = `${source}:${fenHash6}:${plyOrMoveCount}:${isFinal}`;
      if (navFenSourceLogRef.current[board.boardId] === key) return;
      navFenSourceLogRef.current[board.boardId] = key;
      console.log("NAV_FEN_SOURCE", { boardId: board.boardId, source, fenHash6, plyOrMoveCount, isFinal });
    });
  }, [debug, navDebugEnabled, navResolvedFenMap, resolvedBoards]);

  useEffect(() => {
    if (!navDebugEnabled) return;
    const now = Date.now();
    resolvedBoards.forEach(board => {
      const resolved = navResolvedFenMap[board.boardId];
      if (!resolved || resolved.fenSource !== "unknown") return;
      const parsed = parseBoardIdentifier(board.boardId, tournamentSlug ?? undefined);
      const roundKey = `${parsed.tournamentSlug}:${parsed.round}`;
      const match = getBoardKeyMatch(board.boardId, navBoardStateMap);
      const fetched = match.matchedKey ? navBoardStateMap[match.matchedKey] ?? null : null;
      const fetchError = navFetchErrorRef.current[roundKey];
      const boardKey = getEvalKey(board.boardId);
      const intervalMs = topBoardIdSet.has(boardKey) ? NAV_FEN_TOP_REFRESH_MS : NAV_FEN_OTHER_REFRESH_MS;
      let reason: "no-entry" | "missing-fields" | "illegal-fen" | "fetch-error" | "stale-cache" = "no-entry";
      if (fetched) {
        if (!fetched.fen) {
          reason = now - fetched.updatedAt > intervalMs * 2 ? "stale-cache" : "missing-fields";
        } else {
          reason = "illegal-fen";
        }
      } else if (fetchError && now - fetchError.ts < intervalMs) {
        reason = "fetch-error";
      }
      const keysPresent = [
        board.previewFen ? "entry.previewFen" : null,
        board.finalFen ? "entry.finalFen" : null,
        Array.isArray(board.moveList) && board.moveList.length > 0 ? "entry.moveList" : null,
        board.status ? "entry.status" : null,
        board.sideToMove ? "entry.sideToMove" : null,
        Number.isFinite(Number(board.whiteTimeMs ?? NaN)) ? "entry.whiteTimeMs" : null,
        Number.isFinite(Number(board.blackTimeMs ?? NaN)) ? "entry.blackTimeMs" : null,
        Number.isFinite(Number(board.evaluation ?? NaN)) ? "entry.evaluation" : null,
        fetched ? "fetched.entry" : null,
        fetched?.fen ? "fetched.fen" : null,
        Number.isFinite(Number(fetched?.plyOrMoveCount ?? NaN)) ? "fetched.plyOrMoveCount" : null,
        fetched?.isFinal ? "fetched.isFinal" : null,
      ].filter(Boolean);
      const logKey = `${reason}:${keysPresent.join("|")}:${resolved.plyOrMoveCount}`;
      if (navFenResolveLogRef.current[board.boardId] === logKey) return;
      navFenResolveLogRef.current[board.boardId] = logKey;
      console.log("NAV_FEN_RESOLVE_FAIL", { boardId: board.boardId, reason, keysPresent });
    });
  }, [
    getBoardKeyMatch,
    getEvalKey,
    navBoardStateMap,
    navDebugEnabled,
    navResolvedFenMap,
    resolvedBoards,
    topBoardIdSet,
    tournamentSlug,
  ]);


  useEffect(() => {
    if (resolvedLayout !== "list" || sidebarOnly) return;
    if (!selectedBoardId || !selectedRowRef.current || hasAutoScrolledRef.current) return;
    const rect = selectedRowRef.current.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (inView) return;
    selectedRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    hasAutoScrolledRef.current = true;
  }, [resolvedLayout, selectedBoardId, sidebarOnly]);

  useEffect(() => {
    if (!warmEnabled || warmTriggeredRef.current) return;
    if (warmCandidates.length === 0) return;
    warmTriggeredRef.current = true;
    warmTimeoutRef.current = window.setTimeout(() => {
      const nextWarmIds = warmCandidates.reduce<Record<string, true>>((acc, board) => {
        acc[board.boardId] = true;
        return acc;
      }, {});
      setWarmBoardIds(nextWarmIds);
    }, WARM_LITE_PREFETCH_DELAY_MS);

    return () => {
      if (warmTimeoutRef.current) {
        window.clearTimeout(warmTimeoutRef.current);
        warmTimeoutRef.current = null;
      }
    };
  }, [warmCandidates, warmEnabled]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const queueState = navEvalQueueRef.current;
    const coldState = coldStartQueueRef.current;
    if (coldState.order.length === 0) return;
    if (inflightRef.current.size >= NAV_EVAL_MAX_INFLIGHT) return;
    if (queueState.order.length > NAV_COLDSTART_QUEUE_LOW_WATERMARK) return;

    const now = Date.now();
    const rateWindow = coldStartRateRef.current.filter(ts => now - ts < 60000);
    coldStartRateRef.current = rateWindow;
    let remainingBudget = NAV_COLDSTART_MAX_PER_MINUTE - rateWindow.length;
    if (remainingBudget <= 0) {
      if (navDebugEnabled) {
        console.log("NAV_COLDSTART_CAPPED", {
          maxPerMinute: NAV_COLDSTART_MAX_PER_MINUTE,
          usedInWindow: rateWindow.length,
        });
      }
      return;
    }

    const availableQueueSlots = NAV_EVAL_QUEUE_MAX - queueState.order.length;
    const availableInflightSlots = NAV_EVAL_MAX_INFLIGHT - inflightRef.current.size;
    let remainingSlots = Math.min(remainingBudget, availableQueueSlots, availableInflightSlots);
    if (remainingSlots <= 0) return;

    const firstBoard = resolvedBoards[0];
    const firstBoardFenHash = firstBoard ? navResolvedFenMap[firstBoard.boardId]?.fenHash ?? "" : "";

    let didEnqueue = false;
    const scanLimit = coldState.order.length;
    for (let i = 0; i < scanLimit && remainingSlots > 0 && remainingBudget > 0; i += 1) {
      const boardKey = coldState.order.shift();
      if (!boardKey) continue;
      const entry = coldState.byId.get(boardKey);
      const boardId = entry?.boardId ?? boardKey;
      if (hasEverAppliedEvalRef.current[boardKey]) {
        coldState.byId.delete(boardKey);
        continue;
      }
      const resolved = navResolvedFenMap[boardId];
      const pendingEval = navEvalPendingMap[boardKey] ?? false;
      const normalizedFen = resolved?.fen ?? "";
      if (!normalizedFen || pendingEval) {
        coldState.byId.delete(boardKey);
        continue;
      }
      const fenHash = resolved?.fenHash ?? "";
      if (!fenHash) {
        coldState.byId.delete(boardKey);
        continue;
      }
      const existing = coldState.byId.get(boardKey);
      if (existing && existing.fenHash !== fenHash) {
        coldState.byId.set(boardKey, { ...existing, fenHash });
      }
      const cacheKeyHash = navDebugCacheEnabled && firstBoardFenHash ? firstBoardFenHash : fenHash;
      const cacheKey6 = cacheKeyHash ? cacheKeyHash.slice(0, 6) : "";
      const lastRequestedFenHash = lastRequestedFenHashRef.current[boardKey];
      const lastRequestedAt = lastRequestAtRef.current[boardKey] ?? 0;
      if (lastRequestedFenHash === cacheKeyHash && now - lastRequestedAt < NAV_COLDSTART_RETRY_MS) {
        coldState.order.push(boardKey);
        continue;
      }
      const cached = cacheKeyHash ? fenEvalCacheRef.current[cacheKeyHash] : null;
      if (cached && now - cached.ts < NAV_EVAL_CACHE_TTL_MS) {
        setNavEvalMap(prev => ({
          ...prev,
          [boardKey]: {
            cp: cached.cp,
            mate: cached.mate,
            fenHash: cacheKeyHash,
            requestedFenHash: fenHash,
            appliedFenHash: fenHash,
            fenSourceUsed: resolved?.fenSource ?? "unknown",
            ts: now,
          },
        }));
        appliedFenHashRef.current[boardKey] = cacheKeyHash;
        lastEvalAppliedAtRef.current[boardKey] = now;
        lastRequestedFenHashRef.current[boardKey] = cacheKeyHash;
        lastRequestAtRef.current[boardKey] = now;
        markColdStartApplied(boardKey, boardId, fenHash);
        if (navDebugEnabled) {
          console.log("NAV_EVAL_CACHE_HIT", { boardId, fenHash6: cacheKey6 });
        }
        continue;
      }
      if (navDebugCacheEnabled && firstBoard && boardId !== firstBoard.boardId) {
        coldState.order.push(boardKey);
        continue;
      }
      latestFenHashRef.current[boardKey] = fenHash;
      const isTopTier = topBoardIdSet.has(boardKey);
      if (!resolved?.fenSource || !resolved?.fenHash) {
        coldState.byId.delete(boardKey);
        continue;
      }
      enqueueEvalTask(
        {
          boardId,
          boardKey,
          normalizedFen,
          fenHash,
          cacheKeyHash,
          cacheKey6,
          resolvedFen: {
            fen: normalizedFen,
            fenHash: resolved.fenHash,
            fenSource: resolved.fenSource,
          },
          tier: isTopTier ? "top" : "rest",
          enqueuedAt: now,
          reason: "coldStart",
        },
        { prepend: true }
      );
      coldState.order.push(boardKey);
      coldStartRateRef.current.push(now);
      remainingBudget -= 1;
      remainingSlots -= 1;
      didEnqueue = true;
    }
    if (didEnqueue) {
      runEvalQueueRef.current?.();
    }
  }, [
    debug,
    enqueueEvalTask,
    getEvalKey,
    markColdStartApplied,
    navDebugCacheEnabled,
    navDebugEnabled,
    navEvalPendingMap,
    navFetchTick,
    navResolvedFenMap,
    resolvedBoards,
    topBoardIdSet,
    viewerEvalBarsEnabled,
  ]);

  useEffect(() => {
    if (!viewerEvalBarsEnabled || resolvedBoards.length === 0) return;
    const firstBoard = resolvedBoards[0];
    const firstBoardFenHash = firstBoard ? navResolvedFenMap[firstBoard.boardId]?.fenHash ?? "" : "";
    const now = Date.now();
    const orderedBoards = [...resolvedBoards].sort((a, b) => {
      const aKey = getEvalKey(a.boardId);
      const bKey = getEvalKey(b.boardId);
      const aLast = lastEvalAppliedAtRef.current[aKey] ?? 0;
      const bLast = lastEvalAppliedAtRef.current[bKey] ?? 0;
      const aThreshold = topBoardIdSet.has(aKey) ? NAV_EVAL_STALE_TOP_MS : NAV_EVAL_STALE_OTHER_MS;
      const bThreshold = topBoardIdSet.has(bKey) ? NAV_EVAL_STALE_TOP_MS : NAV_EVAL_STALE_OTHER_MS;
      const aStale = aLast > 0 && now - aLast > aThreshold;
      const bStale = bLast > 0 && now - bLast > bThreshold;
      if (aStale === bStale) return 0;
      return aStale ? -1 : 1;
    });
    let didEnqueue = false;
    orderedBoards.forEach(board => {
      const boardKey = getEvalKey(board.boardId);
      const resolved = navResolvedFenMap[board.boardId];
      const normalizedFen = resolved?.fen ?? "";
      const fenHash = resolved?.fenHash ?? "";
      const cacheKeyHash =
        navDebugCacheEnabled && firstBoardFenHash ? firstBoardFenHash : fenHash;
      const cacheKey6 = cacheKeyHash ? cacheKeyHash.slice(0, 6) : "";
      const fenHash6 = fenHash ? fenHash.slice(0, 6) : "";
      const moveCount = resolved?.plyOrMoveCount ?? 0;
      const source = resolved?.fenSource ?? "unknown";
      const pendingEval = navEvalPendingMap[boardKey] ?? false;
      const isTopTier = topBoardIdSet.has(boardKey);
      const staleThreshold = isTopTier ? NAV_EVAL_STALE_TOP_MS : NAV_EVAL_STALE_OTHER_MS;
      const lastEvalAppliedAt = lastEvalAppliedAtRef.current[boardKey] ?? 0;
      const staleAgeMs = lastEvalAppliedAt > 0 ? now - lastEvalAppliedAt : 0;
      const isStale = lastEvalAppliedAt > 0 && staleAgeMs > staleThreshold;
      if (navDebugEnabled) {
        console.log("NAV_EVAL_ROW", {
          boardId: board.boardId,
          hasFen: Boolean(normalizedFen),
          fenHash6,
          source,
          moveCount,
          pending: pendingEval,
        });
        if (isStale) {
          console.log("NAV_STALE_BUMP", {
            boardId: board.boardId,
            ageMs: Math.round(staleAgeMs),
            tier: isTopTier ? "top" : "rest",
          });
        }
      }
      if (!normalizedFen || !fenHash || pendingEval) {
        if (navDebugEnabled) {
          if (shouldLogBoard(board.boardId, boardKey)) {
            const cooldownMsLeft = lastRequestAtRef.current[boardKey]
              ? Math.max(0, NAV_EVAL_COOLDOWN_MS - (now - (lastRequestAtRef.current[boardKey] ?? 0)))
              : 0;
            const appliedHash = appliedFenHashRef.current[boardKey] ?? "";
            const appliedHash6 = appliedHash ? appliedHash.slice(0, 6) : "";
            const hasNavEvalValue = Boolean(navEvalMapRef.current[boardKey]);
            console.log("NAV_EVAL_SKIP", {
              boardId: board.boardId,
              key: boardKey,
              reason: pendingEval ? "pending" : "noFen",
              appliedHash6,
              currentHash6: cacheKey6,
              hasNavEvalValue,
              line: `EVAL_SKIP boardId=${board.boardId} key=${boardKey} fenHash6=${fenHash6} reason=${
                pendingEval ? "pending" : "noFen"
              } hasEvalForHash=${Boolean(
                appliedHash && appliedHash === cacheKeyHash
              )} appliedHash6=${appliedHash6} currentHash6=${cacheKey6} hasNavEvalValue=${hasNavEvalValue} lastReqHash6=${
                (lastRequestedFenHashRef.current[boardKey] ?? "").slice(0, 6)
              } cooldownMsLeft=${cooldownMsLeft} visible=${Boolean(
                navVisibleBoardIdsRef.current[board.boardId]
              )} enabled=${viewerEvalBarsEnabledRef.current}`,
            });
          }
        }
        return;
      }

      latestFenHashRef.current[boardKey] = fenHash;
      const lastRequestedFenHash = lastRequestedFenHashRef.current[boardKey];
      if (lastRequestedFenHash === cacheKeyHash && !isStale) {
        if (navDebugEnabled) {
          if (shouldLogBoard(board.boardId, boardKey)) {
            const cooldownMsLeft = lastRequestAtRef.current[boardKey]
              ? Math.max(0, NAV_EVAL_COOLDOWN_MS - (now - (lastRequestAtRef.current[boardKey] ?? 0)))
              : 0;
            const appliedHash = appliedFenHashRef.current[boardKey] ?? "";
            const appliedHash6 = appliedHash ? appliedHash.slice(0, 6) : "";
            const hasNavEvalValue = Boolean(navEvalMapRef.current[boardKey]);
            console.log("NAV_EVAL_SKIP", {
              boardId: board.boardId,
              key: boardKey,
              reason: "sameFen",
              appliedHash6,
              currentHash6: cacheKey6,
              hasNavEvalValue,
              line: `EVAL_SKIP boardId=${board.boardId} key=${boardKey} fenHash6=${fenHash6} reason=sameFen hasEvalForHash=${Boolean(
                appliedHash && appliedHash === cacheKeyHash
              )} appliedHash6=${appliedHash6} currentHash6=${cacheKey6} hasNavEvalValue=${hasNavEvalValue} lastReqHash6=${
                (lastRequestedFenHashRef.current[boardKey] ?? "").slice(0, 6)
              } cooldownMsLeft=${cooldownMsLeft} visible=${Boolean(
                navVisibleBoardIdsRef.current[board.boardId]
              )} enabled=${viewerEvalBarsEnabledRef.current}`,
            });
          }
        }
        return;
      }
      const lastRequestedAt = lastRequestAtRef.current[boardKey];
      if (lastRequestedAt && now - lastRequestedAt < NAV_EVAL_COOLDOWN_MS) {
        if (navDebugEnabled) {
          if (shouldLogBoard(board.boardId, boardKey)) {
            const cooldownMsLeft = Math.max(0, NAV_EVAL_COOLDOWN_MS - (now - lastRequestedAt));
            const appliedHash = appliedFenHashRef.current[boardKey] ?? "";
            const appliedHash6 = appliedHash ? appliedHash.slice(0, 6) : "";
            const hasNavEvalValue = Boolean(navEvalMapRef.current[boardKey]);
            console.log("NAV_EVAL_SKIP", {
              boardId: board.boardId,
              key: boardKey,
              reason: "cooldown",
              appliedHash6,
              currentHash6: cacheKey6,
              hasNavEvalValue,
              line: `EVAL_SKIP boardId=${board.boardId} key=${boardKey} fenHash6=${fenHash6} reason=cooldown hasEvalForHash=${Boolean(
                appliedHash && appliedHash === cacheKeyHash
              )} appliedHash6=${appliedHash6} currentHash6=${cacheKey6} hasNavEvalValue=${hasNavEvalValue} lastReqHash6=${
                (lastRequestedFenHashRef.current[boardKey] ?? "").slice(0, 6)
              } cooldownMsLeft=${cooldownMsLeft} visible=${Boolean(
                navVisibleBoardIdsRef.current[board.boardId]
              )} enabled=${viewerEvalBarsEnabledRef.current}`,
            });
          }
        }
        return;
      }
      const cached = cacheKeyHash ? fenEvalCacheRef.current[cacheKeyHash] : null;
      if (cached && now - cached.ts < NAV_EVAL_CACHE_TTL_MS) {
        setNavEvalMap(prev => ({
          ...prev,
          [boardKey]: {
            cp: cached.cp,
            mate: cached.mate,
            fenHash: cacheKeyHash,
            requestedFenHash: fenHash,
            appliedFenHash: fenHash,
            fenSourceUsed: resolved?.fenSource ?? "unknown",
            ts: now,
          },
        }));
        appliedFenHashRef.current[boardKey] = cacheKeyHash;
        lastEvalAppliedAtRef.current[boardKey] = now;
        lastRequestedFenHashRef.current[boardKey] = cacheKeyHash;
        lastRequestAtRef.current[boardKey] = now;
        markColdStartApplied(boardKey, board.boardId, fenHash);
        if (navDebugEnabled) {
          console.log("NAV_EVAL_CACHE_HIT", { boardId: board.boardId, fenHash6: cacheKey6 });
        }
        return;
      }
      if (navDebugCacheEnabled && firstBoard && board.boardId !== firstBoard.boardId) {
        return;
      }
      if (!resolved?.fenSource || !resolved?.fenHash) {
        return;
      }
      enqueueEvalTask({
        boardId: board.boardId,
        boardKey,
        normalizedFen,
        fenHash,
        cacheKeyHash,
        cacheKey6,
        resolvedFen: {
          fen: normalizedFen,
          fenHash: resolved.fenHash,
          fenSource: resolved.fenSource,
        },
        tier: isTopTier ? "top" : "rest",
        enqueuedAt: now,
        reason: "fenChange",
      });
      didEnqueue = true;
    });
    if (didEnqueue) {
      runEvalQueueRef.current?.();
    }
  }, [
    debug,
    enqueueEvalTask,
    getEvalKey,
    markColdStartApplied,
    navDebugCacheEnabled,
    navDebugEnabled,
    navEvalPendingMap,
    navResolvedFenMap,
    resolvedBoards,
    shouldLogBoard,
    topBoardIdSet,
    viewerEvalBarsEnabled,
  ]);

  const updateSelectedParam = (boardId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selected", boardId);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  if (resolvedLayout === "list") {
    const listGridCols = "grid-cols-[repeat(auto-fit,minmax(260px,1fr))]";
    const renderPlayerRow = (
      player: BoardNavigationEntry["white"],
      fallbackLabel: string,
      scorePrefix?: string | null
    ) => {
      const ratingValue = Number.isFinite(player?.rating ?? NaN) ? String(player.rating) : "—";
      const ratingTone = ratingValue === "—" ? "text-slate-500/80" : "text-slate-400";
      return (
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-slate-50">
          {player?.flag ? (
            <Flag country={player.flag} className="text-base leading-none" />
          ) : (
            <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
          )}
          {player?.title ? <TitleBadge title={player.title} /> : null}
          {scorePrefix ? (
            <span className="mr-0.5 text-[11px] font-semibold leading-none tabular-nums text-slate-200">
              {scorePrefix}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{player?.name || fallbackLabel}</span>
          <span className={`ml-auto text-[11px] font-semibold tabular-nums ${ratingTone}`}>
            {ratingValue}
          </span>
        </div>
      );
    };
    const sidebarListPadding = variant === "tournament" ? "p-1.5" : "p-2";
    const rowHeightClass = "h-[var(--nav-row-h)]";
    const sidebarListBody = isEmpty ? (
      <div className="flex items-center justify-center px-2 pb-3 text-sm text-slate-400">
        {emptyLabel}
      </div>
    ) : (
      <div className="flex flex-col gap-1.5">
        {resolvedSidebarBoards.map(board => {
          const statusLabel = getBoardStatusLabel(board);
          const normalizedResult = normalizeResultValue(board.result);
          const scorePrefixWhite =
            normalizedResult === "1-0"
              ? "1"
              : normalizedResult === "0-1"
                ? "0"
                : normalizedResult === "1/2-1/2"
                  ? "\u00bd"
                  : null;
          const scorePrefixBlack =
            normalizedResult === "1-0"
              ? "0"
              : normalizedResult === "0-1"
                ? "1"
                : normalizedResult === "1/2-1/2"
                  ? "\u00bd"
                  : null;
          const isFinished = board.status === "final" || Boolean(normalizedResult);
          const statusMode = isFinished ? "replay" : "live";
          const resolvedMode = variant === "tournament" ? statusMode : mode ?? statusMode;
          const baseHref = buildBroadcastBoardPath(board.boardId, resolvedMode, tournamentSlug);
          const href = `${baseHref}${linkQuery}`;
          const isSelected = selectedBoardId === board.boardId;
          const rowClass = isSelected
            ? "border-sky-400/70 bg-slate-800/90 text-slate-100"
            : "border-white/10 bg-slate-900/70 text-slate-200 hover:border-white/30 hover:bg-slate-900/90";

          return (
            <Link
              key={board.boardId}
              href={href}
              scroll={false}
              ref={isSelected ? selectedRowRef : null}
              onClick={event => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                if (debug) {
                  const gameIndex = Math.max(0, board.boardNumber - 1);
                  console.log("BOARD_CLICK", {
                    boardId: board.boardId,
                    roundId: debugRoundId ?? null,
                    gameIndex,
                    route: href,
                  });
                }
                updateSelectedParam(board.boardId);
              }}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition ${rowHeightClass} ${rowClass}`}
            >
              <div className="flex h-7 items-center justify-center rounded-lg border border-white/10 bg-slate-950/70 px-2 text-[11px] font-semibold tabular-nums text-slate-200">
                {variant === "tournament" ? `#${board.boardNumber}` : board.boardNumber}
              </div>
              <div className="min-w-0 flex-1">
                {variant === "tournament" ? (
                  <div className="flex min-w-0 flex-col">
                    {renderPlayerRow(
                      board.white,
                      `Board #${board.boardNumber}`,
                      isFinished ? scorePrefixWhite : null
                    )}
                    {renderPlayerRow(
                      board.black,
                      "White / Black",
                      isFinished ? scorePrefixBlack : null
                    )}
                  </div>
                ) : (
                  <>
                    <div className="truncate text-[12px] font-semibold text-slate-50">
                      {board.white?.name || `Board #${board.boardNumber}`}
                    </div>
                    <div className="truncate text-[11px] text-slate-400">
                      {board.black?.name || "White / Black"}
                    </div>
                  </>
                )}
              </div>
              {!isFinished && statusLabel !== "\u2014" ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">
                  {statusLabel}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    );
    const sidebarList = (
      <div className={`rounded-2xl border border-white/10 bg-slate-950/70 ${sidebarListPadding}`}>
        {variant === "tournament" ? null : (
          <div className="px-2 pb-2 text-[11px] font-semibold text-slate-500">Pairings</div>
        )}
        {sidebarListBody}
      </div>
    );

    const sidebarOnlyPadding = compact
      ? "px-1 pb-0.5"
      : variant === "tournament"
        ? "px-0 pb-1"
        : "px-1.5 pb-1 sm:px-2";

    if (sidebarOnly) {
      return (
        <div className={`${sidebarOnlyPadding} overflow-x-hidden`}>
          {sidebarList}
        </div>
      );
    }

    return (
      <div className={`${compact ? "px-1 pb-0.5" : "px-1.5 pb-1 sm:px-2"} overflow-x-hidden`}>
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row">
          <div className="w-full lg:w-[280px] lg:min-w-[260px] lg:max-w-[320px] lg:flex-none">
            {sidebarList}
          </div>
          <div className="min-w-0 flex-1">
            <div className={`grid ${listGridCols} overflow-x-hidden ${gridGaps}`}>
              {resolvedBoards.map(board => (
                <BoardsNavigationCard
                  key={board.boardId}
                  board={board}
                  currentBoardId={currentBoardId}
                  paneQuery={paneQuery}
                  compact={compact}
                  tournamentSlug={tournamentSlug}
                  mode={mode}
                  variant={variant}
                  viewerEvalBars={viewerEvalBars}
                  clockNowMs={clockNowMs}
                  navEval={
                    viewerEvalBarsEnabled ? navEvalMap[getEvalKey(board.boardId)] ?? null : undefined
                  }
                  navFen={viewerEvalBarsEnabled ? navResolvedFenMap[board.boardId] ?? null : undefined}
                  navEvalPending={
                    viewerEvalBarsEnabled ? navEvalPendingMap[getEvalKey(board.boardId)] ?? false : false
                  }
                  navEvalNoData={viewerEvalBarsEnabled ? navEvalNoDataMap[board.boardId] ?? false : false}
                  debug={debug}
                  debugRoundId={debugRoundId}
                  linkQuery={linkQuery}
                  sharedFenCache={(() => {
                    const fenHash = navResolvedFenMap[board.boardId]?.fenHash ?? "";
                    return Boolean(fenHash && (fenHashCounts[fenHash] ?? 0) > 1);
                  })()}
                  warmLiteEval={Boolean(warmBoardIds[board.boardId])}
                  autoEvalEnabled={Boolean(autoEnabledBoardIds[board.boardId])}
                  onBoardClick={onBoardClick}
                  onDebugVisibilityChange={handleDebugVisibilityChange}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex flex-1 items-center justify-center px-2 pb-3 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`${gridWrapperPadding} ${gridOverflowClass}`}>
      <div className={`grid ${gridCols} ${gridGaps} ${variant === "tournament" ? "overflow-visible" : "overflow-x-hidden"}`}>
        {resolvedBoards.map(board => (
          <BoardsNavigationCard
            key={board.boardId}
            board={board}
            currentBoardId={currentBoardId}
            paneQuery={paneQuery}
            compact={compact}
            tournamentSlug={tournamentSlug}
            mode={mode}
            variant={variant}
            viewerEvalBars={viewerEvalBars}
            clockNowMs={clockNowMs}
            navEval={viewerEvalBarsEnabled ? navEvalMap[getEvalKey(board.boardId)] ?? null : undefined}
            navFen={viewerEvalBarsEnabled ? navResolvedFenMap[board.boardId] ?? null : undefined}
            navEvalPending={
              viewerEvalBarsEnabled ? navEvalPendingMap[getEvalKey(board.boardId)] ?? false : false
            }
            navEvalNoData={viewerEvalBarsEnabled ? navEvalNoDataMap[board.boardId] ?? false : false}
            debug={debug}
            debugRoundId={debugRoundId}
            linkQuery={linkQuery}
            sharedFenCache={(() => {
              const fenHash = navResolvedFenMap[board.boardId]?.fenHash ?? "";
              return Boolean(fenHash && (fenHashCounts[fenHash] ?? 0) > 1);
            })()}
            warmLiteEval={Boolean(warmBoardIds[board.boardId])}
            autoEvalEnabled={Boolean(autoEnabledBoardIds[board.boardId])}
            onBoardClick={onBoardClick}
            onDebugVisibilityChange={handleDebugVisibilityChange}
          />
        ))}
      </div>
    </div>
  );
};
