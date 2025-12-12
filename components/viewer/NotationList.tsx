"use client";

import { useRef, type RefObject } from "react";

import type { Ply } from "@/lib/chess/pgn";
import useCenteredNotationScroll from "@/lib/hooks/useCenteredNotationScroll";

type NotationListProps = {
  plies: Ply[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null> | null;
  hideHeader?: boolean;
  headerSelector?: string | null;
  renderContainer?: boolean;
};

type NotationRow = {
  moveNumber: number;
  whiteSan?: string;
  whitePlyIndex?: number;
  blackSan?: string;
  blackPlyIndex?: number;
};

export default function NotationList({
  plies,
  currentMoveIndex,
  onMoveClick,
  scrollContainerRef,
  hideHeader = false,
  headerSelector,
  renderContainer = true,
}: NotationListProps) {
  const rows: NotationRow[] = [];

  plies.forEach((ply, index) => {
    const moveNumber = typeof ply.moveNo === "number" ? ply.moveNo : Math.floor(index / 2) + 1;
    const rowIndex = Math.max(0, moveNumber - 1);
    if (!rows[rowIndex]) {
      rows[rowIndex] = { moveNumber };
    }
    const target = rows[rowIndex];
    if (ply.color === "w") {
      target.whiteSan = ply.san;
      target.whitePlyIndex = index;
    } else {
      target.blackSan = ply.san;
      target.blackPlyIndex = index;
    }
  });

  const activeMoveNumber =
    typeof currentMoveIndex === "number" && currentMoveIndex >= 0
      ? Math.floor(currentMoveIndex / 2) + 1
      : -1;
  const activePlyIndex = typeof currentMoveIndex === "number" ? currentMoveIndex : -1;
  const compactRows = rows.filter((row): row is NotationRow => Boolean(row));
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = scrollContainerRef ?? internalContainerRef;

  useCenteredNotationScroll(containerRef, activeRowRef, {
    activeIndex: currentMoveIndex,
    headerSelector: headerSelector === undefined ? ".notation-header" : headerSelector,
  });

  const containerProps = scrollContainerRef
    ? {}
    : { ref: containerRef, className: "max-h-64 overflow-y-auto" };

  const header = hideHeader ? null : (
    <div className="notation-header grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 border-b border-white/5 bg-slate-900 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-200">
      <span>#</span>
      <span>White</span>
      <span>Black</span>
    </div>
  );

  const rowsContent = (
    <div className="divide-y divide-white/5 text-sm text-slate-100">
      {compactRows.map(row => {
        const isCurrentRow = row.moveNumber === activeMoveNumber;
        const isWhiteActive = typeof row.whitePlyIndex === "number" && row.whitePlyIndex === activePlyIndex;
        const isBlackActive = typeof row.blackPlyIndex === "number" && row.blackPlyIndex === activePlyIndex;
        return (
          <div
            ref={isCurrentRow ? activeRowRef : undefined}
            key={row.moveNumber}
            aria-current={isCurrentRow ? "true" : undefined}
            className={`grid w-full grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors sm:text-sm ${
              isCurrentRow ? "border-l-2 border-amber-400/80 bg-white/5" : "border-l-2 border-transparent hover:bg-white/5"
            }`}
          >
            <span
              className={`font-semibold ${
                isCurrentRow ? "text-amber-200" : "text-slate-400"
              } ${typeof row.whitePlyIndex === "number" ? "cursor-pointer" : "cursor-default"} flex items-center gap-1`}
              onClick={() => {
                if (typeof row.whitePlyIndex === "number") {
                  onMoveClick(row.whitePlyIndex);
                }
              }}
            >
              {row.moveNumber}.
            </span>
            <span
              className={`truncate px-2 py-1 ${
                isWhiteActive ? "rounded-md bg-amber-500/20 font-semibold text-amber-100" : "text-white/90"
              } ${typeof row.whitePlyIndex === "number" ? "cursor-pointer" : "cursor-default"}`}
              onClick={() => {
                if (typeof row.whitePlyIndex === "number") {
                  onMoveClick(row.whitePlyIndex);
                }
              }}
            >
              {row.whiteSan ?? "—"}
            </span>
            <span
              className={`truncate px-2 py-1 ${
                isBlackActive ? "rounded-md bg-amber-500/20 font-semibold text-amber-100" : "text-white/90"
              } ${typeof row.blackPlyIndex === "number" ? "cursor-pointer" : "cursor-default"}`}
              onClick={() => {
                if (typeof row.blackPlyIndex === "number") {
                  onMoveClick(row.blackPlyIndex);
                }
              }}
            >
              {row.blackSan ?? "—"}
            </span>
          </div>
        );
      })}
    </div>
  );

  if (!renderContainer) {
    return (
      <div {...containerProps}>
        {header}
        {rowsContent}
      </div>
    );
  }

  return (
    <div className="mt-1">
      <div className="rounded-xl border border-white/10 bg-slate-950/40 shadow-inner">
        <div {...containerProps}>
          {header}
          {rowsContent}
        </div>
      </div>
    </div>
  );
}
