import {
  DEFAULT_TOURNAMENT_SLUG,
  buildBoardIdentifier,
  isBoardIdentifier,
  normalizeBoardIdentifier,
  normalizeTournamentSlug,
} from "@/lib/boardId";

export type FideTitle = "GM" | "IM" | "FM" | "CM" | "WGM" | "WIM" | "WFM" | "WCM" | null;

export type GameResult = "1-0" | "0-1" | "½-½" | "1/2-1/2" | "·" | "*" | null;

export type GameStatus = "live" | "final" | "scheduled" | "unknown";

export type TournamentGame = {
  tournamentSlug?: string;
  round: number;
  board: number;
  white: string;
  whiteTitle?: FideTitle;
  whiteRating: number;
  whiteCountry: string;
  whiteFlag: string;
  black: string;
  blackTitle?: FideTitle;
  blackRating: number;
  blackCountry: string;
  blackFlag: string;
  result?: GameResult;
  status?: GameStatus;
  evaluation?: number | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: "white" | "black" | null;
  finalFen?: string | null;
  moveList?: string[] | null;
};

export type TournamentGameLiveUpdate = {
  tournamentSlug: string;
  round: number;
  board: number;
  result?: GameResult;
  status?: GameStatus;
  evaluation?: number | null;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: "white" | "black" | null;
  finalFen?: string | null;
  moveList?: string[] | null;
};

export type TournamentSlug = string;
export type TournamentRoundManifest = Record<number, TournamentGame>;
export type TournamentManifest = Record<number, TournamentRoundManifest>;
export type TournamentManifests = Record<TournamentSlug, TournamentManifest>;

const normalizeSlug = (slug?: string | null) => (slug ? slug.trim().toLowerCase() : "");

export type FeaturedBroadcastMode = "live" | "replay";

export type FeaturedBroadcastSelection = {
  tournamentSlug: string;
  boardId: string;
  mode: FeaturedBroadcastMode;
};

export type FeaturedBroadcastSelectionInput = {
  tournamentOrder?: string[];
  currentTournamentOrder?: string[];
};

