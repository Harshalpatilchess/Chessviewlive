import { DEFAULT_TOURNAMENT_SLUG, normalizeTournamentSlug, parseBoardIdentifier } from "@/lib/boardId";

export type BroadcastViewMode = "live" | "replay";

const BROADCAST_VIEW_ID_REGEX = /^(live|replay|reply)-(.+)$/i;

const normalizeBroadcastBoardKey = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+\.\d+$/i.test(trimmed)) {
    return `board${trimmed}`;
  }
  return trimmed;
};

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
  const trimmed = viewId.trim();
  if (!trimmed) return null;
  const match = trimmed.match(BROADCAST_VIEW_ID_REGEX);
  const rawMode = match?.[1]?.toLowerCase() ?? "replay";
  const boardKeyRaw = (match?.[2] ?? trimmed).trim();
  if (!boardKeyRaw) return null;
  const mode = rawMode === "reply" ? "replay" : (rawMode as BroadcastViewMode);
  const boardKey = normalizeBroadcastBoardKey(boardKeyRaw);
  if (!boardKey) return null;
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

export const buildViewerBoardPath = (boardId: string, mode: BroadcastViewMode) =>
  `/${mode}/${encodeURIComponent(boardId)}`;

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
