import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_MAX_AGE, ADMIN_COOKIE_NAME, getAdminCookieOptions } from "@/lib/adminSession";

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "missing_admin_secret" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const adminPassword = (body?.adminPassword ?? "").toString();

  if (!adminPassword || adminPassword !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "invalid_admin" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "1",
    maxAge: ADMIN_COOKIE_MAX_AGE,
    ...getAdminCookieOptions(),
  });
  return res;
}

export const runtime = "nodejs";
