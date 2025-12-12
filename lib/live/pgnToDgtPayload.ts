"use client";

import type { DgtBoardState } from "@/lib/live/dgtPayload";
import { Chess } from "chess.js";

type ParsedHeaders = {
  event?: string | null;
  date?: string | null;
  round?: string | null;
  white?: string | null;
  black?: string | null;
  whiteElo?: string | null;
  blackElo?: string | null;
  result?: string | null;
  eco?: string | null;
  opening?: string | null;
};

const headerRegex = /^\[(\w+)\s+"(.*)"\]$/;

const parseHeaders = (pgn: string): ParsedHeaders => {
  const headers: ParsedHeaders = {};
  const lines = pgn.split(/\r?\n/);
  for (const line of lines) {
    const match = headerRegex.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    const normalizedKey = key.toLowerCase();
    switch (normalizedKey) {
      case "event":
        headers.event = value;
        break;
      case "date":
        headers.date = value;
        break;
      case "round":
        headers.round = value;
        break;
      case "white":
        headers.white = value;
        break;
      case "black":
        headers.black = value;
        break;
      case "whiteelo":
        headers.whiteElo = value;
        break;
      case "blackelo":
        headers.blackElo = value;
        break;
      case "result":
        headers.result = value;
        break;
      case "eco":
        headers.eco = value;
        break;
      case "opening":
        headers.opening = value;
        break;
      default:
        break;
    }
  }
  return headers;
};

const normalizeResult = (result?: string | null): "1-0" | "0-1" | "1/2-1/2" | "½-½" | null => {
  if (!result) return null;
  if (result === "1-0" || result === "0-1") return result;
  if (result === "1/2-1/2") return "1/2-1/2";
  if (result === "½-½") return "½-½";
  return null;
};

type PgnToDgtOptions = {
  board?: number;
};

export function pgnToDgtBoard(pgn: string, options: PgnToDgtOptions = {}): DgtBoardState {
  const headers = parseHeaders(pgn);
  const roundBoard = Number(headers.round ?? options.board ?? 1);
  const boardNumber = Number.isFinite(roundBoard) ? Math.max(1, Math.floor(roundBoard)) : 1;
  const result = normalizeResult(headers.result);
  const chess = new Chess();
  let moveList: string[] = [];
  let finalFen: string | null = null;

  try {
    const loaded = chess.loadPgn(pgn, { sloppy: true });
    if (loaded) {
      moveList = chess.history();
      finalFen = chess.fen();
    }
  } catch {
    moveList = [];
    finalFen = null;
  }

  const boardState: DgtBoardState = {
    board: boardNumber,
    status: "finished",
    result: result ?? null,
    finalFen,
    moveList,
    event: headers.event ?? null,
    date: headers.date ?? null,
    white: headers.white ?? null,
    black: headers.black ?? null,
    whiteElo: headers.whiteElo ?? null,
    blackElo: headers.blackElo ?? null,
    eco: headers.eco ?? null,
    opening: headers.opening ?? null,
    whiteTimeMs: null,
    blackTimeMs: null,
    sideToMove: null,
  };

  return boardState;
}
