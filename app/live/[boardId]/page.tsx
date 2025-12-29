"use client";

import { use } from "react";
import { LiveViewer } from "@/components/viewer/LiveViewer";

type RouteParams = {
  boardId: string;
  tournamentId?: string;
};

export default function LiveBoardPage(props: { params: Promise<RouteParams> }) {
  const { boardId, tournamentId } = use(props.params);
  return <LiveViewer boardId={boardId} tournamentId={tournamentId} variant="full" />;
}
