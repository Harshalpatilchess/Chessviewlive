"use client";

import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import {
  flushLatestClockCache,
  hydrateLatestClockCache,
  isReplayClockSource,
  readLatestClock,
  type LatestClockSource,
  writeLatestClock,
} from "@/lib/boards/latestClockCache";
import {
  flushLatestFenCache,
  getStartFen,
  hydrateLatestFenCache,
  isStartFen,
  readLatestFen,
  writeLatestFen,
} from "@/lib/boards/latestFenCache";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import { pgnToDgtBoard } from "@/lib/live/pgnToDgtPayload";
import { buildViewerBoardPath } from "@/lib/paths";

type DeferredReplayBoardsGridProps = {
  boards: BoardNavigationEntry[];
  tournamentSlug: string;
  selectedBoardId?: string;
  className?: string;
  mode?: "live" | "replay";
  filterQuery?: string;
  searchActive?: boolean;
  emptyStateLabel?: string;
};

const GRID_COLS = "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

type ReplayResolveReason =
  | "resolved_final"
  | "explicit_zero_moves"
  | "missing_data_pending"
  | "parse_failed"
  | "cached_start_blocking_upgrade";

type ReplayFenSource = "finalFen" | "moveList" | "replayEndpoint" | "worldcupPgn" | "none";

type ReplayFinalFenCacheEntry = {
  fen: string;
  explicitZeroMoves: boolean;
  source: ReplayFenSource;
};

type ReplayMoveDerivation = {
  fen: string | null;
  explicitZeroMoves: boolean;
  parseFailed: boolean;
};

type ReplayFenResolution = {
  fen: string | null;
  explicitZeroMoves: boolean;
  parseFailed: boolean;
  source: ReplayFenSource;
  reason: ReplayResolveReason;
};

type ReplayGameResponse = {
  ok?: boolean;
  reason?: string | null;
  moveList?: string[] | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
};

const normalizeFen = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeClockMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.max(0, Math.floor(Number(value)));
};

const hasClockData = (whiteTimeMs?: number | null, blackTimeMs?: number | null) =>
  Number.isFinite(Number(whiteTimeMs ?? NaN)) || Number.isFinite(Number(blackTimeMs ?? NaN));

const hasStartedSignal = (board: BoardNavigationEntry) => {
  const moveCount = Array.isArray(board.moveList) ? board.moveList.length : 0;
  const hasAnyClockData =
    Number.isFinite(Number(board.whiteTimeMs ?? NaN)) || Number.isFinite(Number(board.blackTimeMs ?? NaN));
  const hasEval = Number.isFinite(Number(board.evaluation ?? NaN));
  return (
    board.status === "live" ||
    board.status === "final" ||
    moveCount > 0 ||
    hasAnyClockData ||
    Boolean(board.sideToMove) ||
    hasEval
  );
};

const hasExplicitStartSignal = (board: BoardNavigationEntry) =>
  board.status === "scheduled" ||
  (Array.isArray(board.moveList) && board.moveList.length === 0 && !hasStartedSignal(board));

const deriveFenFromMoveList = (
  moveList?: string[] | null,
  options: { allowExplicitZero?: boolean } = {}
): ReplayMoveDerivation => {
  if (!Array.isArray(moveList)) {
    return { fen: null, explicitZeroMoves: false, parseFailed: false };
  }
  if (moveList.length === 0) {
    const explicitZeroMoves = options.allowExplicitZero !== false;
    return {
      fen: explicitZeroMoves ? getStartFen() : null,
      explicitZeroMoves,
      parseFailed: false,
    };
  }
  const chess = new Chess();
  for (const move of moveList) {
    try {
      const result = chess.move(move, { strict: false });
      if (!result) {
        return { fen: null, explicitZeroMoves: false, parseFailed: true };
      }
    } catch {
      return { fen: null, explicitZeroMoves: false, parseFailed: true };
    }
  }
  return { fen: chess.fen(), explicitZeroMoves: false, parseFailed: false };
};

