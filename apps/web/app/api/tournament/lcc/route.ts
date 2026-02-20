import { NextResponse } from "next/server";
import type { DgtBoardState, DgtLivePayload } from "@/lib/live/dgtPayload";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { probeLiveChessCloud } from "@/lib/sources/livechesscloud";

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

const normalizeStatus = (value?: string | null): DgtBoardState["status"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "finished" || normalized === "final" || normalized === "completed") return "finished";
  if (normalized === "scheduled" || normalized === "upcoming" || normalized === "pending") return "scheduled";
  return "live";
};

const normalizeResult = (value?: string | null): DgtBoardState["result"] => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized === "1-0" || normalized === "0-1") return normalized;
  if (normalized === "1/2-1/2" || normalized === "½-½") return normalized;
  if (normalized.toLowerCase() === "draw") return "1/2-1/2";
  return null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug =
    url.searchParams.get("slug")?.trim() ??
    url.searchParams.get("tournamentSlug")?.trim() ??
    "";
  const round = parseNumberParam(url.searchParams.get("round"), 1, 1);
  const limit = parseNumberParam(url.searchParams.get("limit"), 64, 1);
  const debug = url.searchParams.get("debug") === "1";

  if (!slug) {
    return NextResponse.json({ ok: false, error: "missing_slug" }, { status: 400 });
  }

  const broadcast = getBroadcastTournament(slug);
  if (!broadcast || broadcast.sourceType !== "livechesscloud" || !broadcast.tournamentId) {
    return NextResponse.json({ ok: false, error: "unknown_tournament" }, { status: 404 });
  }

  try {
    const { payload, debug: debugMeta } = await probeLiveChessCloud({
      tournamentId: broadcast.tournamentId,
      round,
      limit,
      debug,
    });

    const boards: DgtBoardState[] = payload.boards.map(board => ({
      board: board.boardNo,
      status: normalizeStatus(board.status),
      result: normalizeResult(board.result),
      moveList: board.moveList,
      fenSource: board.sourceMeta.fenSource,
      white: board.whiteName || null,
      black: board.blackName || null,
    }));

    const response: DgtLivePayload & { debug?: unknown } = {
      tournamentSlug: slug,
      round,
      boards,
      ...(debug ? { debug: debugMeta } : {}),
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
