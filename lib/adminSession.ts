import type { NextRequest } from "next/server";

export const ADMIN_COOKIE_NAME = "cv_admin";
export const ADMIN_COOKIE_MAX_AGE = 43200; // 12 hours

export function hasAdminCookie(req: NextRequest): boolean {
  return req.cookies.get(ADMIN_COOKIE_NAME)?.value === "1";
}

export function getAdminCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
