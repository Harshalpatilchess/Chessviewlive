export type Player = {
  name: string;
  rating: number;
  country: string;
  title?: string;
  avatarUrl?: string;
};

export type Clock = {
  remainingMs: number;
  incrementMs?: number;
  isRunning: boolean;
  initialMs?: number;
};

export type Move = {
  id: string;
  moveNumber: number;
  notation: string;
  color: "white" | "black";
  comment?: string;
  clockAfterMs?: number;
};

export type Match = {
  id: string;
  event: string;
  round?: string;
  board?: number;
  white: Player;
  black: Player;
  moves: Move[];
  clocks: Record<"white" | "black", Clock>;
  status: "scheduled" | "live" | "finished";
  startTime: string;
  venue?: string;
  liveCommentary?: string[];
};

export type LiveRoundGame = {
  id: string;
  board: number;
  white: {
    name: string;
    flag: string;
  };
  black: {
    name: string;
    flag: string;
  };
  result?: string;
  evaluation?: string;
};

export type LiveRound = {
  roundNumber: number;
  games: LiveRoundGame[];
};

export type UiState = {
  orientation: "white" | "black";
  showEval: boolean;
  engineOn: boolean;
  commentaryOn: boolean;
};
