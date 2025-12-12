export const DEFAULT_TOURNAMENT_SLUG = "worldcup";

export type ParsedBoardIdentifier = {
  tournamentSlug: string;
  round: number;
  board: number;
};

const toPositiveInteger = (value: number, fallback: number) => {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
};

export const parseBoardIdentifier = (
  value: string,
  fallbackSlug: string = DEFAULT_TOURNAMENT_SLUG
): ParsedBoardIdentifier => {
  const regex = /^([a-z0-9-]+)-board(\d+)\.(\d+)$/i;
  const match = value.match(regex);

  if (!match) {
    return {
      tournamentSlug: fallbackSlug,
      round: 1,
      board: 1,
    };
  }

  const [, slug = fallbackSlug, roundRaw, boardRaw] = match;
  const round = toPositiveInteger(Number(roundRaw), 1);
  const board = toPositiveInteger(Number(boardRaw), 1);

  return {
    tournamentSlug: slug.toLowerCase(),
    round,
    board,
  };
};

export const buildBoardIdentifier = (tournamentSlug: string, round: number, board: number) => {
  const normalizedSlug = tournamentSlug.trim().toLowerCase() || DEFAULT_TOURNAMENT_SLUG;
  const safeRound = toPositiveInteger(round, 1);
  const safeBoard = toPositiveInteger(board, 1);

  return `${normalizedSlug}-board${safeRound}.${safeBoard}`;
};
