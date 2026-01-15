import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { hasAdminCookie } from "@/lib/adminSession";
import { probeLiveChessCloud } from "@/lib/sources/livechesscloud";

export const runtime = "nodejs";

const parseNumberParam = (value: string | null, fallback: number, minValue: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < minValue) return minValue;
  return Math.floor(parsed);
};

const errorResponse = (status: number, error: string, debug?: Record<string, unknown>) =>
  NextResponse.json(debug ? { ok: false, error, debug } : { ok: false, error }, { status });

const unauthorizedResponse = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const debugEnabled = url.searchParams.get("debug") === "1";
  if (process.env.ALLOW_DEV_LCC_PROBE !== "true") {
    const cwd = process.cwd();
    return errorResponse(
      403,
      "disabled",
      debugEnabled
        ? {
            checkedKey: "ALLOW_DEV_LCC_PROBE",
            value: process.env.ALLOW_DEV_LCC_PROBE ?? null,
            cwd,
            envLocalExists: fs.existsSync(`${cwd}/.env.local`),
            nodeEnv: process.env.NODE_ENV ?? null,
          }
        : undefined
    );
  }

  const tournamentId = (url.searchParams.get("tournamentId") || "").trim();
  if (!tournamentId) {
    return errorResponse(400, "missing_tournamentId");
  }

  const headerSecret = req.headers.get("x-admin-secret") || "";
  const hasCookie = hasAdminCookie(req);
  if (!hasCookie) {
    if (!headerSecret) {
      return unauthorizedResponse(401, "unauthorized");
    }
    if (!process.env.ADMIN_SECRET || headerSecret !== process.env.ADMIN_SECRET) {
      return unauthorizedResponse(403, "forbidden");
    }
  } else if (headerSecret && process.env.ADMIN_SECRET && headerSecret !== process.env.ADMIN_SECRET) {
    return unauthorizedResponse(403, "forbidden");
  }

  const round = parseNumberParam(url.searchParams.get("round"), 1, 1);
  const limit = parseNumberParam(url.searchParams.get("limit"), 32, 1);
  try {
    const result = await probeLiveChessCloud({ tournamentId, round, limit, debug: debugEnabled });
    return NextResponse.json(
      debugEnabled
        ? { ok: true, tournamentId, round, boards: result.payload.boards, debug: result.debug }
        : { ok: true, tournamentId, round, boards: result.payload.boards }
    );
  } catch (error) {
    const debugPayload =
      debugEnabled && error && typeof error === "object" && "debug" in error
        ? { upstream: (error as { debug?: unknown }).debug }
        : undefined;
    return errorResponse(502, "upstream_unavailable", debugPayload);
  }
}
