import { notFound } from "next/navigation";
import ReplayBoardPage from "@/app/replay/[boardId]/page";
import { LiveViewer } from "@/components/viewer/LiveViewer";
import { normalizeTournamentSlug } from "@/lib/boardId";
import { parseBroadcastViewId, resolveBoardIdFromKey } from "@/lib/paths";

type BroadcastBoardPageProps = {
  params: {
    tournamentSlug: string;
    viewId: string;
  };
};

export default function BroadcastBoardPage({ params }: BroadcastBoardPageProps) {
  const parsedView = parseBroadcastViewId(params.viewId ?? "");
  if (!parsedView) {
    notFound();
  }

  const tournamentSlug = normalizeTournamentSlug(params.tournamentSlug);
  const boardId = resolveBoardIdFromKey(tournamentSlug, parsedView.boardKey);

  if (parsedView.mode === "live") {
    return <LiveViewer boardId={boardId} tournamentId={tournamentSlug} variant="full" />;
  }

  return (
    <ReplayBoardPage
      params={Promise.resolve({
        boardId,
        tournamentId: tournamentSlug,
      })}
      viewerVariant="full"
    />
  );
}
