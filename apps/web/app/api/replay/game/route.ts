import { NextResponse } from "next/server";
import { resolveWorldCupReplayMoves } from "@/lib/replay/worldCupPgnResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const boardId = url.searchParams.get("boardId")?.trim() ?? "";
  if (!boardId) {
    return NextResponse.json(
      { ok: false, reason: "missing_board_id" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const resolved = await resolveWorldCupReplayMoves(boardId);
  const basePayload = {
    boardId: resolved.boardId,
    source: resolved.source,
    filePathTried: resolved.filePathTried,
    fallbackUsed: resolved.fallbackUsed,
    moveList: resolved.moveList ?? [],
    movesAppliedCount: resolved.movesAppliedCount,
    parseMode: resolved.parseMode,
    failedToken: resolved.failedToken,
    whiteTimeMs: resolved.whiteTimeMs,
    blackTimeMs: resolved.blackTimeMs,
  };

  if (resolved.source === "missing") {
    return NextResponse.json(
      {
        ok: false,
        reason: resolved.reason ?? "pgn_missing",
        ...basePayload,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (resolved.movesAppliedCount <= 0) {
    return NextResponse.json(
      {
        ok: false,
        reason: "pgn_parse_failed",
        ...basePayload,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      reason: resolved.reason,
      ...basePayload,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
