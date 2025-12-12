import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";

// Use string literal types for sources
// Do not import Track or enums from livekit-client on the server

type Source = "camera" | "microphone" | "screen_share" | "screen_share_audio";

function isSource(s: unknown): s is Source {
  return (
    s === "camera" ||
    s === "microphone" ||
    s === "screen_share" ||
    s === "screen_share_audio"
  );
}

function resolveLivekitHost() {
  const ws = process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
  return ws.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const room = (url.searchParams.get("room") || url.searchParams.get("boardId") || "").trim();
    if (!room) return NextResponse.json({ ok: false, error: "missing_room" }, { status: 400 });

    const host = resolveLivekitHost();
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;
    if (!host || !apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "missing_livekit_env" }, { status: 500 });
    }

    const client = new RoomServiceClient(host, apiKey, apiSecret);
    const participants = await client.listParticipants(room);

    const isPublisher = (t: { source?: unknown }) => isSource(t.source) && (t.source === "camera" || t.source === "microphone");

    const totals = {
      total: participants.length,
      publishers: participants.filter((p) => Array.isArray(p.tracks) && p.tracks.some(isPublisher)).length,
      viewers: participants.filter((p) => !(Array.isArray(p.tracks) && p.tracks.some(isPublisher))).length,
    };

    const hasPublisher = totals.publishers > 0;
    return NextResponse.json({ ok: true, room, totals, hasPublisher, participants });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "peek_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const runtime = "nodejs";
