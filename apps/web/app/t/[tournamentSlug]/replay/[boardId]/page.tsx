import { redirect } from "next/navigation";
import { normalizeTournamentSlug } from "@/lib/boardId";
import { buildBroadcastBoardPath } from "@/lib/paths";

type TournamentReplayPageProps = {
  params: Promise<{ tournamentSlug: string; boardId: string }>;
};

export default async function TournamentReplayPage({ params }: TournamentReplayPageProps) {
  const resolved = await params;
  const tournamentSlug = normalizeTournamentSlug(resolved.tournamentSlug);
  const boardId = resolved.boardId ?? "";
  redirect(buildBroadcastBoardPath(boardId, "replay", tournamentSlug));
}
