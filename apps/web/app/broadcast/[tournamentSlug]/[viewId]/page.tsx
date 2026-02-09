import { notFound, redirect } from "next/navigation";
import { buildBoardIdentifier, normalizeBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { buildViewerBoardPath, resolveBoardIdFromKey } from "@/lib/paths";
import { getTournamentConfig } from "@/lib/tournamentCatalog";

type BroadcastBoardPageProps = {
  params: Promise<{
    tournamentSlug: string;
    viewId: string;
  }>;
};

const extractBoardKeyFromViewId = (viewId: string) => {
  const trimmed = viewId.trim();
  if (!trimmed) return null;
  const boardMatch = trimmed.match(/board(\d+\.\d+)/i);
  if (boardMatch?.[1]) {
    return `board${boardMatch[1]}`;
  }
  const directMatch = trimmed.match(/(\d+\.\d+)/);
  if (directMatch?.[1]) {
    return `board${directMatch[1]}`;
  }
  return null;
};

const extractModeFromViewId = (viewId: string) => {
  const trimmed = viewId.trim().toLowerCase();
  if (!trimmed) return "replay" as const;
  const match = trimmed.match(/^(live|replay|reply)(?:-|$)/i);
  const rawMode = match?.[1]?.toLowerCase() ?? "replay";
  return rawMode === "reply" ? ("replay" as const) : (rawMode as "live" | "replay");
};

export default async function BroadcastBoardPage({ params }: BroadcastBoardPageProps) {
  const { tournamentSlug, viewId } = await params;
  const rawViewId = viewId ?? "";
  const trimmedViewId = rawViewId.trim();
  if (!trimmedViewId) {
    notFound();
  }

  const normalizedTournamentSlug = normalizeTournamentSlug(tournamentSlug);
  const boardKey = extractBoardKeyFromViewId(trimmedViewId);
  const mode = extractModeFromViewId(trimmedViewId);
  const boardKeyToken = boardKey ? boardKey.replace(/^board/i, "") : null;
  const isBoardLike =
    Boolean(boardKey) &&
    (/board/i.test(trimmedViewId) ||
      /replay|live|reply/i.test(trimmedViewId) ||
      (boardKeyToken ? trimmedViewId.includes(boardKeyToken) : false));

  if (boardKey && isBoardLike) {
    const rawBoardId = resolveBoardIdFromKey(normalizedTournamentSlug, boardKey);
    const { normalizedBoardId: boardId } = normalizeBoardIdentifier(rawBoardId, normalizedTournamentSlug);
    redirect(buildViewerBoardPath(boardId, mode));

    return null;
  }

  const broadcastEntry = getBroadcastTournament(normalizedTournamentSlug);
  const tournamentConfig = getTournamentConfig(normalizedTournamentSlug);
  const defaultRound = broadcastEntry?.defaultRound ?? tournamentConfig?.round ?? null;

  if (defaultRound) {
    const defaultBoardId = buildBoardIdentifier(normalizedTournamentSlug, defaultRound, 1);
    redirect(buildViewerBoardPath(defaultBoardId, mode));
  }

  redirect(`/broadcast/${encodeURIComponent(normalizedTournamentSlug)}`);
}