const resolveReplayFen = (
  board: BoardNavigationEntry,
  tournamentSlug?: string | null,
  endpointMoves?: string[] | null,
  endpointReason?: ReplayResolveReason | null,
  cachedStartEvicted?: boolean
): ReplayFenResolution => {
  const fromFinalFen = normalizeFen(board.finalFen);
  if (fromFinalFen && !isStartFen(fromFinalFen)) {
    return {
      fen: fromFinalFen,
      explicitZeroMoves: false,
      parseFailed: false,
      source: "finalFen",
      reason: "resolved_final",
    };
  }

  const fromMoves = deriveFenFromMoveList(board.moveList);
  if (fromMoves.fen && (!isStartFen(fromMoves.fen) || fromMoves.explicitZeroMoves)) {
    return {
      fen: fromMoves.fen,
      explicitZeroMoves: fromMoves.explicitZeroMoves,
      parseFailed: fromMoves.parseFailed,
      source: "moveList",
      reason: fromMoves.explicitZeroMoves ? "explicit_zero_moves" : "resolved_final",
    };
  }
  let parseFailed = fromMoves.parseFailed;

  const fromEndpoint = deriveFenFromMoveList(endpointMoves, { allowExplicitZero: false });
  if (fromEndpoint.fen && !isStartFen(fromEndpoint.fen)) {
    return {
      fen: fromEndpoint.fen,
      explicitZeroMoves: false,
      parseFailed: false,
      source: "replayEndpoint",
      reason: "resolved_final",
    };
  }
  parseFailed = parseFailed || fromEndpoint.parseFailed;

  if ((tournamentSlug ?? "").trim().toLowerCase() === "worldcup2025") {
    const parsed = pgnToDgtBoard(getWorldCupPgnForBoard(board.boardNumber), {
      board: board.boardNumber,
    });
    const fromPgn = normalizeFen(parsed.finalFen);
    if (fromPgn && !isStartFen(fromPgn)) {
      return {
        fen: fromPgn,
        explicitZeroMoves: false,
        parseFailed: false,
        source: "worldcupPgn",
        reason: "resolved_final",
      };
    }
    const fromPgnMoves = deriveFenFromMoveList(parsed.moveList, { allowExplicitZero: false });
    if (fromPgnMoves.fen && !isStartFen(fromPgnMoves.fen)) {
      return {
        fen: fromPgnMoves.fen,
        explicitZeroMoves: false,
        parseFailed: false,
        source: "worldcupPgn",
        reason: "resolved_final",
      };
    }
    parseFailed = parseFailed || fromPgnMoves.parseFailed;
  }

  if (cachedStartEvicted) {
    return {
      fen: null,
      explicitZeroMoves: false,
      parseFailed,
      source: "none",
      reason: "cached_start_blocking_upgrade",
    };
  }

  if (endpointReason === "parse_failed" || parseFailed) {
    return {
      fen: null,
      explicitZeroMoves: false,
      parseFailed: true,
      source: "none",
      reason: "parse_failed",
    };
  }

  return {
    fen: null,
    explicitZeroMoves: false,
    parseFailed: false,
    source: "none",
    reason: "missing_data_pending",
  };
};

