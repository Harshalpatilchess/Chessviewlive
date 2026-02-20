export const DEFAULT_TOURNAMENT_SLUG = "worldcup2025";

export type ParsedBoardIdentifier = {
  tournamentSlug: string;
  round: number;
  board: number;
};

const BOARD_ID_REGEX = /^([a-z0-9-]+)-board(\d+)\.(\d+)$/i;

const TOURNAMENT_SLUG_ALIASES: Record<string, string> = {
  worldcup: DEFAULT_TOURNAMENT_SLUG,
  "armenian-championship-2026": "armenian-championship-highest-league-2026",
  "tata-steel-masters-2026": "tata-steel-2026",
};

const toPositiveInteger = (value: number, fallback: number) => {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
};

export const normalizeTournamentSlug = (
  value?: string | null,
  fallbackSlug: string = DEFAULT_TOURNAMENT_SLUG
): string => {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  const fallback = fallbackSlug.trim().toLowerCase() || DEFAULT_TOURNAMENT_SLUG;
  const candidate = trimmed || fallback;
  return TOURNAMENT_SLUG_ALIASES[candidate] ?? candidate;
};

export const parseBoardIdentifier = (
  value: string,
  fallbackSlug: string = DEFAULT_TOURNAMENT_SLUG
): ParsedBoardIdentifier => {
  const match = value.match(BOARD_ID_REGEX);

  if (!match) {
    return {
      tournamentSlug: normalizeTournamentSlug("", fallbackSlug),
      round: 1,
      board: 1,
    };
  }

  const [, slug = fallbackSlug, roundRaw, boardRaw] = match;
  const normalizedSlug = normalizeTournamentSlug(slug, fallbackSlug);
  const round = toPositiveInteger(Number(roundRaw), 1);
  const board = toPositiveInteger(Number(boardRaw), 1);

  return {
    tournamentSlug: normalizedSlug,
    round,
    board,
  };
};

export const isBoardIdentifier = (value?: string | null): boolean => {
  if (!value) return false;
  return BOARD_ID_REGEX.test(value.trim());
};

export const buildBoardIdentifier = (tournamentSlug: string, round: number, board: number) => {
  const normalizedSlug = normalizeTournamentSlug(tournamentSlug, DEFAULT_TOURNAMENT_SLUG);
  const safeRound = toPositiveInteger(round, 1);
  const safeBoard = toPositiveInteger(board, 1);

  return `${normalizedSlug}-board${safeRound}.${safeBoard}`;
};

export const normalizeBoardIdentifier = (value: string, fallbackSlug: string = DEFAULT_TOURNAMENT_SLUG) => {
  const parsed = parseBoardIdentifier(value, fallbackSlug);
  return {
    normalizedBoardId: buildBoardIdentifier(parsed.tournamentSlug, parsed.round, parsed.board),
    parsed,
  };
};
