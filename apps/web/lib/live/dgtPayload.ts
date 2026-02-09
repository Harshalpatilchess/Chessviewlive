export type DgtBoardState = {
  board: number;
  fen?: string | null;
  moves?: string[];
  finalFen?: string | null;
  moveList?: string[];
  pgn?: string | null;
  fenSource?: string | null;
  event?: string | null;
  date?: string | null;
  white?: string | null;
  black?: string | null;
  whiteElo?: string | null;
  blackElo?: string | null;
  eco?: string | null;
  opening?: string | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  clockUpdatedAtMs?: number | null;
  sideToMove?: "white" | "black" | null;
  status?: "live" | "finished" | "scheduled" | "final";
  result?: "1-0" | "0-1" | "1/2-1/2" | "½-½" | "*" | null;
};

export type DgtLivePayload = {
  tournamentSlug: string;
  round: number;
  boards: DgtBoardState[];
  clocksAvailable?: boolean;
};
