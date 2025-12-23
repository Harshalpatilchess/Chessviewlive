import type { GameResult, GameStatus } from "@/lib/tournamentManifest";

export type BoardNavigationPlayer = {
  name: string;
  title?: string | null;
  rating?: number;
  flag?: string;
};

export type BoardNavigationEntry = {
  boardId: string;
  boardNumber: number;
  result?: GameResult;
  status?: GameStatus;
  whiteClock?: string | null;
  blackClock?: string | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: "white" | "black" | null;
  evaluation?: number | null;
  finalFen?: string | null;
  moveList?: string[] | null;
  white: BoardNavigationPlayer;
  black: BoardNavigationPlayer;
};
