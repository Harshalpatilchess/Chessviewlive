"use client";

import ReplayBoardPage from "../../../../replay/[boardId]/page";

type TournamentReplayPageProps = {
  params: Promise<{ tournamentSlug: string; boardId: string }>;
};

export default function TournamentReplayPage({ params }: TournamentReplayPageProps) {
  const remappedParams = params.then(resolved => ({
    boardId: resolved.boardId,
    tournamentId: resolved.tournamentSlug,
  }));

  return <ReplayBoardPage params={remappedParams} />;
}