const worldCupRound1: TournamentRoundManifest = {
  1: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 1,
    white: "Magnus Carlsen",
    whiteTitle: "GM",
    whiteRating: 2830,
    whiteCountry: "NOR",
    whiteFlag: "🇳🇴",
    black: "D. Gukesh",
    blackTitle: "GM",
    blackRating: 2760,
    blackCountry: "IND",
    blackFlag: "🇮🇳",
    result: "1-0",
    status: "final",
  },
  2: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 2,
    white: "Fabiano Caruana",
    whiteTitle: "GM",
    whiteRating: 2798,
    whiteCountry: "USA",
    whiteFlag: "🇺🇸",
    black: "Ding Liren",
    blackTitle: "GM",
    blackRating: 2791,
    blackCountry: "CHN",
    blackFlag: "🇨🇳",
    result: "½-½",
    status: "final",
  },
  3: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 3,
    white: "Hikaru Nakamura",
    whiteTitle: "GM",
    whiteRating: 2789,
    whiteCountry: "USA",
    whiteFlag: "🇺🇸",
    black: "Ian Nepomniachtchi",
    blackTitle: "GM",
    blackRating: 2770,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "1-0",
    status: "final",
  },
  4: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 4,
    white: "Alireza Firouzja",
    whiteTitle: "GM",
    whiteRating: 2764,
    whiteCountry: "FRA",
    whiteFlag: "🇫🇷",
    black: "Wesley So",
    blackTitle: "GM",
    blackRating: 2760,
    blackCountry: "USA",
    blackFlag: "🇺🇸",
    result: "0-1",
    status: "final",
  },
  5: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 5,
    white: "R. Praggnanandhaa",
    whiteTitle: "GM",
    whiteRating: 2743,
    whiteCountry: "IND",
    whiteFlag: "🇮🇳",
    black: "N. Abdusattorov",
    blackTitle: "GM",
    blackRating: 2745,
    blackCountry: "UZB",
    blackFlag: "🇺🇿",
    result: "½-½",
    status: "final",
  },
  6: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 6,
    white: "Anish Giri",
    whiteTitle: "GM",
    whiteRating: 2740,
    whiteCountry: "NED",
    whiteFlag: "🇳🇱",
    black: "Jan-Krzysztof Duda",
    blackTitle: "GM",
    blackRating: 2730,
    blackCountry: "POL",
    blackFlag: "🇵🇱",
    result: "0-1",
    status: "final",
  },
  7: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 7,
    white: "M. Vachier-Lagrave",
    whiteTitle: "GM",
    whiteRating: 2750,
    whiteCountry: "FRA",
    whiteFlag: "🇫🇷",
    black: "S. Mamedyarov",
    blackTitle: "GM",
    blackRating: 2745,
    blackCountry: "AZE",
    blackFlag: "🇦🇿",
    result: "1-0",
    status: "final",
  },
  8: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 8,
    white: "Levon Aronian",
    whiteTitle: "GM",
    whiteRating: 2755,
    whiteCountry: "USA",
    whiteFlag: "🇺🇸",
    black: "Teimour Radjabov",
    blackTitle: "GM",
    blackRating: 2735,
    blackCountry: "AZE",
    blackFlag: "🇦🇿",
    result: "½-½",
    status: "final",
  },
  9: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 9,
    white: "Richard Rapport",
    whiteTitle: "GM",
    whiteRating: 2740,
    whiteCountry: "ROU",
    whiteFlag: "🇷🇴",
    black: "Alexander Grischuk",
    blackTitle: "GM",
    blackRating: 2710,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "1-0",
    status: "final",
  },
  10: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 10,
    white: "Vidit Gujrathi",
    whiteTitle: "GM",
    whiteRating: 2727,
    whiteCountry: "IND",
    whiteFlag: "🇮🇳",
    black: "Vladimir Fedoseev",
    blackTitle: "GM",
    blackRating: 2700,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "0-1",
    status: "final",
  },
  11: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 11,
    white: "Rameshbabu Vaishali",
    whiteTitle: "WGM",
    whiteRating: 2495,
    whiteCountry: "IND",
    whiteFlag: "🇮🇳",
    black: "Aleksandra Goryachkina",
    blackTitle: "GM",
    blackRating: 2580,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "0-1",
    status: "final",
  },
  12: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 12,
    white: "Anna Muzychuk",
    whiteTitle: "GM",
    whiteRating: 2535,
    whiteCountry: "UKR",
    whiteFlag: "🇺🇦",
    black: "Kateryna Lagno",
    blackTitle: "GM",
    blackRating: 2550,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "1-0",
    status: "final",
  },
  13: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 13,
    white: "Wei Yi",
    whiteTitle: "GM",
    whiteRating: 2745,
    whiteCountry: "CHN",
    whiteFlag: "🇨🇳",
    black: "Yu Yangyi",
    blackTitle: "GM",
    blackRating: 2730,
    blackCountry: "CHN",
    blackFlag: "🇨🇳",
    result: "1-0",
    status: "final",
  },
  14: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 14,
    white: "Santosh Gujrathi",
    whiteTitle: "GM",
    whiteRating: 2650,
    whiteCountry: "IND",
    whiteFlag: "🇮🇳",
    black: "Arjun Erigaisi",
    blackTitle: "GM",
    blackRating: 2720,
    blackCountry: "IND",
    blackFlag: "🇮🇳",
    result: "0-1",
    status: "final",
  },
  15: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 15,
    white: "Vincent Keymer",
    whiteTitle: "GM",
    whiteRating: 2700,
    whiteCountry: "GER",
    whiteFlag: "🇩🇪",
    black: "David Navara",
    blackTitle: "GM",
    blackRating: 2680,
    blackCountry: "CZE",
    blackFlag: "🇨🇿",
    result: "½-½",
    status: "final",
  },
  16: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 16,
    white: "Boris Gelfand",
    whiteTitle: "GM",
    whiteRating: 2660,
    whiteCountry: "ISR",
    whiteFlag: "🇮🇱",
    black: "Peter Svidler",
    blackTitle: "GM",
    blackRating: 2690,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "0-1",
    status: "final",
  },
  17: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 17,
    white: "Daniil Dubov",
    whiteTitle: "GM",
    whiteRating: 2710,
    whiteCountry: "RUS",
    whiteFlag: "🇷🇺",
    black: "Andrey Esipenko",
    blackTitle: "GM",
    blackRating: 2680,
    blackCountry: "RUS",
    blackFlag: "🇷🇺",
    result: "1-0",
    status: "final",
  },
  18: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 18,
    white: "Vladimir Kramnik",
    whiteTitle: "GM",
    whiteRating: 2750,
    whiteCountry: "RUS",
    whiteFlag: "🇷🇺",
    black: "Veselin Topalov",
    blackTitle: "GM",
    blackRating: 2730,
    blackCountry: "BUL",
    blackFlag: "🇧🇬",
    result: "½-½",
    status: "final",
  },
  19: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 19,
    white: "Judit Polgar",
    whiteTitle: "GM",
    whiteRating: 2735,
    whiteCountry: "HUN",
    whiteFlag: "🇭🇺",
    black: "Hou Yifan",
    blackTitle: "GM",
    blackRating: 2650,
    blackCountry: "CHN",
    blackFlag: "🇨🇳",
    result: "1-0",
    status: "final",
  },
  20: {
    tournamentSlug: "worldcup2025",
    round: 1,
    board: 20,
    white: "Tania Sachdev",
    whiteTitle: "IM",
    whiteRating: 2440,
    whiteCountry: "IND",
    whiteFlag: "🇮🇳",
    black: "Irina Krush",
    blackTitle: "GM",
    blackRating: 2470,
    blackCountry: "USA",
    blackFlag: "🇺🇸",
    result: "0-1",
    status: "final",
  },
};

