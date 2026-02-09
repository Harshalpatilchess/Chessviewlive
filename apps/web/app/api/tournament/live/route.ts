import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { parseBoardIdentifier } from "@/lib/boardId";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import { buildMockTournamentPayload, buildMockTournamentSnapshot } from "@/lib/live/mockTournamentFeed";
import { deriveFenFromPgn } from "@/lib/chess/pgnServer";
import type { DgtBoardState } from "@/lib/live/dgtPayload";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";
import { resolveWorldCupReplayMoves } from "@/lib/replay/worldCupPgnResolver";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const INITIAL_CHESS_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const WORLD_CUP_SLUG = "worldcup2025";
const CLOCK_DEBUG_ALLOW_ENV = "ALLOW_TOURNAMENT_LIVE_CLOCK_DEBUG";
const CLOCK_KEYWORD_MATCHERS = [
  "clock",
  "time",
  "wtime",
  "btime",
  "remaining",
  "tick",
  "seconds",
  "ms",
  "timestamp",
] as const;
const CLOCK_EXACT_KEYS = new Set(["whitetimems", "blacktimems", "clockupdatedatms"]);

type ClockProbeSource = {
  name: string;
  value: unknown;
};

type ReplayClockMergeResult = {
  boards: DgtBoardState[];
  mergeAttempted: boolean;
  mergeAppliedBoards: number[];
  replayProbeSources: ClockProbeSource[];
};

const hasFenValue = (value?: string | null) =>
  typeof value === "string" && value.trim().length > 0;

const getBoardMoveList = (board?: DgtBoardState | null): string[] | undefined => {
  if (!board) return undefined;
  const list = Array.isArray(board.moveList)
    ? board.moveList
    : Array.isArray(board.moves)
      ? board.moves
      : null;
  if (!list || list.length === 0) return undefined;
  return list;
};

const normalizeClockMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.max(0, Math.floor(Number(value)));
};

const normalizeClockUpdatedAtMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.floor(Number(value));
};

const hasClockValue = (value?: number | null): boolean => Number.isFinite(Number(value ?? NaN));

const hasClockData = (board?: DgtBoardState | null): boolean => {
  if (!board) return false;
  return hasClockValue(board.whiteTimeMs) || hasClockValue(board.blackTimeMs);
};

const hasMissingClockValues = (board?: DgtBoardState | null): boolean => {
  if (!board) return false;
  return !hasClockValue(board.whiteTimeMs) || !hasClockValue(board.blackTimeMs);
};

const withNormalizedClockFields = (board: DgtBoardState): DgtBoardState => ({
  ...board,
  whiteTimeMs: normalizeClockMs(board.whiteTimeMs),
  blackTimeMs: normalizeClockMs(board.blackTimeMs),
  clockUpdatedAtMs: normalizeClockUpdatedAtMs(board.clockUpdatedAtMs),
});

const normalizeBoardsWithClockContract = (boards: DgtBoardState[]): DgtBoardState[] =>
  boards.map(withNormalizedClockFields);

const getClocksAvailable = (boards: DgtBoardState[]): boolean => boards.some(hasClockData);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isClockProbeEnabled = (clockProbeRequested: boolean): boolean => {
  if (!clockProbeRequested) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env[CLOCK_DEBUG_ALLOW_ENV] === "true";
};

const buildNormalizedBoardId = (slug: string, round: number, board: number) =>
  `${slug.trim().toLowerCase()}-board${Math.floor(round)}.${Math.floor(board)}`;

const shouldMergeReplayClocks = (tournamentSlug: string) => tournamentSlug.trim().toLowerCase() === WORLD_CUP_SLUG;

const sanitizeUpstreamTarget = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.replace(/worldcup2025-board\d+\.\d+/gi, "<boardId>");
  }
};

const isClockLikeKey = (key: string): boolean => {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  if (CLOCK_EXACT_KEYS.has(normalized)) return true;
  return CLOCK_KEYWORD_MATCHERS.some(matcher => normalized.includes(matcher));
};

