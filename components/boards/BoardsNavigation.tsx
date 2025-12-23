"use client";

import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { BoardsNavigationCard } from "@/components/boards/BoardsNavigationCard";

type BoardsNavigationProps = {
  boards?: BoardNavigationEntry[] | null;
  currentBoardId?: string;
  paneQuery?: string;
  compact?: boolean;
  hrefBuilder?: (board: BoardNavigationEntry, options: { paneQuery: string; isFinished: boolean }) => string;
  emptyLabel?: string;
};

export const BoardsNavigation = ({
  boards,
  currentBoardId,
  paneQuery,
  compact = false,
  hrefBuilder,
  emptyLabel = "No other boards available for this round yet.",
}: BoardsNavigationProps) => {
  const resolvedBoards = boards ?? [];
  if (resolvedBoards.length === 0) {
    return <div className="flex flex-1 items-center justify-center px-2 pb-3 text-sm text-slate-400">{emptyLabel}</div>;
  }

  return (
    <div className={`${compact ? "px-1 pb-0.5" : "px-1.5 pb-1 sm:px-2"} overflow-x-hidden`}>
      <div className={`grid grid-cols-2 overflow-x-hidden ${compact ? "gap-x-2 gap-y-1.5" : "gap-x-3 gap-y-1"}`}>
        {resolvedBoards.map(board => (
          <BoardsNavigationCard
            key={board.boardId}
            board={board}
            currentBoardId={currentBoardId}
            paneQuery={paneQuery}
            compact={compact}
            hrefBuilder={hrefBuilder}
          />
        ))}
      </div>
    </div>
  );
};

