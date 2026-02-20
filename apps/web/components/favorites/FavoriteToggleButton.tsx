"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";
import {
  FAVORITES_UPDATED_EVENT,
  isFavorite,
  toggleFavorite,
  type FavoriteGameEntry,
} from "@/lib/favoriteGames";

type FavoriteToggleButtonProps = {
  entry: FavoriteGameEntry;
  density?: "default" | "compact";
};

export default function FavoriteToggleButton({
  entry,
  density = "default",
}: FavoriteToggleButtonProps) {
  const isCompact = density === "compact";
  const [active, setActive] = useState(false);

  const refresh = useCallback(() => {
    setActive(isFavorite(entry.id));
  }, [entry.id]);

  useEffect(() => {
    refresh();
  }, [refresh, entry.id]);

  useEffect(() => {
    const handleStorage = () => refresh();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(FAVORITES_UPDATED_EVENT, handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(FAVORITES_UPDATED_EVENT, handleStorage);
    };
  }, [refresh]);

  const label = useMemo(
    () => (active ? "Remove from favorite games" : "Add to favorite games"),
    [active]
  );

  const handleToggle = () => {
    const next = toggleFavorite(entry);
    setActive(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full border border-white/15 bg-black/30 text-slate-300 shadow-sm transition hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
        isCompact ? "h-7 w-7" : "h-8 w-8"
      }`}
    >
      <Heart
        className={isCompact ? "h-4 w-4" : "h-5 w-5"}
        fill={active ? "currentColor" : "none"}
        aria-hidden
      />
    </button>
  );
}