export default function DeferredReplayBoardsGrid({
  boards,
  tournamentSlug,
  selectedBoardId,
  className,
  mode = "replay",
  filterQuery,
  searchActive,
  emptyStateLabel = "No results",
}: DeferredReplayBoardsGridProps) {
  const [visible, setVisible] = useState(false);
  const [replayResolveTick, setReplayResolveTick] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const replayFinalFenCacheRef = useRef<Record<string, ReplayFinalFenCacheEntry>>({});
  const replayInFlightRef = useRef<Record<string, true>>({});
  const replayResolvedMovesRef = useRef<Record<string, string[]>>({});
  const replayResolvedClocksRef = useRef<Record<string, { whiteTimeMs: number | null; blackTimeMs: number | null }>>(
    {}
  );
  const replayResolveReasonRef = useRef<Record<string, ReplayResolveReason>>({});
  const replayEndpointTriedRef = useRef<Record<string, true>>({});
  const searchParams = useSearchParams();
  const paneParam = searchParams?.get("pane") ?? "";
  useEffect(() => {
    hydrateLatestFenCache();
    hydrateLatestClockCache();
  }, []);
  const sourceBoards = useMemo(() => {
    void replayResolveTick;
    if (mode !== "replay") {
      return boards.map(board => {
        const keyInput = {
          boardId: board.boardId,
          tournamentSlug,
          boardNumber: board.boardNumber,
        };
        const incomingPreviewFen = normalizeFen(board.previewFen);
        const incomingFinalFen = normalizeFen(board.finalFen);
        const incomingMoveFen = deriveFenFromMoveList(board.moveList, { allowExplicitZero: false }).fen;
        const incomingExplicitStart = hasExplicitStartSignal(board);
        const started = hasStartedSignal(board);
        let resolvedFen = incomingPreviewFen ?? incomingFinalFen ?? incomingMoveFen ?? null;
        let resolvedExplicitStart = false;

        if (resolvedFen && isStartFen(resolvedFen)) {
          if (incomingExplicitStart) {
            resolvedExplicitStart = true;
          } else {
            resolvedFen = null;
          }
        }

        if (!resolvedFen) {
          const cached = readLatestFen(keyInput);
          const cachedFen = normalizeFen(cached?.fen);
          const cachedExplicitStart = cached?.explicitStart === true;
          if (cachedFen && (!isStartFen(cachedFen) || cachedExplicitStart)) {
            resolvedFen = cachedFen;
            resolvedExplicitStart = cachedExplicitStart;
          }
        }

        if (!resolvedFen && incomingExplicitStart && !started) {
          resolvedFen = getStartFen();
          resolvedExplicitStart = true;
        }

        if (resolvedFen) {
          writeLatestFen(keyInput, resolvedFen, { explicitStart: resolvedExplicitStart });
        }

        const pending = !resolvedFen && started && !resolvedExplicitStart;
        return {
          ...board,
          previewFen: resolvedFen,
          miniBoardPending: pending,
          miniBoardExplicitStart: resolvedExplicitStart,
        } satisfies BoardNavigationEntry;
      });
    }
    const cache = replayFinalFenCacheRef.current;
    const resolvedMoves = replayResolvedMovesRef.current;
    const resolvedClocks = replayResolvedClocksRef.current;
    const resolveReasons = replayResolveReasonRef.current;
    const endpointTried = replayEndpointTriedRef.current;
    const inFlight = replayInFlightRef.current;
    // Keep only current board IDs and freeze only valid replay final states per board.
    const boardIdSet = new Set(boards.map(board => board.boardId));
    Object.keys(cache).forEach(boardId => {
      if (!boardIdSet.has(boardId)) {
        delete cache[boardId];
      }
    });
    Object.keys(resolvedMoves).forEach(boardId => {
      if (!boardIdSet.has(boardId)) {
        delete resolvedMoves[boardId];
      }
    });
    Object.keys(resolvedClocks).forEach(boardId => {
      if (!boardIdSet.has(boardId)) {
        delete resolvedClocks[boardId];
      }
    });
    Object.keys(resolveReasons).forEach(boardId => {
      if (!boardIdSet.has(boardId)) {
        delete resolveReasons[boardId];
      }
    });
    Object.keys(endpointTried).forEach(boardId => {
      if (!boardIdSet.has(boardId)) {
        delete endpointTried[boardId];
      }
    });
    Object.keys(inFlight).forEach(boardId => {
      if (!boardIdSet.has(boardId)) {
        delete inFlight[boardId];
      }
    });

    const normalizedBoards = boards.map(board => {
      const boardId = board.boardId;
      const keyInput = {
        boardId,
        tournamentSlug,
        boardNumber: board.boardNumber,
      };
      const cachedGlobal = readLatestFen(keyInput);
      if (!cache[boardId] && cachedGlobal) {
        const globalFen = normalizeFen(cachedGlobal.fen);
        if (globalFen && (!isStartFen(globalFen) || cachedGlobal.explicitStart)) {
          cache[boardId] = {
            fen: globalFen,
            explicitZeroMoves: cachedGlobal.explicitStart,
            source: "finalFen",
          };
        }
      }
      let cachedStartEvicted = false;
      const existingCache = cache[boardId];
      const hasIncomingFinalFen = Boolean(normalizeFen(board.finalFen) && !isStartFen(board.finalFen));
      const hasIncomingMoves = Array.isArray(board.moveList) && board.moveList.length > 0;
      if (existingCache?.explicitZeroMoves && (hasIncomingFinalFen || hasIncomingMoves)) {
        delete cache[boardId];
      }
      if (existingCache && isStartFen(existingCache.fen) && existingCache.explicitZeroMoves !== true) {
        delete cache[boardId];
        resolveReasons[boardId] = "cached_start_blocking_upgrade";
        cachedStartEvicted = true;
      }

      const cacheEntry = cache[boardId];
      const endpointMoves = resolvedMoves[boardId] ?? null;
      const endpointReason = resolveReasons[boardId] ?? null;
      const resolution: ReplayFenResolution = cacheEntry
        ? {
            fen: cacheEntry.fen,
            explicitZeroMoves: cacheEntry.explicitZeroMoves,
            parseFailed: false,
            source: cacheEntry.source,
            reason: cacheEntry.explicitZeroMoves ? "explicit_zero_moves" : "resolved_final",
          }
        : resolveReplayFen(board, tournamentSlug, endpointMoves, endpointReason, cachedStartEvicted);

      if (
        resolution.fen &&
        (!isStartFen(resolution.fen) || resolution.explicitZeroMoves)
      ) {
        writeLatestFen(keyInput, resolution.fen, { explicitStart: resolution.explicitZeroMoves });
      }

      if (
        resolution.fen &&
        (!isStartFen(resolution.fen) || resolution.explicitZeroMoves)
      ) {
        cache[boardId] = {
          fen: resolution.fen,
          explicitZeroMoves: resolution.explicitZeroMoves,
          source: resolution.source,
        };
      }
      resolveReasons[boardId] = resolution.reason;

      const normalizedFen = normalizeFen(resolution.fen);
      const replayExplicitStart = Boolean(normalizedFen && isStartFen(normalizedFen) && resolution.explicitZeroMoves);
      const incomingWhiteClockMs = normalizeClockMs(board.whiteTimeMs);
      const incomingBlackClockMs = normalizeClockMs(board.blackTimeMs);
      const endpointClock = resolvedClocks[boardId] ?? null;
      const cachedClock = readLatestClock(keyInput);
      const replayCachedClock =
        cachedClock && isReplayClockSource(cachedClock.source) ? cachedClock : null;
      let resolvedWhiteClockMs = incomingWhiteClockMs;
      let resolvedBlackClockMs = incomingBlackClockMs;
      let resolvedClockSource: LatestClockSource | null = hasClockData(incomingWhiteClockMs, incomingBlackClockMs)
        ? "replay_input"
        : null;
      if (!hasClockData(resolvedWhiteClockMs, resolvedBlackClockMs)) {
        if (endpointClock && hasClockData(endpointClock.whiteTimeMs, endpointClock.blackTimeMs)) {
          resolvedWhiteClockMs = endpointClock.whiteTimeMs;
          resolvedBlackClockMs = endpointClock.blackTimeMs;
          resolvedClockSource = "replay_endpoint";
        } else if (replayCachedClock && hasClockData(replayCachedClock.whiteTimeMs, replayCachedClock.blackTimeMs)) {
          resolvedWhiteClockMs = replayCachedClock.whiteTimeMs;
          resolvedBlackClockMs = replayCachedClock.blackTimeMs;
          resolvedClockSource = replayCachedClock.source;
        }
      }
      if (hasClockData(resolvedWhiteClockMs, resolvedBlackClockMs) && resolvedClockSource) {
        writeLatestClock(keyInput, {
          whiteTimeMs: resolvedWhiteClockMs,
          blackTimeMs: resolvedBlackClockMs,
          source: resolvedClockSource,
        });
      }
      const resolvedMoveList =
        Array.isArray(board.moveList) && board.moveList.length > 0
          ? board.moveList
          : endpointMoves ?? (resolution.explicitZeroMoves ? [] : board.moveList ?? null);
      return {
        ...board,
        moveList: resolvedMoveList,
        previewFen: normalizedFen,
        finalFen: normalizedFen,
        replayResolveReason: resolution.reason,
        replayExplicitZeroMoves: resolution.explicitZeroMoves,
        miniBoardPending: !normalizedFen && !replayExplicitStart,
        miniBoardExplicitStart: replayExplicitStart,
        whiteTimeMs: resolvedWhiteClockMs,
        blackTimeMs: resolvedBlackClockMs,
        miniEvalCp: Number.isFinite(Number(board.evaluation ?? NaN))
          ? Math.round(Number(board.evaluation) * 100)
          : null,
      } satisfies BoardNavigationEntry;
    });
    return normalizedBoards;
  }, [boards, mode, replayResolveTick, tournamentSlug]);

  useEffect(() => {
    flushLatestFenCache();
    flushLatestClockCache();
  }, [sourceBoards]);

  useEffect(() => {
    if (mode !== "replay") return;
    if ((tournamentSlug ?? "").trim().toLowerCase() !== "worldcup2025") return;
    let cancelled = false;
    sourceBoards.forEach(board => {
      const boardId = board.boardId;
      if (board.replayExplicitZeroMoves) return;
      const keyInput = {
        boardId,
        tournamentSlug,
        boardNumber: board.boardNumber,
      };
      const cachedClock = readLatestClock(keyInput);
      const replayCachedClock =
        cachedClock && isReplayClockSource(cachedClock.source) ? cachedClock : null;
      const endpointClock = replayResolvedClocksRef.current[boardId];
      const missingFen = !board.previewFen;
      const hasIncomingClock = hasClockData(board.whiteTimeMs, board.blackTimeMs);
      const hasEndpointClock = hasClockData(endpointClock?.whiteTimeMs, endpointClock?.blackTimeMs);
      const hasCachedClock = hasClockData(replayCachedClock?.whiteTimeMs, replayCachedClock?.blackTimeMs);
      const needsClock = !hasIncomingClock && !hasEndpointClock && !hasCachedClock;
      if (!missingFen && !needsClock) return;
      if (replayEndpointTriedRef.current[boardId]) return;
      if (replayInFlightRef.current[boardId]) return;
      replayInFlightRef.current[boardId] = true;
      void (async () => {
        try {
          const response = await fetch(`/api/replay/game?boardId=${encodeURIComponent(boardId)}`, {
            cache: "no-store",
          });
          const payload = (await response.json()) as ReplayGameResponse;
          const moveList = Array.isArray(payload.moveList)
            ? payload.moveList.filter((move): move is string => typeof move === "string" && move.trim().length > 0)
            : [];
          const whiteTimeMs = normalizeClockMs(payload.whiteTimeMs);
          const blackTimeMs = normalizeClockMs(payload.blackTimeMs);
          const hasResolvedClockData = hasClockData(whiteTimeMs, blackTimeMs);
          if (hasResolvedClockData) {
            replayResolvedClocksRef.current[boardId] = { whiteTimeMs, blackTimeMs };
            writeLatestClock(
              {
                boardId,
                tournamentSlug,
                boardNumber: board.boardNumber,
              },
              { whiteTimeMs, blackTimeMs, source: "replay_endpoint" }
            );
          }
          const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
          if (payload.ok === true && (moveList.length > 0 || hasResolvedClockData)) {
            replayResolvedMovesRef.current[boardId] = moveList;
            replayResolveReasonRef.current[boardId] = "resolved_final";
          } else if (reason === "pgn_parse_failed") {
            replayResolveReasonRef.current[boardId] = "parse_failed";
          } else {
            replayResolveReasonRef.current[boardId] = "missing_data_pending";
          }
          replayEndpointTriedRef.current[boardId] = true;
        } catch {
          replayResolveReasonRef.current[boardId] = "missing_data_pending";
          replayEndpointTriedRef.current[boardId] = true;
        } finally {
          delete replayInFlightRef.current[boardId];
          if (!cancelled) {
            setReplayResolveTick(tick => tick + 1);
          }
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [mode, sourceBoards, tournamentSlug]);
  const normalizedFilterQuery = useMemo(() => (filterQuery ?? "").trim().toLowerCase(), [filterQuery]);
  const filteredBoards = useMemo(() => {
    if (!normalizedFilterQuery) return sourceBoards;
    return sourceBoards.filter(board => {
      const whiteName = board.white?.name?.trim() ?? "";
      const blackName = board.black?.name?.trim() ?? "";
      const boardId = board.boardId.trim();
      const boardLabel = `Board ${board.boardNumber}`;
      const candidates = [whiteName, blackName, boardLabel, boardId]
        .map(value => value.toLowerCase())
        .filter(Boolean);
      return candidates.some(value => value.includes(normalizedFilterQuery));
    });
  }, [normalizedFilterQuery, sourceBoards]);
  const hasNoResults = normalizedFilterQuery.length > 0 && filteredBoards.length === 0;
  const isSearchViewportLocked = Boolean(searchActive) || normalizedFilterQuery.length > 0;
  const paneQuery = useMemo(
    () => (paneParam ? `?pane=${encodeURIComponent(paneParam)}` : ""),
    [paneParam]
  );
  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const buildBoardHref = useCallback(
    (board: BoardNavigationEntry) => `${buildViewerBoardPath(board.boardId, mode)}${paneQuery}`,
    [mode, paneQuery]
  );

  return (
    <div className={className}>
      <div
        className={isSearchViewportLocked ? "min-h-[22rem] max-h-[60vh] overflow-y-auto" : undefined}
        style={isSearchViewportLocked ? { overflowAnchor: "none" } : undefined}
      >
        <div ref={containerRef}>
          {visible ? (
            hasNoResults ? (
              <div className="flex min-h-[22rem] items-center justify-center rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-300">
                {emptyStateLabel}
              </div>
            ) : (
              <BoardsNavigation
                boards={filteredBoards}
                sidebarBoards={filteredBoards}
                layout="grid"
                variant="tournament"
                gridColsClassName={GRID_COLS}
                tournamentSlug={tournamentSlug}
                selectedBoardId={selectedBoardId}
                liveUpdatesEnabled={false}
                buildBoardHref={buildBoardHref}
              />
            )
          ) : (
            <div className={isSearchViewportLocked ? "h-[22rem]" : "h-10"} aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}