const manifests: TournamentManifests = {
  worldcup2025: {
    1: worldCupRound1,
  },
};

type BoardEntry = {
  round: number;
  board: number;
  boardId: string;
  game: TournamentGame;
};

const isDevEnv = process.env.NODE_ENV !== "production";
let hasWarnedInvalidOverride = false;
let hasLoggedSelection = false;

const normalizeOptionalSlug = (value?: string | null) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return normalizeTournamentSlug(trimmed);
};

const normalizeOptionalValue = (value?: string | null) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const coerceFeaturedMode = (value?: string | null): FeaturedBroadcastMode | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "live" || normalized === "replay") return normalized;
  return null;
};

const warnInvalidOverride = (reason: string, details: Record<string, unknown>) => {
  if (!isDevEnv || hasWarnedInvalidOverride) return;
  hasWarnedInvalidOverride = true;
  console.warn("[featured] Invalid featured override. Falling back to automatic selection.", {
    reason,
    ...details,
  });
};

const logSelection = (selection: FeaturedBroadcastSelection, source: string) => {
  if (!isDevEnv || hasLoggedSelection) return;
  hasLoggedSelection = true;
  console.info("[featured] Selected featured broadcast.", {
    source,
    tournamentSlug: selection.tournamentSlug,
    boardId: selection.boardId,
    mode: selection.mode,
  });
};

const getTournamentBoardEntries = (tournamentSlug: string): BoardEntry[] => {
  const manifest = manifests[tournamentSlug];
  if (!manifest) return [];
  const rounds = Object.keys(manifest)
    .map(key => Number(key))
    .filter(round => Number.isFinite(round))
    .sort((a, b) => a - b);
  const entries: BoardEntry[] = [];
  rounds.forEach(round => {
    const roundManifest = manifest[round];
    if (!roundManifest) return;
    const boards = Object.keys(roundManifest)
      .map(key => Number(key))
      .filter(board => Number.isFinite(board))
      .sort((a, b) => a - b);
    boards.forEach(board => {
      const game = roundManifest[board];
      if (!game) return;
      entries.push({
        round,
        board,
        boardId: buildBoardIdentifier(tournamentSlug, round, board),
        game,
      });
    });
  });
  return entries;
};

const normalizeResult = (result?: GameResult | null): GameResult | null => {
  if (!result || result === "·" || result === "*") return null;
  return result === "1/2-1/2" ? "½-½" : result;
};

const isFinishedGame = (game: TournamentGame): boolean => {
  const normalizedResult = normalizeResult(game.result);
  return game.status === "final" || Boolean(normalizedResult) || Boolean(game.finalFen);
};

