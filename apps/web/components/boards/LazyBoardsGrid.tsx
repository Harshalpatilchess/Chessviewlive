"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { buildViewerBoardPath } from "@/lib/paths";

type LazyBoardsGridProps = {
  boards: BoardNavigationEntry[];
  tournamentSlug: string;
  selectedBoardId?: string;
  className?: string;
  emptyLabel?: string;
};

const GRID_COLS = "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

export default function LazyBoardsGrid({
  boards,
  tournamentSlug,
  selectedBoardId,
  className,
  emptyLabel,
}: LazyBoardsGridProps) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const handleBoardClick = useCallback(
    (board: BoardNavigationEntry) => {
      const pane = searchParams?.get("pane");
      const params = new URLSearchParams();
      if (pane) params.set("pane", pane);
      const suffix = params.toString();
      const href = `${buildViewerBoardPath(board.boardId, "live")}${
        suffix ? `?${suffix}` : ""
      }`;
      router.push(href, { scroll: false });
      return false;
    },
    [router, searchParams]
  );

  if (!visible) {
    return (
      <div
        ref={containerRef}
        className={`rounded-2xl border border-white/10 bg-slate-950/60 p-4 min-h-[220px] ${className ?? ""}`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">
          Boards
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 opacity-40 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={`board-skeleton-${idx}`} className="h-24 rounded-xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <BoardsNavigation
        boards={boards}
        sidebarBoards={boards}
        layout="grid"
        variant="tournament"
        gridColsClassName={GRID_COLS}
        tournamentSlug={tournamentSlug}
        selectedBoardId={selectedBoardId}
        emptyLabel={emptyLabel ?? "No boards available for this round yet."}
        liveUpdatesEnabled={false}
        onBoardClick={handleBoardClick}
      />
    </div>
  );
}
