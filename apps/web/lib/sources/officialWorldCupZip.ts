import "server-only";

import { strFromU8, unzipSync } from "fflate";
import { extractLatestClockPairFromPgn, deriveFenFromPgn, getSideToMoveFromFen } from "@/lib/chess/pgnServer";
import type { DgtBoardState } from "@/lib/live/dgtPayload";

export const WORLD_CUP_SLUG = "worldcup2025";
export const WORLD_CUP_OFFICIAL_ZIP_URL = "https://worldcup2025.fide.com/files/cup2025.zip";
const ZIP_TTL_MS = 10 * 60 * 1000;

type OfficialWorldCupRoundDebug = {
  selectedRoundPath: string;
  candidateFiles: number;
  zipCacheHit: boolean;
  roundCacheHit: boolean;
};

export type OfficialWorldCupBoard = {
  board: number;
  pairingKey: string;
  white: string | null;
  black: string | null;
  status: DgtBoardState["status"];
  result: DgtBoardState["result"];
  moveList: string[];
  finalFen: string | null;
  sideToMove: "white" | "black" | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockUpdatedAtMs: number | null;
};

export type OfficialWorldCupRoundSnapshot = {
  tournamentSlug: typeof WORLD_CUP_SLUG;
  round: number;
  boards: OfficialWorldCupBoard[];
  debug: OfficialWorldCupRoundDebug;
};

type RoundSnapshotCacheValue = {
  tournamentSlug: typeof WORLD_CUP_SLUG;
  round: number;
  boards: OfficialWorldCupBoard[];
  selectedRoundPath: string;
  candidateFiles: number;
};

type CachedZip = {
  expiresAtMs: number;
  entries: Record<string, Uint8Array>;
};

type CachedRound = {
  expiresAtMs: number;
  value: RoundSnapshotCacheValue;
};

let zipCache: CachedZip | null = null;
const roundCache = new Map<number, CachedRound>();

const normalizeRound = (value: number) => {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded >= 1 ? rounded : null;
};

const normalizeResult = (value?: string | null): DgtBoardState["result"] => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (trimmed === "*" || trimmed === "\u00b7") return "*";
  if (trimmed === "1-0" || trimmed === "0-1" || trimmed === "1/2-1/2" || trimmed === "½-½") {
    return trimmed;
  }
  return null;
};

const splitPgnGames = (pgn: string): string[] => {
  const lines = pgn.split(/\r?\n/);
  const games: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/^\uFEFF/, "");
    if (/^\s*\[Event\s/.test(normalized) && buffer.length > 0) {
      games.push(buffer.join("\n").trim());
      buffer = [];
    }
    if (!normalized.trim() && buffer.length === 0) continue;
    buffer.push(normalized);
  }
  if (buffer.length > 0) {
    games.push(buffer.join("\n").trim());
  }
  return games.filter(Boolean);
};

const parsePgnHeaders = (pgn: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  const lines = pgn.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) continue;
    const match = trimmed.match(/^\[([A-Za-z0-9_]+)\s+"(.*)"\]$/);
    if (!match) continue;
    headers[match[1]] = match[2].replace(/\\"/g, "\"").trim();
  }
  return headers;
};

const normalizeName = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildPairingKey = (white: string | null, black: string | null) =>
  [white ?? "?", black ?? "?"]
    .map(name => name.trim().toLowerCase() || "?")
    .sort((a, b) => a.localeCompare(b))
    .join("__");

