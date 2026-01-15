"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import RoundBoardSelector from "@/components/viewer/RoundBoardSelector";
import {
  DEFAULT_TOURNAMENT_SLUG,
  buildBoardIdentifier,
  normalizeTournamentSlug,
  parseBoardIdentifier,
} from "@/lib/boardId";
import { buildBroadcastBoardPath } from "@/lib/paths";

type LiveHeaderControlsProps = {
  boardId: string;
  tournamentSlug?: string;
  maxRounds?: number;
  boardsPerRound?: number;
  pane?: "notation" | "live" | "boards" | "engine";
  disableBoardSwitch?: boolean;
  onBoardSwitchBlocked?: () => void;
  density?: "default" | "compact";
};

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function LiveHeaderControls({
  boardId,
  tournamentSlug,
  maxRounds = 9,
  boardsPerRound = 20,
  pane,
  disableBoardSwitch = false,
  onBoardSwitchBlocked,
  density = "default",
}: LiveHeaderControlsProps) {
  const router = useRouter();
  const fallbackSlug = normalizeTournamentSlug((tournamentSlug ?? DEFAULT_TOURNAMENT_SLUG).toLowerCase());
  const parsed = useMemo(() => parseBoardIdentifier(boardId, fallbackSlug), [boardId, fallbackSlug]);
  const activeSlug = normalizeTournamentSlug(tournamentSlug ?? parsed.tournamentSlug ?? DEFAULT_TOURNAMENT_SLUG);

  const initialRound = clampValue(parsed.round, 1, maxRounds);
  const initialBoard = clampValue(parsed.board, 1, boardsPerRound);

  const handleSelectionChange = (roundValue: number, boardValue: number) => {
    const nextRound = clampValue(roundValue, 1, maxRounds);
    const nextBoard = clampValue(boardValue, 1, boardsPerRound);
    const nextBoardId = buildBoardIdentifier(activeSlug, nextRound, nextBoard);

    if (nextBoardId === boardId) return;
    const params = new URLSearchParams();
    if (pane) params.set("pane", pane);
    const suffix = params.toString();
    const href = `${buildBroadcastBoardPath(nextBoardId, "live", activeSlug)}${suffix ? `?${suffix}` : ""}`;
    router.push(href, { scroll: false });
  };

  return (
    <RoundBoardSelector
      initialRound={initialRound}
      initialBoard={initialBoard}
      maxRounds={maxRounds}
      boardsPerRound={boardsPerRound}
      onSelectionChange={handleSelectionChange}
      pane={pane}
      selectionLocked={disableBoardSwitch}
      onSelectionBlocked={onBoardSwitchBlocked}
      density={density}
    />
  );
}
