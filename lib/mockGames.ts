import { Chess } from "chess.js";

import type { Ply } from "@/lib/chess/pgn";
import { pgnToPlies } from "@/lib/chess/pgn";

export type NotationMove = {
  moveNumber: number;
  white?: string;
  black?: string;
};

export const WORLD_CUP_DEMO_MOVES: NotationMove[] = [
  { moveNumber: 1, white: "1. e4", black: "... e5" },
  { moveNumber: 2, white: "Nf3", black: "Nc6" },
  { moveNumber: 3, white: "Bb5", black: "a6" },
  { moveNumber: 4, white: "Ba4", black: "Nf6" },
  { moveNumber: 5, white: "O-O", black: "Be7" },
  { moveNumber: 6, white: "Re1", black: "b5" },
  { moveNumber: 7, white: "Bb3", black: "d6" },
  { moveNumber: 8, white: "c3", black: "O-O" },
  { moveNumber: 9, white: "h3", black: "Nb8" },
  { moveNumber: 10, white: "d4", black: "Nbd7" },
  { moveNumber: 11, white: "c4", black: "c6" },
  { moveNumber: 12, white: "Nc3", black: "Bb7" },
  { moveNumber: 13, white: "a3", black: "Re8" },
  { moveNumber: 14, white: "Ba2", black: "Bf8" },
  { moveNumber: 15, white: "b4", black: "h6" },
  { moveNumber: 16, white: "Qd3", black: "Rc8" },
  { moveNumber: 17, white: "Bd2", black: "exd4" },
  { moveNumber: 18, white: "Nxd4", black: "Ne5" },
  { moveNumber: 19, white: "Qf1", black: "c5" },
  { moveNumber: 20, white: "Nf5", black: "cxb4" },
  { moveNumber: 21, white: "axb4", black: "d5" },
  { moveNumber: 22, white: "exd5", black: "Qd7" },
  { moveNumber: 23, white: "Ne3", black: "Ng6" },
  { moveNumber: 24, white: "Rab1", black: "Bd6" },
  { moveNumber: 25, white: "c5", black: "Bb8" },
  { moveNumber: 26, white: "c6", black: "Qc7" },
  { moveNumber: 27, white: "g3", black: "Ne4" },
  { moveNumber: 28, white: "Nxe4", black: "Rxe4" },
  { moveNumber: 29, white: "d6", black: "Qxd6" },
  { moveNumber: 30, white: "cxb7", black: "Rce8" },
];

const sanitizeSan = (input?: string) => {
  if (!input) return null;
  const cleaned = input.replace(/^[0-9]+\.\s*/, "").replace(/^\.\.\.\s*/, "").trim();
  return cleaned.length > 0 ? cleaned : null;
};

const applySanMove = (
  chess: Chess,
  san: string | null,
  moveNumber: number,
  fallbackColor: Ply["color"]
): Ply | null => {
  if (!san) return null;
  try {
    const result = chess.move(san, { sloppy: true } as any);
    if (!result) return null;
    return {
      san: result.san,
      fen: chess.fen(),
      moveNo: moveNumber,
      color: result.color ?? fallbackColor,
    };
  } catch {
    return null;
  }
};

export const notationMovesToPlies = (moves: NotationMove[]): Ply[] => {
  const chess = new Chess();
  const plies: Ply[] = [];
  moves.forEach(move => {
    const whiteSan = sanitizeSan(move.white);
    const whitePly = applySanMove(chess, whiteSan, move.moveNumber, "w");
    if (whitePly) {
      plies.push(whitePly);
    }
    const blackSan = sanitizeSan(move.black);
    const blackPly = applySanMove(chess, blackSan, move.moveNumber, "b");
    if (blackPly) {
      plies.push(blackPly);
    }
  });
  return plies;
};

export const buildFenSequenceFromMoves = (moves: NotationMove[]): string[] => {
  const chess = new Chess();
  const fens: string[] = [];
  moves.forEach(move => {
    let fenAfterMove: string | null = null;
    const whiteSan = sanitizeSan(move.white);
    if (whiteSan) {
      try {
        const result = chess.move(whiteSan, { sloppy: true } as any);
        if (result) {
          fenAfterMove = chess.fen();
        }
      } catch {
        // ignore invalid SAN entries
      }
    }
    const blackSan = sanitizeSan(move.black);
    if (blackSan) {
      try {
        const result = chess.move(blackSan, { sloppy: true } as any);
        if (result) {
          fenAfterMove = chess.fen();
        }
      } catch {
        // ignore invalid SAN entries
      }
    }
    fens.push(fenAfterMove ?? chess.fen());
  });
  return fens;
};

export const WORLD_CUP_DEMO_PLIES = notationMovesToPlies(WORLD_CUP_DEMO_MOVES);
export const WORLD_CUP_DEMO_FENS = buildFenSequenceFromMoves(WORLD_CUP_DEMO_MOVES);

export const pliesFromPgn = (pgn: string): Ply[] => pgnToPlies(pgn);