const selectBoardFromTournament = (
  tournamentSlug: string,
  preferredMode?: FeaturedBroadcastMode | null
): FeaturedBroadcastSelection | null => {
  const entries = getTournamentBoardEntries(tournamentSlug);
  if (entries.length === 0) return null;
  const hasExplicitLive = entries.some(entry => entry.game.status === "live");
  const tournamentIsCurrent = entries.some(entry => !isFinishedGame(entry.game));
  const liveCandidates = hasExplicitLive
    ? entries.filter(entry => entry.game.status === "live")
    : tournamentIsCurrent
      ? entries.filter(entry => !isFinishedGame(entry.game))
      : [];
  const boardOneEntry = entries.find(entry => entry.round === 1 && entry.board === 1) ?? null;
  const liveEntry = liveCandidates.length > 0
    ? liveCandidates.find(entry => entry.round === 1 && entry.board === 1) ?? liveCandidates[0]
    : null;
  const replayEntry = boardOneEntry ?? entries[0];

  if (preferredMode === "live") {
    if (!liveEntry) return null;
    return {
      tournamentSlug,
      boardId: liveEntry.boardId,
      mode: "live",
    };
  }
  if (preferredMode === "replay") {
    return {
      tournamentSlug,
      boardId: replayEntry.boardId,
      mode: "replay",
    };
  }
  if (liveEntry) {
    return {
      tournamentSlug,
      boardId: liveEntry.boardId,
      mode: "live",
    };
  }
  return {
    tournamentSlug,
    boardId: replayEntry.boardId,
    mode: "replay",
  };
};

const normalizeTournamentOrder = (values?: string[]) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    const normalized = normalizeOptionalSlug(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

const getFallbackTournamentOrder = (primaryOrder: string[]) => {
  const seen = new Set(primaryOrder);
  const remaining = Object.keys(manifests)
    .sort()
    .filter(slug => !seen.has(slug));
  return [...primaryOrder, ...remaining];
};

const readFeaturedOverride = () => {
  const tournamentSlug = normalizeOptionalValue(
    process.env.FEATURED_TOURNAMENT_SLUG ?? process.env.NEXT_PUBLIC_FEATURED_TOURNAMENT_SLUG
  );
  const boardId = normalizeOptionalValue(
    process.env.FEATURED_BOARD_ID ?? process.env.NEXT_PUBLIC_FEATURED_BOARD_ID
  );
  const modeRaw = normalizeOptionalValue(
    process.env.FEATURED_MODE ?? process.env.NEXT_PUBLIC_FEATURED_MODE
  );
  const mode = coerceFeaturedMode(modeRaw);
  return {
    tournamentSlug,
    boardId,
    mode,
    modeRaw,
    hasOverride: Boolean(tournamentSlug || boardId || modeRaw),
  };
};

const resolveOverrideSelection = (
  input: FeaturedBroadcastSelectionInput
): FeaturedBroadcastSelection | null => {
  const override = readFeaturedOverride();
  if (!override.hasOverride) return null;
  if (override.modeRaw && !override.mode) {
    warnInvalidOverride("invalid-mode", { mode: override.modeRaw });
    return null;
  }

  const normalizedOverrideSlug = normalizeOptionalSlug(override.tournamentSlug);

  if (override.boardId) {
    if (!isBoardIdentifier(override.boardId)) {
      warnInvalidOverride("invalid-board-id", {
        tournamentSlug: normalizedOverrideSlug || undefined,
        boardId: override.boardId,
      });
      return null;
    }
    const normalized = normalizeBoardIdentifier(
      override.boardId,
      normalizedOverrideSlug || DEFAULT_TOURNAMENT_SLUG
    );
    const parsed = normalized.parsed;
    if (normalizedOverrideSlug && parsed.tournamentSlug !== normalizedOverrideSlug) {
      warnInvalidOverride("tournament-mismatch", {
        tournamentSlug: normalizedOverrideSlug,
        boardId: override.boardId,
      });
      return null;
    }
    const game = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, parsed.board);
    if (!game) {
      warnInvalidOverride("board-not-configured", {
        tournamentSlug: parsed.tournamentSlug,
        boardId: normalized.normalizedBoardId,
      });
      return null;
    }
    const derivedMode =
      override.mode ??
      (game.status === "live" || !isFinishedGame(game) ? "live" : "replay");
    return {
      tournamentSlug: parsed.tournamentSlug,
      boardId: normalized.normalizedBoardId,
      mode: derivedMode,
    };
  }

  const tournamentOrder = normalizeTournamentOrder(input.tournamentOrder);
  const currentOrder = normalizeTournamentOrder(input.currentTournamentOrder);
  const topTournament = currentOrder[0] ?? tournamentOrder[0] ?? "";
  const targetTournament = normalizedOverrideSlug || topTournament;
  if (!targetTournament) {
    warnInvalidOverride("missing-tournament", {});
    return null;
  }
  const selection = selectBoardFromTournament(targetTournament, override.mode);
  if (!selection) {
    warnInvalidOverride("selection-unavailable", {
      tournamentSlug: targetTournament,
      mode: override.mode ?? undefined,
    });
    return null;
  }
  return selection;
};

