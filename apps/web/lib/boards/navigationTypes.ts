import type { GameResult, GameStatus } from "@/lib/tournamentManifest";

export type BoardNavigationPlayer = {
  name: string;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  rating?: number;
  flag?: string;
  country?: string;
  federation?: string;
  nameSource?: string;
  missingData?: boolean;
  missingReason?: string;
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
  clockUpdatedAtMs?: number | null;
  sideToMove?: "white" | "black" | null;
  evaluation?: number | null;
  miniEvalCp?: number | null;
  finalFen?: string | null;
  previewFen?: string | null;
  moveList?: string[] | null;
  replayResolveReason?:
    | "resolved_final"
    | "explicit_zero_moves"
    | "missing_data_pending"
    | "parse_failed"
    | "cached_start_blocking_upgrade"
    | null;
  replayExplicitZeroMoves?: boolean | null;
  miniBoardPending?: boolean | null;
  miniBoardExplicitStart?: boolean | null;
  white: BoardNavigationPlayer;
  black: BoardNavigationPlayer;
};
