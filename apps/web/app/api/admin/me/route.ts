import { NextRequest, NextResponse } from "next/server";
import { hasAdminCookie } from "@/lib/adminSession";

export async function GET(req: NextRequest) {
  const isAdmin = hasAdminCookie(req);
  return NextResponse.json({ ok: true, isAdmin });
}

export const runtime = "nodejs";
