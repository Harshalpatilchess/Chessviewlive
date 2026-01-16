const DEFAULT_FEATURED_TITLE = "Championship Broadcast";

function sanitize(value?: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type FeaturedConfig = {
  tournamentId?: string;
  boardId?: string;
  title: string;
};

export function getFeaturedConfig(): FeaturedConfig {
  const tournamentId = sanitize(process.env.NEXT_PUBLIC_FEATURED_TOURNAMENT_ID);
  const boardId = sanitize(process.env.NEXT_PUBLIC_FEATURED_BOARD_ID);
  const title = sanitize(process.env.NEXT_PUBLIC_FEATURED_TITLE) ?? DEFAULT_FEATURED_TITLE;
  return {
    tournamentId,
    boardId,
    title,
  };
}