const collectClockLikeKeys = (value: unknown, keys: Set<string>, depth = 0): void => {
  if (depth > 4 || value == null) return;
  if (Array.isArray(value)) {
    value.slice(0, 30).forEach(entry => collectClockLikeKeys(entry, keys, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, entry]) => {
    if (isClockLikeKey(key)) {
      keys.add(key);
    }
    if (entry != null && (Array.isArray(entry) || isRecord(entry))) {
      collectClockLikeKeys(entry, keys, depth + 1);
    }
  });
};

const buildClockDebugPayload = (options: {
  requested: boolean;
  enabled: boolean;
  upstreamTargets: Set<string>;
  sources: ClockProbeSource[];
  mergeAttempted: boolean;
  mergeAppliedBoards: number[];
}) => {
  const { requested, enabled, upstreamTargets, sources, mergeAttempted, mergeAppliedBoards } = options;
  if (!requested || !enabled) return null;
  const keys = new Set<string>();
  sources.forEach(source => collectClockLikeKeys(source.value, keys));
  const clockLikeKeys = Array.from(keys).sort();
  const upstream = Array.from(upstreamTargets)
    .map(sanitizeUpstreamTarget)
    .filter(Boolean)
    .sort();
  return {
    enabled: true,
    requested: true,
    upstream,
    clockLikeKeysFound: clockLikeKeys.length > 0,
    clockLikeKeys,
    mergeAttempted,
    mergeAppliedBoards: Array.from(new Set(mergeAppliedBoards)).sort((a, b) => a - b),
  };
};

const mergeMissingClockFields = (
  board: DgtBoardState,
  replayClock: { whiteTimeMs?: number | null; blackTimeMs?: number | null; clockUpdatedAtMs?: number | null }
): { board: DgtBoardState; applied: boolean } => {
  const replayWhiteMs = normalizeClockMs(replayClock.whiteTimeMs);
  const replayBlackMs = normalizeClockMs(replayClock.blackTimeMs);
  let nextBoard = board;
  let mergedAny = false;

  if (!hasClockValue(nextBoard.whiteTimeMs) && replayWhiteMs != null) {
    nextBoard = { ...nextBoard, whiteTimeMs: replayWhiteMs };
    mergedAny = true;
  }
  if (!hasClockValue(nextBoard.blackTimeMs) && replayBlackMs != null) {
    nextBoard = { ...nextBoard, blackTimeMs: replayBlackMs };
    mergedAny = true;
  }

  if (mergedAny && !hasClockValue(nextBoard.clockUpdatedAtMs)) {
    const replayUpdatedAtMs = normalizeClockUpdatedAtMs(replayClock.clockUpdatedAtMs);
    nextBoard = {
      ...nextBoard,
      clockUpdatedAtMs: replayUpdatedAtMs ?? Date.now(),
    };
  }

  return { board: nextBoard, applied: mergedAny };
};

const mergeWorldCupReplayClocks = async (options: {
  tournamentSlug: string;
  round: number;
  boards: DgtBoardState[];
  clockProbeEnabled: boolean;
}): Promise<ReplayClockMergeResult> => {
  const { tournamentSlug, round, boards, clockProbeEnabled } = options;
  const normalizedSlug = tournamentSlug.trim().toLowerCase();
  if (!shouldMergeReplayClocks(normalizedSlug) || !Array.isArray(boards) || boards.length === 0) {
    return {
      boards,
      mergeAttempted: false,
      mergeAppliedBoards: [],
      replayProbeSources: [],
    };
  }

  const nextBoards = [...boards];
  const mergeAppliedBoards: number[] = [];
  const replayProbeSources: ClockProbeSource[] = [];
  let mergeAttempted = false;

  for (let index = 0; index < nextBoards.length; index += 1) {
    const board = nextBoards[index];
    const boardNo = Number(board?.board);
    if (!Number.isFinite(boardNo) || boardNo < 1) continue;
    const safeBoardNo = Math.floor(boardNo);
    if (!hasMissingClockValues(board)) continue;
    mergeAttempted = true;
    const boardId = buildNormalizedBoardId(normalizedSlug, round, safeBoardNo);

    try {
      const replay = await resolveWorldCupReplayMoves(boardId);
      if (clockProbeEnabled) {
        replayProbeSources.push({
          name: `replayResolver:${boardId}`,
          value: replay,
        });
      }
      const replayClockUpdatedAtMs =
        isRecord(replay) && "clockUpdatedAtMs" in replay
          ? normalizeClockUpdatedAtMs((replay as { clockUpdatedAtMs?: number | null }).clockUpdatedAtMs)
          : null;
      const merged = mergeMissingClockFields(board, {
        whiteTimeMs: replay.whiteTimeMs,
        blackTimeMs: replay.blackTimeMs,
        clockUpdatedAtMs: replayClockUpdatedAtMs,
      });
      nextBoards[index] = merged.board;
      if (merged.applied) {
        mergeAppliedBoards.push(safeBoardNo);
      }
    } catch {
      // Best-effort: keep live payload resilient even when replay resolver fails.
    }
  }

  return {
    boards: nextBoards,
    mergeAttempted,
    mergeAppliedBoards,
    replayProbeSources,
  };
};