export function selectFeaturedBroadcast(
  input: FeaturedBroadcastSelectionInput = {}
): FeaturedBroadcastSelection | null {
  const overrideSelection = resolveOverrideSelection(input);
  if (overrideSelection) {
    logSelection(overrideSelection, "override");
    return overrideSelection;
  }

  const tournamentOrder = normalizeTournamentOrder(input.tournamentOrder);
  const currentOrder = normalizeTournamentOrder(input.currentTournamentOrder);
  const topTournament = currentOrder[0] ?? tournamentOrder[0] ?? "";

  if (topTournament) {
    const selection = selectBoardFromTournament(topTournament);
    if (selection) {
      logSelection(selection, "auto-top");
      return selection;
    }
  }

  const fallbackOrder = getFallbackTournamentOrder(tournamentOrder);
  for (const slug of fallbackOrder) {
    const selection = selectBoardFromTournament(slug);
    if (selection) {
      logSelection(selection, "auto-fallback");
      return selection;
    }
  }

  return null;
}

export function getTournamentGameManifest(
  tournamentSlug?: string | null,
  round?: number,
  board?: number
): TournamentGame | null {
  const slug = normalizeSlug(tournamentSlug);
  const isValidRound = typeof round === "number" && Number.isFinite(round);
  const isValidBoard = typeof board === "number" && Number.isFinite(board);
  if (!slug || !isValidRound || !isValidBoard) return null;
  const safeRound = Math.floor(round);
  const safeBoard = Math.floor(board);
  const manifest = manifests[slug];
  if (!manifest) return null;
  const roundManifest = manifest[safeRound];
  if (!roundManifest) return null;
  return roundManifest[safeBoard] ?? null;
}

export function getTournamentBoardsForRound(
  tournamentSlug?: string | null,
  round?: number
): number[] | null {
  const slug = normalizeSlug(tournamentSlug);
  const isValidRound = typeof round === "number" && Number.isFinite(round);
  if (!slug || !isValidRound) return null;
  const safeRound = Math.floor(round);
  const manifest = manifests[slug];
  if (!manifest) return null;
  const roundManifest = manifest[safeRound];
  if (!roundManifest) return null;
  const boardNumbers = Object.keys(roundManifest)
    .map(key => Number(key))
    .filter(board => Number.isFinite(board))
    .sort((a, b) => a - b);
  return boardNumbers.length > 0 ? boardNumbers : null;
}

export function applyTournamentLiveUpdates(updates: TournamentGameLiveUpdate[]): number {
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  let applied = 0;
  updates.forEach(update => {
    const slug = normalizeSlug(update.tournamentSlug);
    if (!slug) return;
    const isValidRound = typeof update.round === "number" && Number.isFinite(update.round);
    const isValidBoard = typeof update.board === "number" && Number.isFinite(update.board);
    if (!isValidRound || !isValidBoard) return;
    const safeRound = Math.floor(update.round);
    const safeBoard = Math.floor(update.board);
    if (!manifests[slug]) manifests[slug] = {};
    if (!manifests[slug][safeRound]) manifests[slug][safeRound] = {};
    const existing = manifests[slug][safeRound][safeBoard];
    if (!existing) return;
    manifests[slug][safeRound][safeBoard] = {
      ...existing,
      ...("result" in update ? { result: update.result } : {}),
      ...("status" in update ? { status: update.status } : {}),
      ...("evaluation" in update ? { evaluation: update.evaluation } : {}),
      ...("whiteTimeMs" in update ? { whiteTimeMs: update.whiteTimeMs } : {}),
      ...("blackTimeMs" in update ? { blackTimeMs: update.blackTimeMs } : {}),
      ...("sideToMove" in update ? { sideToMove: update.sideToMove } : {}),
      ...("finalFen" in update ? { finalFen: update.finalFen } : {}),
      ...("moveList" in update ? { moveList: update.moveList ?? null } : {}),
    };
    applied += 1;
  });
  return applied;
}
