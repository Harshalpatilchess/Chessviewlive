import "server-only";

import { Chess } from "chess.js";
import { buildBoardIdentifier, parseBoardIdentifier } from "@/lib/boardId";
import type { DgtBoardPlayer, DgtBoardState } from "@/lib/live/dgtPayload";
import { buildMockTournamentSnapshot } from "@/lib/live/mockTournamentFeed";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";

export const REPLAY_RESOLVED_IDENTITY_PREFIX = "replay-live-v2";

export type ReplayLiveBoardResolution = {
  found: boolean;
  boardId: string;
  tournamentSlug: string;
  round: number;
  board: number;
  white: string | null;
  black: string | null;
  moveList: string[];
  finalFen: string | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockUpdatedAtMs: number | null;
  sourceUsed: string;
  resolvedIdentityKey: string;
};

const normalizeText = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const coercePlayerName = (value?: string | DgtBoardPlayer | null): string | undefined => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  return typeof value.name === "string" ? value.name : undefined;
};

const normalizeClockMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.max(0, Math.floor(Number(value)));
};

const normalizeClockUpdatedAtMs = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.floor(Number(value));
};

const deriveFenFromMoveList = (moveList: string[]): string | null => {
  if (!Array.isArray(moveList) || moveList.length === 0) return null;
  const chess = new Chess();
  for (const move of moveList) {
    try {
      chess.move(move, { strict: false });
    } catch {
      return null;
    }
  }
  return chess.fen();
};

const getBoardMoveList = (
  boardState?: DgtBoardState | null,
  manifestMoveList?: string[] | null
): string[] => {
  const boardMoves = Array.isArray(boardState?.moveList)
    ? boardState?.moveList
    : Array.isArray(boardState?.moves)
      ? boardState?.moves
      : null;
  const rawMoves = boardMoves ?? (Array.isArray(manifestMoveList) ? manifestMoveList : null);
  if (!rawMoves) return [];
  return rawMoves.filter((move): move is string => typeof move === "string" && move.trim().length > 0);
};

export const buildReplayResolvedIdentityKey = (
  tournamentSlug: string,
  round: number,
  board: number
) => `${REPLAY_RESOLVED_IDENTITY_PREFIX}:${tournamentSlug}:${round}:${board}`;

export const resolveReplayLiveBoard = (boardIdRaw: string): ReplayLiveBoardResolution => {
  const parsed = parseBoardIdentifier(boardIdRaw);
  const canonicalBoardId = buildBoardIdentifier(parsed.tournamentSlug, parsed.round, parsed.board);
  const resolvedIdentityKey = buildReplayResolvedIdentityKey(
    parsed.tournamentSlug,
    parsed.round,
    parsed.board
  );

  const snapshot = buildMockTournamentSnapshot(parsed.tournamentSlug, parsed.round);
  const snapshotBoard =
    snapshot?.boards.find(board => Number.isFinite(Number(board.board)) && Math.floor(board.board) === parsed.board) ??
    null;
  const manifestGame = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, parsed.board);

  const moveList = getBoardMoveList(snapshotBoard, manifestGame?.moveList ?? null);
  const finalFen =
    normalizeText(snapshotBoard?.finalFen) ??
    normalizeText(snapshotBoard?.fen) ??
    normalizeText(manifestGame?.finalFen) ??
    normalizeText(manifestGame?.previewFen) ??
    deriveFenFromMoveList(moveList);

  const sourceParts: string[] = [];
  if (snapshotBoard) sourceParts.push("tournamentLiveSnapshot");
  if (manifestGame) sourceParts.push("manifestMerge");
  const sourceUsed = sourceParts.join("+") || "none";

  return {
    found: Boolean(snapshotBoard || manifestGame),
    boardId: canonicalBoardId,
    tournamentSlug: parsed.tournamentSlug,
    round: parsed.round,
    board: parsed.board,
    white: normalizeText(coercePlayerName(snapshotBoard?.white)) ?? normalizeText(coercePlayerName(manifestGame?.white)),
    black: normalizeText(coercePlayerName(snapshotBoard?.black)) ?? normalizeText(coercePlayerName(manifestGame?.black)),
    moveList,
    finalFen,
    whiteTimeMs: normalizeClockMs(snapshotBoard?.whiteTimeMs ?? manifestGame?.whiteTimeMs),
    blackTimeMs: normalizeClockMs(snapshotBoard?.blackTimeMs ?? manifestGame?.blackTimeMs),
    clockUpdatedAtMs: normalizeClockUpdatedAtMs(
      snapshotBoard?.clockUpdatedAtMs ?? manifestGame?.clockUpdatedAtMs
    ),
    sourceUsed,
    resolvedIdentityKey,
  };
};
