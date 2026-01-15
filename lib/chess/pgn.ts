import { Chess } from "chess.js";

export type Ply = {
  san: string;
  fen: string;
  moveNo: number;
  color: "w" | "b";
};

const START_FEN = new Chess().fen();
const shouldLogWarnings = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("debugVerbose") === "1";
};

export function pgnToPlies(pgn?: string): Ply[] {
  if (typeof pgn !== "string" || pgn.trim() === "") {
    return [];
  }

  const reader = new Chess();
  try {
    reader.loadPgn(pgn, { strict: false });
  } catch (error) {
    if (shouldLogWarnings()) {
      console.warn("[pgnToPlies] Exception while loading PGN", {
        snippet: pgn.slice(0, 200),
        error,
      });
    }
    return [];
  }

  const verboseMoves = reader.history({ verbose: true });
  const replay = new Chess();
  const plies: Ply[] = [];

  for (let idx = 0; idx < verboseMoves.length; idx += 1) {
    const move = verboseMoves[idx];
    const result = (() => {
      try {
        return replay.move(move);
      } catch (error) {
        if (shouldLogWarnings()) {
          console.warn("[pgnToPlies] Invalid move while replaying PGN", {
            move,
            snippet: pgn.slice(0, 200),
            error,
          });
        }
        return null;
      }
    })();

    if (!result) {
      return [];
    }

    plies.push({
      san: move.san,
      fen: replay.fen(),
      moveNo: Math.floor(idx / 2) + 1,
      color: move.color,
    });
  }

  return plies;
}

export function movesToPlies(moves?: string[] | null): Ply[] {
  if (!Array.isArray(moves) || moves.length === 0) {
    return [];
  }

  const replay = new Chess();
  const plies: Ply[] = [];

  for (let idx = 0; idx < moves.length; idx += 1) {
    const move = moves[idx];
    try {
      const result = replay.move(move, { sloppy: true });
      if (!result) break;
      plies.push({
        san: result.san,
        fen: replay.fen(),
        moveNo: Math.floor(idx / 2) + 1,
        color: result.color,
      });
    } catch {
      break;
    }
  }

  return plies;
}

export function pliesToFenAt(plies: Ply[], idx: number): string {
  if (idx < 0) {
    return START_FEN;
  }

  if (idx >= plies.length) {
    return plies.length > 0 ? plies[plies.length - 1].fen : START_FEN;
  }

  return plies[idx].fen;
}
