export type DgtBoardPlayer = {
  name: string;
  title?: string | null;
  rating?: number | null;
  federation?: string | null;
  country?: string | null;
  flag?: string | null;
  __metaSource?: "upstream" | "roster" | "missing";
  nameSource?: "direct" | "first+last" | "pgn" | "manifest" | "unknown";
  missingReason?: string | null;
};

export type DgtBoardState = {
  board: number;
  boardId?: string;
  fen?: string | null;
  moves?: string[];
  finalFen?: string | null;
  moveList?: string[];
  pgn?: string | null;
  fenSource?: string | null;
  event?: string | null;
  date?: string | null;
  white?: DgtBoardPlayer | string | null;
  black?: DgtBoardPlayer | string | null;
  whiteName?: string | null;
  blackName?: string | null;
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
  games?: DgtBoardState[];
  pairings?: DgtBoardState[];
  roundData?: {
    boards?: DgtBoardState[];
    games?: DgtBoardState[];
    pairings?: DgtBoardState[];
  };
  clocksAvailable?: boolean;
};