const mergePgnBoardState = (
  base: DgtBoardState | null,
  derived: { fen: string | null; moveList: string[] | null },
  pgn: string,
  boardNumber: number,
  options?: { allowOverrideFen?: boolean }
): DgtBoardState => {
  const merged: DgtBoardState = base ? { ...base } : { board: boardNumber };
  merged.pgn = pgn;
  const allowOverrideFen = options?.allowOverrideFen === true;
  if ((allowOverrideFen || !hasFenValue(merged.fen)) && hasFenValue(derived.fen)) {
    merged.fen = derived.fen;
  }
  if ((allowOverrideFen || !hasFenValue(merged.finalFen)) && hasFenValue(derived.fen)) {
    merged.finalFen = derived.fen;
  }
  const mergedMoves = getBoardMoveList(merged);
  if ((!mergedMoves || allowOverrideFen) && derived.moveList && derived.moveList.length > 0) {
    merged.moveList = derived.moveList;
  }
  return merged;
};

const deriveFenFromMoves = (moveList?: string[] | null): string | null => {
  if (!Array.isArray(moveList) || moveList.length === 0) return null;
  const chess = new Chess();
  for (const move of moveList) {
    try {
      chess.move(move, { strict: false });
    } catch {
      return null;
    }
  }
  return chess.fen();
};

const manifestStatusToDgt = (status?: string | null): DgtBoardState["status"] => {
  if (status === "final") return "finished";
  if (status === "scheduled") return "scheduled";
  return "live";
};

