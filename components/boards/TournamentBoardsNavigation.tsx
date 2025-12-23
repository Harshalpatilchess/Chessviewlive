"use client";

import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";

type TournamentBoardsNavigationProps = {
  tournamentSlug: string;
  boards: BoardNavigationEntry[];
  compact?: boolean;
};

export default function TournamentBoardsNavigation({
  tournamentSlug,
  boards,
  compact = false,
}: TournamentBoardsNavigationProps) {
  return (
    <BoardsNavigation
      boards={boards}
      compact={compact}
      paneQuery="notation"
      hrefBuilder={(board, { paneQuery, isFinished }) =>
        `/t/${encodeURIComponent(tournamentSlug)}/${isFinished ? "replay" : "live"}/${encodeURIComponent(board.boardId)}?pane=${encodeURIComponent(paneQuery)}`
      }
    />
  );
}

