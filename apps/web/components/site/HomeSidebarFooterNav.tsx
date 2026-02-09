"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Heart, Trophy } from "lucide-react";

const buildFilterHref = (filterKey: string, queryParam: string | null) => {
  const params = new URLSearchParams();
  if (filterKey && filterKey !== "all") params.set("filter", filterKey);
  if (queryParam) params.set("q", queryParam);
  const queryString = params.toString();
  return queryString ? `/?${queryString}` : "/";
};

export default function HomeSidebarFooterNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const queryParam = searchParams.get("q");
  const isTopActive = pathname === "/" && filterParam === "top";
  const isFavoritesActive = pathname === "/favorites";
  const isSaveGamesActive = pathname === "/save-games";

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="space-y-2">
        <Link
          href="/favorites"
          className={`nav-item flex items-center justify-center gap-3 rounded-2xl border px-3 py-1.5 text-sm transition ${
            isFavoritesActive
              ? "border-emerald-400/60 bg-emerald-400/10 text-white"
              : "border-white/10 text-slate-300 hover:border-white/40 hover:text-white"
          }`}
          aria-current={isFavoritesActive ? "page" : undefined}
          title="Favorite games"
        >
          <Heart className="h-5 w-5" fill="none" aria-hidden />
          <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
            Favorite games
          </span>
        </Link>
        <Link
          href="/save-games"
          className={`nav-item flex items-center justify-center gap-3 rounded-2xl border px-3 py-1.5 text-sm transition ${
            isSaveGamesActive
              ? "border-emerald-400/60 bg-emerald-400/10 text-white"
              : "border-white/10 text-slate-300 hover:border-white/40 hover:text-white"
          }`}
          aria-current={isSaveGamesActive ? "page" : undefined}
          title="Save your games"
        >
          <Bookmark className="h-5 w-5" aria-hidden />
          <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
            Save your games
          </span>
        </Link>
        <Link
          href={buildFilterHref("top", queryParam)}
          className={`nav-item flex items-center justify-center gap-3 rounded-2xl border px-3 py-1.5 text-sm transition ${
            isTopActive
              ? "border-emerald-400/60 bg-emerald-400/10 text-white"
              : "border-white/10 text-slate-300 hover:border-white/40 hover:text-white"
          }`}
          aria-current={isTopActive ? "page" : undefined}
          title="Top players"
        >
          <Trophy className="h-5 w-5" aria-hidden />
          <span className="nav-label pointer-events-none max-w-0 overflow-hidden opacity-0 translate-x-2 transition-all">
            Top players
          </span>
        </Link>
      </div>
    </div>
  );
}
