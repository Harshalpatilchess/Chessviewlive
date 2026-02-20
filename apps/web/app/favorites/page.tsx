"use client";

import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const FavoriteGamesList = nextDynamic(() => import("@/components/favorites/FavoriteGamesList"), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-slate-300" role="status">
      Loading favorites...
    </p>
  ),
});

export default function FavoritesPage() {
  return (
    <main className="min-h-screen bg-[#05070f] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_55%)]" />
      <div className="relative mx-auto w-full max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8 2xl:max-w-[1776px]">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">
            Library
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
            Favorite games
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-slate-300">
            Your saved games are listed here.
          </p>
        </header>
        <FavoriteGamesList />
      </div>
    </main>
  );
}
