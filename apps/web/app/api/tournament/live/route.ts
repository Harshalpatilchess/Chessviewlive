import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { parseBoardIdentifier } from "@/lib/boardId";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import { buildMockTournamentPayload, buildMockTournamentSnapshot } from "@/lib/live/mockTournamentFeed";
import { deriveFenFromPgn } from "@/lib/chess/pgnServer";
import type { DgtBoardState } from "@/lib/live/dgtPayload";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const INITIAL_CHESS_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const hasFenValue = (value?: string | null) =>
  typeof value === "string" && value.trim().length > 0;

const getBoardMoveList = (board?: DgtBoardState | null): string[] | null => {
  if (!board) return null;
  const list = Array.isArray(board.moveList)
    ? board.moveList
    : Array.isArray(board.moves)
      ? board.moves
      : null;
  if (!list || list.length === 0) return null;
  return list;
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
      chess.move(move, { sloppy: true });
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

export function GET(req: Request) {
  const url = new URL(req.url);
  const slug =
    url.searchParams.get("slug")?.trim() ??
    url.searchParams.get("tournamentSlug")?.trim() ??
    "";
  const roundRaw = url.searchParams.get("round");
  const boardIdParam = url.searchParams.get("boardId")?.trim() ?? "";
  const bootstrap = url.searchParams.get("bootstrap") === "1";
  const debug = url.searchParams.get("debug") === "1";
  const rescue = url.searchParams.get("rescue") === "1";
  const rescueBoard = url.searchParams.get("rescueBoard")?.trim() ?? "";
  const round = roundRaw ? Number(roundRaw) : NaN;
  if (!slug || !Number.isFinite(round)) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }

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
    const normalizedSlug = slug.trim().toLowerCase();
    const normalizedBoardId = `${normalizedSlug}-board${Math.floor(round)}.${boardNumber}`;
    const responsePayload = {
      tournamentSlug: normalizedSlug,
      round: Math.floor(round),
      boards: [] as DgtBoardState[],
      board: null as DgtBoardState | null,
      reason: "notFound",
      source: "none",
    };
    if (!boardNumber || boardNumber < 1) {
      const response = NextResponse.json({ ...responsePayload, reason: "invalidBoardId" }, { status: 200 });
      response.headers.set("Cache-Control", "no-store");
      if (debug) {
        response.headers.set("X-CV-LIVE-SOURCE", "none");
      }
      return response;
    }

    try {
      const payload = buildMockTournamentPayload(normalizedSlug, Math.floor(round));
      const payloadBoard =
        payload?.boards.find(board => board.board === boardNumber) ?? null;
      const snapshot = payloadBoard ? null : buildMockTournamentSnapshot(normalizedSlug, Math.floor(round));
      const snapshotBoard =
        snapshot?.boards.find(board => board.board === boardNumber) ?? null;
      const manifestGame = getTournamentGameManifest(normalizedSlug, Math.floor(round), boardNumber);
      const manifestBoard: DgtBoardState | null = manifestGame
        ? {
            board: boardNumber,
            status: manifestStatusToDgt(manifestGame.status ?? null),
            result: manifestGame.result ?? null,
            whiteTimeMs: manifestGame.whiteTimeMs ?? null,
            blackTimeMs: manifestGame.blackTimeMs ?? null,
            sideToMove: manifestGame.sideToMove ?? null,
            moveList: manifestGame.moveList ?? null,
            finalFen: manifestGame.finalFen ?? null,
            fen: manifestGame.previewFen ?? null,
          }
        : null;
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

      if (needsUpstream && normalizedSlug === "worldcup2025" && Math.floor(round) === 1) {
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
        board = { ...board, fenSource };
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

      const response = NextResponse.json(
        {
          ...responsePayload,
          board: board ?? null,
          boards: board ? [board] : [],
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
          round: Math.floor(round),
          where,
          message,
        });
      }
      let boardFound = false;
      let fallbackBoard: DgtBoardState | null = null;
      try {
        const manifestGame = getTournamentGameManifest(normalizedSlug, Math.floor(round), boardNumber);
        if (manifestGame) {
          boardFound = true;
          fallbackBoard = {
            board: boardNumber,
            status: manifestStatusToDgt(manifestGame.status ?? null),
            result: manifestGame.result ?? null,
            whiteTimeMs: manifestGame.whiteTimeMs ?? null,
            blackTimeMs: manifestGame.blackTimeMs ?? null,
            sideToMove: manifestGame.sideToMove ?? null,
            moveList: manifestGame.moveList ?? null,
            finalFen: manifestGame.finalFen ?? null,
            fen: manifestGame.previewFen ?? null,
          };
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
      }

      const response = NextResponse.json(
        {
          ...responsePayload,
          board: boardFound ? fallbackBoard : null,
          boards: boardFound && fallbackBoard ? [fallbackBoard] : [],
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
      buildMockTournamentSnapshot(slug, Math.floor(round)) ?? {
        tournamentSlug: slug.trim().toLowerCase(),
        round: Math.floor(round),
        boards: [],
      };
    const response = NextResponse.json(snapshot, { status: 200 });
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

  const payload = buildMockTournamentPayload(slug, Math.floor(round));
  if (!payload) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        ...(debugHeaderValue ? { "X-CV-LIVE-DEBUG": debugHeaderValue } : {}),
      },
    });
  }

  const response = NextResponse.json(payload, { status: 200 });
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
