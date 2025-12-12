"use client";

import LiveBoardPage from "../../../../live/[boardId]/page";

type TournamentLivePageProps = {
  params: Promise<{ tournamentSlug: string; boardId: string }>;
};

export default function TournamentLivePage({ params }: TournamentLivePageProps) {
  const remappedParams = params.then(resolved => ({
    boardId: resolved.boardId,
    tournamentId: resolved.tournamentSlug,
  }));

  return <LiveBoardPage params={remappedParams} />;
}
