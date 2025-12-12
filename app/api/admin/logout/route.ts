import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, getAdminCookieOptions } from "@/lib/adminSession";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    maxAge: 0,
    ...getAdminCookieOptions(),
  });
  return res;
}

export const runtime = "nodejs";
