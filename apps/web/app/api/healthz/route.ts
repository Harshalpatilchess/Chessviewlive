import { NextRequest, NextResponse } from "next/server";

const REQUIRED_ENVS = [
  "NEXT_PUBLIC_LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "S3_BUCKET",
  "S3_REGION",
  "S3_PREFIX",
  "ADMIN_SECRET",
];

function bool(v: string | undefined) {
  return !!(v && v.trim().length > 0);
}

export async function GET(_req: NextRequest) {
  const checks: Record<string, boolean> = {};
  for (const k of REQUIRED_ENVS) checks[k] = bool(process.env[k]);

  const allOk = Object.values(checks).every(Boolean);

  const payload = {
    ok: allOk,
    service: "chessviewlive",
    node: process.version,
    time: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(payload, { status: allOk ? 200 : 503 });
}

