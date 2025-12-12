import { Chess } from "chess.js";

export type Ply = {
  san: string;
  fen: string;
  moveNo: number;
  color: "w" | "b";
};

const START_FEN = new Chess().fen();

export function pgnToPlies(pgn?: string): Ply[] {
  if (typeof pgn !== "string" || pgn.trim() === "") {
    return [];
  }

  const reader = new Chess();
  try {
    const loaded = reader.loadPgn(pgn, { sloppy: true } as any) as unknown as boolean;
    if (!loaded) {
      console.warn("[pgnToPlies] Failed to load PGN", { snippet: pgn.slice(0, 200) });
      return [];
    }
  } catch (error) {
    console.warn("[pgnToPlies] Exception while loading PGN", {
      snippet: pgn.slice(0, 200),
      error,
    });
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
        console.warn("[pgnToPlies] Invalid move while replaying PGN", {
          move,
          snippet: pgn.slice(0, 200),
          error,
        });
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

export function pliesToFenAt(plies: Ply[], idx: number): string {
  if (idx < 0) {
    return START_FEN;
  }

  if (idx >= plies.length) {
    return plies.length > 0 ? plies[plies.length - 1].fen : START_FEN;
  }

  return plies[idx].fen;
}
