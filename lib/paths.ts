import { DEFAULT_TOURNAMENT_SLUG, normalizeTournamentSlug, parseBoardIdentifier } from "@/lib/boardId";

export type BroadcastViewMode = "live" | "replay";

const BROADCAST_VIEW_ID_REGEX = /^(live|replay|reply)-(.+)$/i;

const resolveTournamentSlug = (boardId: string, tournamentId?: string) => {
  if (tournamentId && tournamentId.trim().length > 0) {
    return normalizeTournamentSlug(tournamentId);
  }
  const parsed = parseBoardIdentifier(boardId, DEFAULT_TOURNAMENT_SLUG);
  return normalizeTournamentSlug(parsed.tournamentSlug);
};

export const normalizeBoardKey = (boardIdOrKey: string, tournamentSlug: string) => {
  const trimmed = boardIdOrKey.trim();
  const normalizedSlug = normalizeTournamentSlug(tournamentSlug);
  const slugPrefix = `${normalizedSlug}-`;
  if (trimmed.toLowerCase().startsWith(slugPrefix)) {
    return trimmed.slice(slugPrefix.length);
  }
  return trimmed;
};

export const resolveBoardIdFromKey = (tournamentSlug: string, boardKey: string) => {
  const normalizedSlug = normalizeTournamentSlug(tournamentSlug);
  const normalizedKey = normalizeBoardKey(boardKey, normalizedSlug);
  return `${normalizedSlug}-${normalizedKey}`;
};

export const parseBroadcastViewId = (viewId: string) => {
  const match = viewId.trim().match(BROADCAST_VIEW_ID_REGEX);
  if (!match) return null;
  const rawMode = match[1]?.toLowerCase();
  const boardKey = match[2]?.trim();
  if (!boardKey) return null;
  const mode = rawMode === "reply" ? "replay" : (rawMode as BroadcastViewMode);
  return { mode, boardKey };
};

export const buildBroadcastBoardPath = (
  boardIdOrKey: string,
  mode: BroadcastViewMode,
  tournamentId?: string
) => {
  const tournamentSlug = resolveTournamentSlug(boardIdOrKey, tournamentId);
  const boardKey = normalizeBoardKey(boardIdOrKey, tournamentSlug);
  return `/broadcast/${encodeURIComponent(tournamentSlug)}/${mode}-${encodeURIComponent(boardKey)}`;
};

export const buildBroadcastBoardPaths = (boardId: string, tournamentId?: string) => ({
  live: buildBroadcastBoardPath(boardId, "live", tournamentId),
  replay: buildBroadcastBoardPath(boardId, "replay", tournamentId),
});

export function buildBoardPaths(boardId: string, tournamentId?: string) {
  const base = tournamentId ? `/t/${encodeURIComponent(tournamentId)}` : "";
  return {
    ...buildBroadcastBoardPaths(boardId, tournamentId),
    organizer: `${base}/organizer/${encodeURIComponent(boardId)}`,
  };
}
