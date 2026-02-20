import { Chess } from "chess.js";
import type { DgtBoardState, DgtLivePayload } from "@/lib/live/dgtPayload";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import { getTournamentBoardsForRound } from "@/lib/tournamentManifest";
import { extractLatestClockPairFromPgn } from "@/lib/chess/pgnServer";

type BoardSequence = {
  moves: string[];
  fens: string[];
  result: DgtBoardState["result"];
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockUpdatedAtMs: number | null;
};

type BoardProgress = {
  index: number;
  status: "live" | "finished";
};

const sequenceCache = new Map<string, BoardSequence>();
const progressCache = new Map<string, BoardProgress>();

const normalizeSlug = (slug: string) => slug.trim().toLowerCase();

const buildKey = (slug: string, round: number, board: number) => `${slug}:${round}:${board}`;

const parseResult = (pgn: string): DgtBoardState["result"] => {
  const match = pgn.match(/\[Result\s+"([^"]+)"\]/i);
  if (!match) return null;
  const result = match[1]?.trim();
  if (result === "1-0" || result === "0-1" || result === "1/2-1/2" || result === "½-½" || result === "*") {
    return result;
  }
  return null;
};

const buildSequence = (slug: string, board: number): BoardSequence | null => {
  if (slug !== "worldcup2025") return null;
  const cacheKey = `${slug}:${board}`;
  const cached = sequenceCache.get(cacheKey);
  if (cached) return cached;
  const pgn = getWorldCupPgnForBoard(board);
  const reader = new Chess();
  try {
    reader.loadPgn(pgn, { strict: false });
  } catch {
    return null;
  }
  const moves = reader.history();
  const replay = new Chess();
  const fens: string[] = [];
  for (const move of moves) {
    try {
      replay.move(move, { strict: false });
      fens.push(replay.fen());
    } catch {
      break;
    }
  }
  const latestFen = fens.length > 0 ? fens[fens.length - 1] : null;
  const latestClockPair = extractLatestClockPairFromPgn(pgn, {
    fen: latestFen,
    moveCount: moves.length,
  });
  const sequence = {
    moves,
    fens,
    result: parseResult(pgn),
    whiteTimeMs: latestClockPair.whiteTimeMs,
    blackTimeMs: latestClockPair.blackTimeMs,
    clockUpdatedAtMs: null,
  };
  sequenceCache.set(cacheKey, sequence);
  return sequence;
};

const fenSideToMove = (fen?: string | null): "white" | "black" | null => {
  if (!fen) return null;
  const parts = fen.split(/\s+/);
  const side = parts[1];
  if (side === "w") return "white";
  if (side === "b") return "black";
  return null;
};

export const buildMockTournamentPayload = (
  tournamentSlug: string,
  round: number
): DgtLivePayload | null => {
  const normalizedSlug = normalizeSlug(tournamentSlug);
  const boardNumbers = getTournamentBoardsForRound(normalizedSlug, round);
  if (!boardNumbers || boardNumbers.length === 0) return null;
  const boards: DgtBoardState[] = [];

  for (const board of boardNumbers) {
    const sequence = buildSequence(normalizedSlug, board);
    if (!sequence || sequence.moves.length === 0) continue;
    const key = buildKey(normalizedSlug, round, board);
    const progress = progressCache.get(key) ?? { index: 0, status: "live" };
    const nextIndex =
      progress.index < sequence.moves.length ? progress.index + 1 : progress.index;
    const nextStatus: BoardProgress["status"] =
      nextIndex >= sequence.moves.length ? "finished" : "live";
    const changed = nextIndex !== progress.index || nextStatus !== progress.status;
    if (!changed) continue;
    progressCache.set(key, { index: nextIndex, status: nextStatus });
    const moveList = sequence.moves.slice(0, nextIndex);
    const finalFen = nextIndex > 0 ? sequence.fens[nextIndex - 1] ?? null : null;
    boards.push({
      board,
      status: nextStatus,
      result: nextStatus === "finished" ? sequence.result : null,
      moveList,
      finalFen,
      whiteTimeMs: sequence.whiteTimeMs,
      blackTimeMs: sequence.blackTimeMs,
      clockUpdatedAtMs: sequence.clockUpdatedAtMs,
      sideToMove: fenSideToMove(finalFen),
    });
  }

  if (boards.length === 0) return null;
  return { tournamentSlug: normalizedSlug, round, boards };
};

export const buildMockTournamentSnapshot = (
  tournamentSlug: string,
  round: number
): DgtLivePayload | null => {
  const normalizedSlug = normalizeSlug(tournamentSlug);
  const boardNumbers = getTournamentBoardsForRound(normalizedSlug, round);
  if (!boardNumbers || boardNumbers.length === 0) return null;
  const boards: DgtBoardState[] = [];

  for (const board of boardNumbers) {
    const sequence = buildSequence(normalizedSlug, board);
    const key = buildKey(normalizedSlug, round, board);
    const progress = progressCache.get(key);
    const index = progress?.index ?? 0;
    const status: BoardProgress["status"] | "scheduled" =
      progress?.status ?? (index > 0 ? "live" : "scheduled");
    const moves = sequence?.moves ?? [];
    const moveList = moves.length ? moves.slice(0, Math.min(index, moves.length)) : [];
    const finalFen = index > 0 ? sequence?.fens[index - 1] ?? null : null;
    const result = status === "finished" ? sequence?.result ?? null : null;
    boards.push({
      board,
      status,
      result,
      moveList,
      finalFen,
      whiteTimeMs: sequence?.whiteTimeMs ?? null,
      blackTimeMs: sequence?.blackTimeMs ?? null,
      clockUpdatedAtMs: sequence?.clockUpdatedAtMs ?? null,
      sideToMove: fenSideToMove(finalFen),
    });
  }

  return { tournamentSlug: normalizedSlug, round, boards };
};
