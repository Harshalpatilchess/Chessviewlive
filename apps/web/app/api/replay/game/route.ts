import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { buildBoardIdentifier, parseBoardIdentifier } from "@/lib/boardId";
import {
  buildReplayResolvedIdentityKey,
  resolveReplayLiveBoard,
} from "@/lib/replay/replayLiveBoardResolver";
import { resolveWorldCupReplayMoves } from "@/lib/replay/worldCupPgnResolver";
import { getOfficialWorldCupReplayBoard } from "@/lib/sources/officialWorldCupZip";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const LIVE_SOURCE = "live-feed";
const LIVE_PARSE_MODE = "live-feed";
const DEMO_REPLAY_QUERY_PARAM = "demoReplay";
const DEMO_REPLAY_ENV_KEY = "REPLAY_DEMO_MODE";
const WORLD_CUP_SLUG = "worldcup2025";

const normalizeText = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeClockMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.max(0, Math.floor(Number(value)));
};

const normalizeClockUpdatedAtMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.floor(Number(value));
};

const normalizeMoveList = (value?: string[] | null): string[] =>
  Array.isArray(value)
    ? value.filter((move): move is string => typeof move === "string" && move.trim().length > 0)
    : [];

const deriveFenFromMoveList = (moveList: string[]): string | null => {
  if (!moveList.length) return null;
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

const jsonNoStore = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const boardIdParam = url.searchParams.get("boardId")?.trim() ?? "";
  if (!boardIdParam) {
    return jsonNoStore({ ok: false, reason: "missing_board_id" }, 400);
  }

  const parsed = parseBoardIdentifier(boardIdParam);
  const canonicalBoardId = buildBoardIdentifier(parsed.tournamentSlug, parsed.round, parsed.board);
  const resolvedIdentityKey = buildReplayResolvedIdentityKey(
    parsed.tournamentSlug,
    parsed.round,
    parsed.board
  );
  const demoReplayForced =
    url.searchParams.get(DEMO_REPLAY_QUERY_PARAM)?.trim() === "1" ||
    process.env[DEMO_REPLAY_ENV_KEY] === "true";

  if (parsed.tournamentSlug === WORLD_CUP_SLUG) {
    try {
      const resolved = await getOfficialWorldCupReplayBoard(parsed.round, parsed.board);
      if (!resolved.board) {
        return jsonNoStore({
          ok: false,
          reason: "notFound",
          boardId: canonicalBoardId,
          tournamentSlug: parsed.tournamentSlug,
          round: parsed.round,
          board: parsed.board,
          white: null,
          black: null,
          finalFen: null,
          source: "official",
          filePathTried: null,
          fallbackUsed: false,
          moveList: [],
          movesAppliedCount: 0,
          parseMode: "official",
          failedToken: null,
          whiteTimeMs: null,
          blackTimeMs: null,
          clockUpdatedAtMs: null,
          debug: {
            sourceUsed: "official(singleSource)",
            resolvedIdentityKey,
            selectedRoundPath: resolved.snapshot.debug.selectedRoundPath,
          },
        });
      }
      const replayBoard = resolved.board;
      const moveList = normalizeMoveList(replayBoard.moveList);
      return jsonNoStore({
        ok: true,
        reason: null,
        boardId: canonicalBoardId,
        tournamentSlug: parsed.tournamentSlug,
        round: parsed.round,
        board: parsed.board,
        white: replayBoard.white,
        black: replayBoard.black,
        finalFen: replayBoard.finalFen ?? deriveFenFromMoveList(moveList),
        source: "official",
        filePathTried: null,
        fallbackUsed: false,
        moveList,
        movesAppliedCount: moveList.length,
        parseMode: "official",
        failedToken: null,
        whiteTimeMs: replayBoard.whiteTimeMs,
        blackTimeMs: replayBoard.blackTimeMs,
        clockUpdatedAtMs: replayBoard.clockUpdatedAtMs,
        debug: {
          sourceUsed: "official(singleSource)",
          resolvedIdentityKey,
          selectedRoundPath: resolved.snapshot.debug.selectedRoundPath,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return jsonNoStore(
        {
          ok: false,
          reason: "upstreamUnavailable",
          boardId: canonicalBoardId,
          tournamentSlug: parsed.tournamentSlug,
          round: parsed.round,
          board: parsed.board,
          white: null,
          black: null,
          finalFen: null,
          source: "official",
          filePathTried: null,
          fallbackUsed: false,
          moveList: [],
          movesAppliedCount: 0,
          parseMode: "official",
          failedToken: null,
          whiteTimeMs: null,
          blackTimeMs: null,
          clockUpdatedAtMs: null,
          debug: {
            sourceUsed: "official(singleSource)",
            resolvedIdentityKey,
            error: message,
          },
        },
        502
      );
    }
  }

  if (!demoReplayForced) {
    const liveResolved = resolveReplayLiveBoard(canonicalBoardId);
    if (liveResolved.found) {
      const liveMoveList = normalizeMoveList(liveResolved.moveList);
      return jsonNoStore({
        ok: true,
        reason: null,
        boardId: liveResolved.boardId,
        tournamentSlug: liveResolved.tournamentSlug,
        round: liveResolved.round,
        board: liveResolved.board,
        white: liveResolved.white,
        black: liveResolved.black,
        finalFen: liveResolved.finalFen ?? deriveFenFromMoveList(liveMoveList),
        source: LIVE_SOURCE,
        filePathTried: null,
        fallbackUsed: false,
        moveList: liveMoveList,
        movesAppliedCount: liveMoveList.length,
        parseMode: LIVE_PARSE_MODE,
        failedToken: null,
        whiteTimeMs: liveResolved.whiteTimeMs,
        blackTimeMs: liveResolved.blackTimeMs,
        clockUpdatedAtMs: liveResolved.clockUpdatedAtMs,
        debug: {
          sourceUsed: liveResolved.sourceUsed,
          resolvedIdentityKey: liveResolved.resolvedIdentityKey,
        },
      });
    }
  }

  const resolved = await resolveWorldCupReplayMoves(canonicalBoardId);
  const manifestGame = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, parsed.board);
  const moveList = normalizeMoveList(resolved.moveList);
  const finalFen =
    normalizeText(manifestGame?.finalFen) ??
    normalizeText(manifestGame?.previewFen) ??
    deriveFenFromMoveList(moveList);
  const basePayload = {
    boardId: canonicalBoardId,
    tournamentSlug: parsed.tournamentSlug,
    round: parsed.round,
    board: parsed.board,
    white: normalizeText(manifestGame?.white),
    black: normalizeText(manifestGame?.black),
    finalFen,
    source: resolved.source,
    filePathTried: resolved.filePathTried,
    fallbackUsed: resolved.fallbackUsed,
    moveList,
    movesAppliedCount: resolved.movesAppliedCount,
    parseMode: resolved.parseMode,
    failedToken: resolved.failedToken,
    whiteTimeMs: normalizeClockMs(resolved.whiteTimeMs ?? manifestGame?.whiteTimeMs),
    blackTimeMs: normalizeClockMs(resolved.blackTimeMs ?? manifestGame?.blackTimeMs),
    clockUpdatedAtMs: normalizeClockUpdatedAtMs(manifestGame?.clockUpdatedAtMs),
    debug: {
      sourceUsed: demoReplayForced
        ? "worldCupPgnResolver(demoReplayForced)"
        : "worldCupPgnResolver(fallbackNoLiveBoard)",
      resolvedIdentityKey,
    },
  };

  if (resolved.source === "missing") {
    return jsonNoStore(
      {
        ok: false,
        reason: resolved.reason ?? "pgn_missing",
        ...basePayload,
      },
    );
  }

  if (resolved.movesAppliedCount <= 0) {
    return jsonNoStore(
      {
        ok: false,
        reason: "pgn_parse_failed",
        ...basePayload,
      },
    );
  }

  return jsonNoStore(
    {
      ok: true,
      reason: resolved.reason,
      ...basePayload,
    },
  );
}
