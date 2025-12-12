import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mintPublisherToken, mintViewerToken } from "@/lib/livekit";
import { verifyCode } from "@/lib/joinCodes";
import { allow } from "@/lib/rateLimit";

const ok = <T extends Record<string, unknown>>(data: T) => NextResponse.json({ ok: true, ...data });
const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

type NextRequestWithIp = NextRequest & { ip?: string | null };

function resolveRequestIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const candidate = forwarded.split(",")[0]?.trim();
    if (candidate) return candidate;
  }
  const fallback = (req as NextRequestWithIp).ip;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return "unknown";
}

function isValidBoardId(value: string) {
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET(req: NextRequest) {
  const ip = resolveRequestIp(req);
  if (!allow(`tokenG:${ip}`, 60, 60)) { // ~60 requests/min per IP
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const url = new URL(req.url);
  const boardIdParam = url.searchParams.get("boardId") || url.searchParams.get("room") || "";
  const boardId = boardIdParam.trim();
  const publish = url.searchParams.get("publish") === "1";
  const code = (url.searchParams.get("code") || "").trim();

  if (
    !process.env.NEXT_PUBLIC_LIVEKIT_URL ||
    !process.env.LIVEKIT_API_KEY ||
    !process.env.LIVEKIT_API_SECRET
  ) {
    return bad(500, "missing_env");
  }

  if (!isValidBoardId(boardId)) {
    return bad(400, "missing_boardId");
  }

  if (publish) {
    if (!/^\d{6}$/.test(code)) {
      return bad(400, "invalid_params");
    }

    const verification = verifyCode(code);
    if (!verification || verification.payload.boardId !== boardId) {
      return bad(401, "invalid_or_expired_code");
    }

    const token = await mintPublisherToken({
      room: boardId,
      identity: `publisher-${crypto.randomUUID()}`,
    });

    return ok({
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      token,
      role: "publisher",
      canPublish: true,
    });
  }

  const token = await mintViewerToken({
    room: boardId,
    identity: `viewer-${crypto.randomUUID()}`,
  });

  return ok({
    url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    token,
    role: "viewer",
    canPublish: false,
  });
}