const readZipEntries = async (): Promise<{ entries: Record<string, Uint8Array>; zipCacheHit: boolean }> => {
  const now = Date.now();
  if (zipCache && zipCache.expiresAtMs > now) {
    return { entries: zipCache.entries, zipCacheHit: true };
  }

  const response = await fetch(WORLD_CUP_OFFICIAL_ZIP_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`official_zip_http_${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(bytes);

  zipCache = {
    entries,
    expiresAtMs: now + ZIP_TTL_MS,
  };
  return { entries, zipCacheHit: false };
};

const pickRoundPgnFile = (
  round: number,
  entries: Record<string, Uint8Array>
): { path: string; pgn: string; games: string[]; candidateFiles: number } => {
  const roundPattern = new RegExp(`(?:^|/)round${round}game[^/]*/games\\.pgn$`, "i");
  const candidatePaths = Object.keys(entries)
    .map(path => path.replace(/\\/g, "/"))
    .filter(path => roundPattern.test(path));

  if (candidatePaths.length === 0) {
    throw new Error("official_round_not_found");
  }

  let selected: { path: string; pgn: string; games: string[] } | null = null;
  for (const path of candidatePaths) {
    const bytes = entries[path];
    if (!bytes) continue;
    const pgn = strFromU8(bytes).trim();
    if (!pgn) continue;
    const games = splitPgnGames(pgn);
    if (!selected) {
      selected = { path, pgn, games };
      continue;
    }
    if (games.length > selected.games.length) {
      selected = { path, pgn, games };
      continue;
    }
    if (games.length === selected.games.length && path.localeCompare(selected.path) < 0) {
      selected = { path, pgn, games };
    }
  }

  if (!selected) {
    throw new Error("official_round_pgn_missing");
  }

  return { ...selected, candidateFiles: candidatePaths.length };
};

const parseRoundBoards = (games: string[]): OfficialWorldCupBoard[] => {
  const parsedAtMs = Date.now();
  const collected = games.map((game, sourceIndex) => {
    const headers = parsePgnHeaders(game);
    const white = normalizeName(headers.White) ?? "?";
    const black = normalizeName(headers.Black) ?? "?";
    const pairingKey = buildPairingKey(white, black);
    const parsed = deriveFenFromPgn(game);
    const moveList = parsed.moveList ?? [];
    const finalFen = parsed.fen;
    const sideToMove = getSideToMoveFromFen(finalFen);
    const latestClock = extractLatestClockPairFromPgn(game, {
      sideToMove,
      fen: finalFen,
      moveCount: parsed.movesAppliedCount,
    });
    const hasClockData =
      Number.isFinite(latestClock.whiteTimeMs ?? NaN) || Number.isFinite(latestClock.blackTimeMs ?? NaN);
    const result = normalizeResult(headers.Result);
    const status: DgtBoardState["status"] =
      result && result !== "*"
        ? "finished"
        : moveList.length > 0
          ? "live"
          : "scheduled";
    return {
      sourceIndex,
      pairingKey,
      board: 0,
      white,
      black,
      status,
      result,
      moveList,
      finalFen,
      sideToMove: latestClock.sideToMove ?? sideToMove,
      whiteTimeMs: latestClock.whiteTimeMs,
      blackTimeMs: latestClock.blackTimeMs,
      clockUpdatedAtMs: hasClockData ? parsedAtMs : null,
    };
  });

  return collected
    .sort((a, b) => {
      if (a.pairingKey !== b.pairingKey) return a.pairingKey.localeCompare(b.pairingKey);
      return a.sourceIndex - b.sourceIndex;
    })
    .map((board, index) => ({
      ...board,
      board: index + 1,
    }));
};

const buildRoundSnapshotValue = async (round: number): Promise<{ value: RoundSnapshotCacheValue; zipCacheHit: boolean }> => {
  const { entries, zipCacheHit } = await readZipEntries();
  const selected = pickRoundPgnFile(round, entries);
  const boards = parseRoundBoards(selected.games);
  return {
    value: {
      tournamentSlug: WORLD_CUP_SLUG,
      round,
      boards,
      selectedRoundPath: selected.path,
      candidateFiles: selected.candidateFiles,
    },
    zipCacheHit,
  };
};

export const getOfficialWorldCupRoundSnapshot = async (roundRaw: number): Promise<OfficialWorldCupRoundSnapshot> => {
  const round = normalizeRound(roundRaw);
  if (!round) {
    throw new Error("invalid_round");
  }
  const now = Date.now();
  const cachedRound = roundCache.get(round);
  if (cachedRound && cachedRound.expiresAtMs > now) {
    return {
      tournamentSlug: cachedRound.value.tournamentSlug,
      round: cachedRound.value.round,
      boards: cachedRound.value.boards,
      debug: {
        selectedRoundPath: cachedRound.value.selectedRoundPath,
        candidateFiles: cachedRound.value.candidateFiles,
        zipCacheHit: true,
        roundCacheHit: true,
      },
    };
  }

  const next = await buildRoundSnapshotValue(round);
  roundCache.set(round, {
    value: next.value,
    expiresAtMs: now + ZIP_TTL_MS,
  });

  return {
    tournamentSlug: next.value.tournamentSlug,
    round: next.value.round,
    boards: next.value.boards,
    debug: {
      selectedRoundPath: next.value.selectedRoundPath,
      candidateFiles: next.value.candidateFiles,
      zipCacheHit: next.zipCacheHit,
      roundCacheHit: false,
    },
  };
};

export const getOfficialWorldCupReplayBoard = async (
  roundRaw: number,
  boardRaw: number
): Promise<{ board: OfficialWorldCupBoard | null; snapshot: OfficialWorldCupRoundSnapshot }> => {
  const round = normalizeRound(roundRaw);
  const boardNo = normalizeRound(boardRaw);
  if (!round || !boardNo) {
    throw new Error("invalid_round_or_board");
  }
  const snapshot = await getOfficialWorldCupRoundSnapshot(round);
  const board = snapshot.boards.find(entry => entry.board === boardNo) ?? null;
  return { board, snapshot };
};
