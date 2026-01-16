import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { hasAdminCookie } from "@/lib/adminSession";

function resolveHost() {
  const ws = process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
  return ws.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

type EndRoomRequestBody = {
  room?: unknown;
  adminSecret?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const hasCookie = hasAdminCookie(req);
    const rawBody: unknown = await req.json().catch(() => ({}));
    const body: EndRoomRequestBody =
      rawBody && typeof rawBody === "object" ? (rawBody as EndRoomRequestBody) : {};
    const room = typeof body.room === "string" ? body.room.trim() : "";
    const adminSecret = typeof body.adminSecret === "string" ? body.adminSecret : undefined;
    if (!room) return NextResponse.json({ ok: false, error: "missing_room" }, { status: 400 });
    if (!process.env.ADMIN_SECRET)
      return NextResponse.json({ ok: false, error: "missing_admin_secret" }, { status: 500 });
    if (!hasCookie && adminSecret !== process.env.ADMIN_SECRET)
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });

    const host = resolveHost();
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;
    if (!host || !apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "missing_livekit_env" }, { status: 500 });
    }

    const client = new RoomServiceClient(host, apiKey, apiSecret);
    await client.deleteRoom(room);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "end_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const runtime = "nodejs";
