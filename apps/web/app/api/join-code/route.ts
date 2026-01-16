import { NextRequest, NextResponse } from "next/server";
import { issueCode } from "@/lib/joinCodes";
import { allow } from "@/lib/rateLimit";
import { hasAdminCookie } from "@/lib/adminSession";

const ok = <T extends Record<string, unknown>>(data: T) => NextResponse.json({ ok: true, ...data });
const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

type JoinCodeRequestBody = {
  boardId?: unknown;
  adminPassword?: unknown;
};

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

export async function POST(req: NextRequest) {
  try {
    const ip = resolveRequestIp(req);
    if (!allow(`join:${ip}`, 12, 12)) { // ~12 requests/min per IP
      return bad(429, "rate_limited");
    }
    const rawBody: unknown = await req.json().catch(() => ({}));
    const body: JoinCodeRequestBody =
      rawBody && typeof rawBody === "object" ? (rawBody as JoinCodeRequestBody) : {};
    const boardId = (body.boardId ?? "").toString().trim();
    const adminPassword = (body.adminPassword ?? "").toString();
    const hasCookie = hasAdminCookie(req);

    if (!boardId) return bad(400, "missing_boardId");
    if (!process.env.ADMIN_SECRET) return bad(500, "missing_admin_secret");
    if (!hasCookie) {
      if (!adminPassword || adminPassword !== process.env.ADMIN_SECRET) return bad(403, "unauthorized");
    }

    const { code, exp } = issueCode(boardId);
    return ok({ code, exp });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "bad_request";
    return bad(400, message);
  }
}
