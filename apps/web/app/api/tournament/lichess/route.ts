import { NextResponse } from "next/server";
import type { DgtBoardState, DgtLivePayload } from "@/lib/live/dgtPayload";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { fetchLichessBroadcastRound, fetchLichessBroadcastTournament } from "@/lib/sources/lichessBroadcast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const parseNumberParam = (value: string | null, fallback: number, minValue: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < minValue) return minValue;
  return Math.floor(parsed);
};

const mapStatus = (value: string): DgtBoardState["status"] => {
  if (value === "final") return "finished";
  if (value === "scheduled") return "scheduled";
  return "live";
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug =
    url.searchParams.get("slug")?.trim() ??
    url.searchParams.get("tournamentSlug")?.trim() ??
    "";
  const round = parseNumberParam(url.searchParams.get("round"), 1, 1);
  const roundIdParam = url.searchParams.get("roundId");
  const debug = url.searchParams.get("debug") === "1";

  if (!slug) {
    return NextResponse.json({ ok: false, error: "missing_slug" }, { status: 400 });
  }

  const broadcast = getBroadcastTournament(slug);
  if (!broadcast || broadcast.sourceType !== "lichessBroadcast" || !broadcast.lichessBroadcastId) {
    return NextResponse.json({ ok: false, error: "unknown_tournament" }, { status: 404 });
  }

  try {
    const tournamentMeta = await fetchLichessBroadcastTournament({
      tournamentId: broadcast.lichessBroadcastId,
      roundIdOverride: roundIdParam?.trim() || null,
      debug,
    });
    const roundsMeta = tournamentMeta.snapshot.rounds;
    const roundIdFromIndex = roundsMeta[round - 1]?.id ?? tournamentMeta.snapshot.activeRoundId ?? null;
    const roundIdOverride = roundIdParam?.trim() || roundIdFromIndex;

    const payload = await fetchLichessBroadcastRound({
      tournamentId: broadcast.lichessBroadcastId,
      roundIdOverride,
      debug,
    });

    const gamesParsedCount =
      typeof payload.debug?.gamesParsedCount === "number"
        ? payload.debug.gamesParsedCount
        : payload.boards.length;
    if (gamesParsedCount === 0) {
      return NextResponse.json(
        debug ? { ok: false, error: "empty_pgn", debug: payload.debug ?? null } : { ok: false, error: "empty_pgn" },
        { status: 502 }
      );
    }

    const boards: DgtBoardState[] = payload.boards.map(board => ({
      board: board.boardNo,
      status: mapStatus(board.status),
      result: board.result,
      moveList: board.moveList,
      whiteTimeMs: board.whiteTimeMs ?? null,
      blackTimeMs: board.blackTimeMs ?? null,
      sideToMove: board.sideToMove ?? null,
      clockUpdatedAtMs: board.clockUpdatedAtMs ?? null,
      fenSource: "lichessBroadcast",
      white: board.whiteName,
      black: board.blackName,
    }));

    const response: DgtLivePayload & {
      roundsMeta?: typeof payload.roundsMeta;
      activeRoundId?: string | null;
      activeRoundIndex?: number | null;
      debug?: unknown;
    } = {
      tournamentSlug: slug,
      round,
      boards,
      roundsMeta: payload.roundsMeta,
      activeRoundId: payload.activeRoundId,
      activeRoundIndex: payload.activeRoundIndex,
      ...(debug ? { debug: payload.debug ?? null } : {}),
    };

    return NextResponse.json(response);
  } catch (error) {
    const debugBlock =
      debug && error && typeof error === "object" && "debug" in error
        ? { upstream: (error as { debug?: unknown }).debug }
        : undefined;
    return NextResponse.json(debug ? { ok: false, error: "upstream_unavailable", debug: debugBlock } : { ok: false, error: "upstream_unavailable" }, { status: 502 });
  }
}
