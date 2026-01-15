import { redirect } from "next/navigation";
import { normalizeTournamentSlug } from "@/lib/boardId";
import { buildBroadcastBoardPath } from "@/lib/paths";

type TournamentLivePageProps = {
  params: Promise<{ tournamentSlug: string; boardId: string }>;
};

export default async function TournamentLivePage({ params }: TournamentLivePageProps) {
  const resolvedParams = await params;
  const tournamentSlug = normalizeTournamentSlug((resolvedParams?.tournamentSlug ?? "").trim().toLowerCase());
  const boardId = resolvedParams?.boardId ?? "";
  redirect(buildBroadcastBoardPath(boardId, "live", tournamentSlug));
}