const manifestResultToDgt = (result?: string | null): DgtBoardState["result"] => {
  if (result === "1-0" || result === "0-1" || result === "1/2-1/2" || result === "½-½" || result === "*") {
    return result;
  }
  return null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug =
    url.searchParams.get("slug")?.trim() ??
    url.searchParams.get("tournamentSlug")?.trim() ??
    "";
  const roundRaw = url.searchParams.get("round");
  const boardIdParam = url.searchParams.get("boardId")?.trim() ?? "";
  const bootstrap = url.searchParams.get("bootstrap") === "1";
  const debugParam = url.searchParams.get("debug")?.trim() ?? "";
  const debug = debugParam === "1";
  const clockProbeRequested = debugParam === "clock";
  const clockProbeEnabled = isClockProbeEnabled(clockProbeRequested);
  const rescue = url.searchParams.get("rescue") === "1";
  const rescueBoard = url.searchParams.get("rescueBoard")?.trim() ?? "";
  const round = roundRaw ? Number(roundRaw) : NaN;
  if (!slug || !Number.isFinite(round)) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }
  const safeRound = Math.floor(round);
  const normalizedSlug = slug.trim().toLowerCase();

  const debugHeaderValue = debug
    ? `url=${url.toString()}; bootstrap=${url.searchParams.get("bootstrap") ?? ""}; active=${bootstrap ? "1" : "0"}`
    : null;

  if (boardIdParam) {
    const numericBoard = Number(boardIdParam);
    const parsed = parseBoardIdentifier(boardIdParam, slug);
    const boardNumber = Number.isFinite(numericBoard)
      ? Math.floor(numericBoard)
      : Number.isFinite(parsed.board)
        ? Math.floor(parsed.board)
        : null;
    const normalizedBoardId = buildNormalizedBoardId(normalizedSlug, safeRound, boardNumber ?? 0);
    const responsePayload = {
      tournamentSlug: normalizedSlug,
      round: safeRound,
      boards: [] as DgtBoardState[],
      board: null as DgtBoardState | null,
      clocksAvailable: false,
      reason: "notFound",
      source: "none",
    };
    if (!boardNumber || boardNumber < 1) {
      const clockDebug = buildClockDebugPayload({
        requested: clockProbeRequested,
        enabled: clockProbeEnabled,
        upstreamTargets: new Set(),
        sources: [],
        mergeAttempted: false,
        mergeAppliedBoards: [],
      });
      const response = NextResponse.json({ ...responsePayload, reason: "invalidBoardId" }, { status: 200 });
      response.headers.set("Cache-Control", "no-store");
      if (debug) {
        response.headers.set("X-CV-LIVE-SOURCE", "none");
      }
      if (clockDebug) {
        const json = {
          ...responsePayload,
          reason: "invalidBoardId",
          clockDebug,
        };
        return NextResponse.json(json, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
      return response;
    }

    try {
      const clockProbeUpstreamTargets = new Set<string>();
      const clockProbeSources: ClockProbeSource[] = [];
      const payload = buildMockTournamentPayload(normalizedSlug, safeRound);
      const payloadBoard =
        payload?.boards.find(board => board.board === boardNumber) ?? null;
      const snapshot = payloadBoard ? null : buildMockTournamentSnapshot(normalizedSlug, safeRound);
      const snapshotBoard =
        snapshot?.boards.find(board => board.board === boardNumber) ?? null;
      const manifestGame = getTournamentGameManifest(normalizedSlug, safeRound, boardNumber);
      const manifestBoard: DgtBoardState | null = manifestGame
        ? {
            board: boardNumber,
            status: manifestStatusToDgt(manifestGame.status ?? null),
            result: manifestResultToDgt(manifestGame.result),
            whiteTimeMs: manifestGame.whiteTimeMs ?? null,
            blackTimeMs: manifestGame.blackTimeMs ?? null,
            clockUpdatedAtMs: manifestGame.clockUpdatedAtMs ?? null,
            sideToMove: manifestGame.sideToMove ?? null,
            moveList: manifestGame.moveList ?? undefined,
            finalFen: manifestGame.finalFen ?? null,
            fen: manifestGame.previewFen ?? null,
          }
        : null;
      if (clockProbeEnabled) {
        clockProbeUpstreamTargets.add("local://buildMockTournamentPayload");
        clockProbeUpstreamTargets.add("local://buildMockTournamentSnapshot");
        clockProbeUpstreamTargets.add("local://getTournamentGameManifest");
        clockProbeSources.push({ name: "payloadBoard", value: payloadBoard });
        clockProbeSources.push({ name: "snapshotBoard", value: snapshotBoard });
        clockProbeSources.push({ name: "manifestBoard", value: manifestBoard });
      }
      let board = payloadBoard ?? snapshotBoard ?? manifestBoard;
      let source = payloadBoard ? "payload" : snapshotBoard ? "snapshot" : manifestBoard ? "manifest" : "none";
      let fenSource:
        | "live"
        | "pgnDerived"
        | "pgnPartial"
        | "movesFetch"
        | "initialFallback"
        | "notFound" = "notFound";
      let upstreamAttempted = false;
      let upstreamStatus: number | undefined;
      let upstreamPgn: string | null = null;
      let clockMergeAttempted = false;
      let clockMergeAppliedBoards: number[] = [];
      let derivedFromPgn = false;
      let parseError: { where: string; message: string } | null = null;
      let pgnParseMeta: {
        parseMode: string;
        movesAppliedCount: number;
        failedToken: string | null;
        pgnLength: number;
      } | null = null;
      let moveListDerivedOk = false;

      if (board && manifestBoard) {
        if (!hasFenValue(board.fen) && hasFenValue(manifestBoard.fen)) board.fen = manifestBoard.fen;
        if (!hasFenValue(board.finalFen) && hasFenValue(manifestBoard.finalFen)) {
          board.finalFen = manifestBoard.finalFen;
        }
        if (!getBoardMoveList(board) && getBoardMoveList(manifestBoard)) {
          board.moveList = getBoardMoveList(manifestBoard);
        }
        if (!Number.isFinite(Number(board.whiteTimeMs ?? NaN)) && Number.isFinite(Number(manifestBoard.whiteTimeMs ?? NaN))) {
          board.whiteTimeMs = manifestBoard.whiteTimeMs;
        }
        if (!Number.isFinite(Number(board.blackTimeMs ?? NaN)) && Number.isFinite(Number(manifestBoard.blackTimeMs ?? NaN))) {
          board.blackTimeMs = manifestBoard.blackTimeMs;
        }
        if (!Number.isFinite(Number(board.clockUpdatedAtMs ?? NaN)) && Number.isFinite(Number(manifestBoard.clockUpdatedAtMs ?? NaN))) {
          board.clockUpdatedAtMs = manifestBoard.clockUpdatedAtMs;
        }
        if (!board.sideToMove && manifestBoard.sideToMove) {
          board.sideToMove = manifestBoard.sideToMove;
        }
      }

      let boardHasFen = hasFenValue(board?.fen) || hasFenValue(board?.finalFen);
      let boardMoves = getBoardMoveList(board);

      if (board && !boardHasFen && boardMoves) {
        const derived = deriveFenFromMoves(boardMoves);
        if (derived) {
          board = { ...board, fen: derived };
          boardHasFen = true;
          moveListDerivedOk = true;
        }
      }

      if (board && !boardHasFen && !moveListDerivedOk) {
        const inlinePgn = typeof board.pgn === "string" ? board.pgn.trim() : "";
        if (inlinePgn) {
          const derived = deriveFenFromPgn(inlinePgn);
          parseError = derived.error ? derived.error : null;
          pgnParseMeta = {
            parseMode: derived.parseMode,
            movesAppliedCount: derived.movesAppliedCount,
            failedToken: derived.failedToken,
            pgnLength: inlinePgn.length,
          };
          board = mergePgnBoardState(
            board,
            { fen: derived.fen, moveList: derived.moveList },
            inlinePgn,
            boardNumber,
            { allowOverrideFen: false }
          );
          if (derived.fen) {
            derivedFromPgn = true;
          }
          boardHasFen = hasFenValue(board.fen) || hasFenValue(board.finalFen);
          boardMoves = getBoardMoveList(board);
        }
      }

      const needsUpstream =
        !boardMoves ||
        (boardMoves && !moveListDerivedOk) ||
        (pgnParseMeta ? pgnParseMeta.movesAppliedCount === 0 : false);

      if (needsUpstream && normalizedSlug === WORLD_CUP_SLUG && safeRound === 1) {
        upstreamAttempted = true;
        upstreamPgn = getWorldCupPgnForBoard(boardNumber);
        upstreamStatus = upstreamPgn ? 200 : 404;
      }

      if (upstreamPgn) {
        const derived = deriveFenFromPgn(upstreamPgn);
        parseError = derived.error ? derived.error : null;
        pgnParseMeta = {
          parseMode: derived.parseMode,
          movesAppliedCount: derived.movesAppliedCount,
          failedToken: derived.failedToken,
          pgnLength: upstreamPgn.length,
        };
        board = mergePgnBoardState(
          board,
          { fen: derived.fen, moveList: derived.moveList },
          upstreamPgn,
          boardNumber,
          { allowOverrideFen: derived.movesAppliedCount > 0 }
        );
        if (derived.movesAppliedCount > 0 || derived.fen) {
          source = source === "none" ? "pgnCache" : source;
          derivedFromPgn = true;
          boardHasFen = hasFenValue(board?.fen) || hasFenValue(board?.finalFen);
          boardMoves = getBoardMoveList(board);
          moveListDerivedOk = derived.movesAppliedCount > 0;
        } else if (board) {
          board = { ...board, pgn: upstreamPgn };
        }
      }

      if (board) {
        const moveList = Array.isArray(board.moveList)
          ? board.moveList
          : Array.isArray(board.moves)
            ? board.moves
            : null;
        const pgnSource =
          derivedFromPgn && pgnParseMeta
            ? pgnParseMeta.parseMode === "partial" || Boolean(pgnParseMeta.failedToken)
              ? "pgnPartial"
              : "pgnDerived"
            : derivedFromPgn
              ? "pgnDerived"
              : null;
        if (board.fen) {
          fenSource = pgnSource ?? "live";
        } else if (board.finalFen) {
          board = { ...board, fen: board.finalFen };
          fenSource = pgnSource ?? "live";
        } else if (moveList && moveList.length > 0) {
          const derived = deriveFenFromMoves(moveList);
          if (derived) {
            board = { ...board, fen: derived };
            fenSource = pgnSource ?? "movesFetch";
          }
        }
        if (!board.fen) {
          board = { ...board, fen: INITIAL_CHESS_FEN };
          fenSource = "initialFallback";
        }
        const replayClockMerge = await mergeWorldCupReplayClocks({
          tournamentSlug: normalizedSlug,
          round: safeRound,
          boards: [board],
          clockProbeEnabled,
        });
        board = replayClockMerge.boards[0] ?? board;
        clockMergeAttempted = replayClockMerge.mergeAttempted;
        clockMergeAppliedBoards = replayClockMerge.mergeAppliedBoards;
        if (clockProbeEnabled && replayClockMerge.replayProbeSources.length > 0) {
          replayClockMerge.replayProbeSources.forEach(source => clockProbeSources.push(source));
          clockProbeUpstreamTargets.add("apps/web/public/tournaments/worldcup2025/pgn/<boardId>.pgn");
        }
        board = withNormalizedClockFields({ ...board, fenSource });
      } else {
        fenSource = "notFound";
      }

      if (debug && pgnParseMeta) {
        if (pgnParseMeta.failedToken || parseError) {
          console.log("LIVE_PGN_DERIVE_FAIL", {
            boardId: normalizedBoardId,
            message: parseError?.message ?? "pgn-parse-failed",
            failedToken: pgnParseMeta.failedToken ?? undefined,
          });
        } else {
          console.log("LIVE_PGN_DERIVE_OK", {
            boardId: normalizedBoardId,
            parseMode: pgnParseMeta.parseMode,
            movesAppliedCount: pgnParseMeta.movesAppliedCount,
            fenSource,
          });
        }
      }

      const responseBoards = board ? [board] : [];
      const clocksAvailable = getClocksAvailable(responseBoards);
      const clockDebug = buildClockDebugPayload({
        requested: clockProbeRequested,
        enabled: clockProbeEnabled,
        upstreamTargets: clockProbeUpstreamTargets,
        sources: clockProbeSources,
        mergeAttempted: clockMergeAttempted,
        mergeAppliedBoards: clockMergeAppliedBoards,
      });
      const response = NextResponse.json(
        {
          ...responsePayload,
          board: board ?? null,
          boards: responseBoards,
          clocksAvailable,
          reason: board ? null : "notFound",
          source,
          ...(debug
            ? {
                debug: {
                  ...(rescue
                    ? {
                        rescue: true,
                        rescueBoard,
                      }
                    : {}),
                  requestedBoardId: boardIdParam,
                  matchedKey: normalizedBoardId,
                  boardFound: Boolean(board),
                  fenSource,
                  upstreamAttempted,
                  upstreamStatus,
                  movesCount: pgnParseMeta
                    ? pgnParseMeta.movesAppliedCount
                    : Array.isArray(board?.moveList)
                      ? board!.moveList.length
                      : Array.isArray(board?.moves)
                        ? board!.moves.length
                        : 0,
                  hasPgn: Boolean(board?.pgn),
                  parseMode: pgnParseMeta?.parseMode ?? null,
                  movesAppliedCount: pgnParseMeta?.movesAppliedCount ?? null,
                  failedToken: pgnParseMeta?.failedToken ?? null,
                  pgnLength: pgnParseMeta?.pgnLength ?? (board?.pgn ? board.pgn.length : 0),
                  ...(parseError ? { error: parseError } : {}),
                },
              }
            : {}),
          ...(clockDebug ? { clockDebug } : {}),
        },
        { status: 200 }
      );
      response.headers.set("Cache-Control", "no-store");
      if (debug) {
        response.headers.set("X-CV-LIVE-SOURCE", source);
      }
      return response;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unknown-error");
      const message = err.message || "unknown-error";
      const name = err.name || "Error";
      const where = "boardId-handler";
      if (debug) {
        console.log("LIVE_BOARD_RESOLVE_ERROR", {
          boardId: boardIdParam,
          slug: normalizedSlug,
          round: safeRound,
          where,
          message,
        });
      }
      const clockProbeUpstreamTargets = new Set<string>();
      const clockProbeSources: ClockProbeSource[] = [];
      if (clockProbeEnabled) {
        clockProbeUpstreamTargets.add("local://getTournamentGameManifest");
      }
      let boardFound = false;
      let fallbackBoard: DgtBoardState | null = null;
      try {
        const manifestGame = getTournamentGameManifest(normalizedSlug, safeRound, boardNumber);
        if (manifestGame) {
          boardFound = true;
          fallbackBoard = {
            board: boardNumber,
            status: manifestStatusToDgt(manifestGame.status ?? null),
            result: manifestResultToDgt(manifestGame.result),
            whiteTimeMs: manifestGame.whiteTimeMs ?? null,
            blackTimeMs: manifestGame.blackTimeMs ?? null,
            clockUpdatedAtMs: manifestGame.clockUpdatedAtMs ?? null,
            sideToMove: manifestGame.sideToMove ?? null,
            moveList: manifestGame.moveList ?? undefined,
            finalFen: manifestGame.finalFen ?? null,
            fen: manifestGame.previewFen ?? null,
          };
          if (clockProbeEnabled) {
            clockProbeSources.push({ name: "manifestFallbackBoard", value: fallbackBoard });
          }
        }
      } catch {
        boardFound = false;
      }

      let fenSource: "errorFallback" | "initialFallback" | "notFound" = "notFound";
      if (boardFound) {
        fallbackBoard = fallbackBoard ?? { board: boardNumber };
        if (!fallbackBoard.fen) {
          fallbackBoard.fen = INITIAL_CHESS_FEN;
          fenSource = "initialFallback";
        } else {
          fenSource = "errorFallback";
        }
        fallbackBoard.fenSource = fenSource;
        fallbackBoard = withNormalizedClockFields(fallbackBoard);
      }

      const responseBoards = boardFound && fallbackBoard ? [fallbackBoard] : [];
      const clocksAvailable = getClocksAvailable(responseBoards);
      const clockDebug = buildClockDebugPayload({
        requested: clockProbeRequested,
        enabled: clockProbeEnabled,
        upstreamTargets: clockProbeUpstreamTargets,
        sources: clockProbeSources,
        mergeAttempted: false,
        mergeAppliedBoards: [],
      });
      const response = NextResponse.json(
        {
          ...responsePayload,
          board: boardFound ? fallbackBoard : null,
          boards: responseBoards,
          clocksAvailable,
          reason: boardFound ? null : "notFound",
          source: "error",
          ...(debug
            ? {
                debug: {
                  ...(rescue
                    ? {
                        rescue: true,
                        rescueBoard,
                      }
                    : {}),
                  requestedBoardId: boardIdParam,
                  matchedKey: normalizedBoardId,
                  boardFound,
                  fen: fallbackBoard?.fen ?? null,
                  fenSource,
                  upstreamAttempted: false,
                  upstreamStatus: null,
                  movesCount: Array.isArray(fallbackBoard?.moveList)
                    ? fallbackBoard!.moveList.length
                    : Array.isArray(fallbackBoard?.moves)
                      ? fallbackBoard!.moves.length
                      : 0,
                  hasPgn: Boolean(fallbackBoard?.pgn),
                  error: {
                    message,
                    where,
                    name,
                  },
                },
              }
            : {}),
          ...(clockDebug ? { clockDebug } : {}),
        },
        { status: 200 }
      );
      response.headers.set("Cache-Control", "no-store");
      if (debug) {
        response.headers.set("X-CV-LIVE-SOURCE", "error");
      }
      return response;
    }
  }

  if (bootstrap) {
    const snapshot =
      buildMockTournamentSnapshot(normalizedSlug, safeRound) ?? {
        tournamentSlug: normalizedSlug,
        round: safeRound,
        boards: [],
      };
    const clockProbeUpstreamTargets = new Set<string>();
    const clockProbeSources: ClockProbeSource[] = [];
    if (clockProbeEnabled) {
      clockProbeUpstreamTargets.add("local://buildMockTournamentSnapshot");
      clockProbeSources.push({ name: "snapshotBoards", value: snapshot.boards });
    }
    const replayClockMerge = await mergeWorldCupReplayClocks({
      tournamentSlug: snapshot.tournamentSlug,
      round: safeRound,
      boards: snapshot.boards,
      clockProbeEnabled,
    });
    if (clockProbeEnabled && replayClockMerge.replayProbeSources.length > 0) {
      replayClockMerge.replayProbeSources.forEach(source => clockProbeSources.push(source));
      clockProbeUpstreamTargets.add("apps/web/public/tournaments/worldcup2025/pgn/<boardId>.pgn");
    }
    const normalizedBoards = normalizeBoardsWithClockContract(replayClockMerge.boards);
    const clockDebug = buildClockDebugPayload({
      requested: clockProbeRequested,
      enabled: clockProbeEnabled,
      upstreamTargets: clockProbeUpstreamTargets,
      sources: clockProbeSources,
      mergeAttempted: replayClockMerge.mergeAttempted,
      mergeAppliedBoards: replayClockMerge.mergeAppliedBoards,
    });
    const normalizedSnapshot = {
      ...snapshot,
      boards: normalizedBoards,
      clocksAvailable: getClocksAvailable(normalizedBoards),
      ...(clockDebug ? { clockDebug } : {}),
    };
    const response = NextResponse.json(normalizedSnapshot, { status: 200 });
    response.headers.set("Cache-Control", "no-store");
    if (debugHeaderValue) {
      response.headers.set("X-CV-LIVE-DEBUG", debugHeaderValue);
      console.log("[tournament-live] bootstrap", {
        url: url.toString(),
        bootstrapParam: url.searchParams.get("bootstrap"),
        bootstrapActive: bootstrap,
      });
    }
    return response;
  }

  const payload = buildMockTournamentPayload(normalizedSlug, safeRound);
  if (!payload) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        ...(debugHeaderValue ? { "X-CV-LIVE-DEBUG": debugHeaderValue } : {}),
      },
    });
  }

  const clockProbeUpstreamTargets = new Set<string>();
  const clockProbeSources: ClockProbeSource[] = [];
  if (clockProbeEnabled) {
    clockProbeUpstreamTargets.add("local://buildMockTournamentPayload");
    clockProbeSources.push({ name: "payloadBoards", value: payload.boards });
  }
  const replayClockMerge = await mergeWorldCupReplayClocks({
    tournamentSlug: payload.tournamentSlug,
    round: safeRound,
    boards: payload.boards,
    clockProbeEnabled,
  });
  if (clockProbeEnabled && replayClockMerge.replayProbeSources.length > 0) {
    replayClockMerge.replayProbeSources.forEach(source => clockProbeSources.push(source));
    clockProbeUpstreamTargets.add("apps/web/public/tournaments/worldcup2025/pgn/<boardId>.pgn");
  }
  const normalizedBoards = normalizeBoardsWithClockContract(replayClockMerge.boards);
  const clockDebug = buildClockDebugPayload({
    requested: clockProbeRequested,
    enabled: clockProbeEnabled,
    upstreamTargets: clockProbeUpstreamTargets,
    sources: clockProbeSources,
    mergeAttempted: replayClockMerge.mergeAttempted,
    mergeAppliedBoards: replayClockMerge.mergeAppliedBoards,
  });
  const normalizedPayload = {
    ...payload,
    boards: normalizedBoards,
    clocksAvailable: getClocksAvailable(normalizedBoards),
    ...(clockDebug ? { clockDebug } : {}),
  };
  const response = NextResponse.json(normalizedPayload, { status: 200 });
  response.headers.set("Cache-Control", "no-store");
  if (debugHeaderValue) {
    response.headers.set("X-CV-LIVE-DEBUG", debugHeaderValue);
    console.log("[tournament-live] poll", {
      url: url.toString(),
      bootstrapParam: url.searchParams.get("bootstrap"),
      bootstrapActive: bootstrap,
    });
  }
  return response;
}
