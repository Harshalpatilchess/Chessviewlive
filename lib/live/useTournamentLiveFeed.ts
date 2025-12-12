"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyTournamentLiveUpdates,
  type TournamentGameLiveUpdate,
} from "@/lib/tournamentManifest";
import type { DgtLivePayload } from "@/lib/live/dgtPayload";
import fakeDgtFeed from "@/lib/live/fakeDgtFeed";

type UseTournamentLiveFeedParams = {
  tournamentSlug?: string | null;
  round?: number | null;
  intervalMs?: number;
};

const buildMockUpdates = (
  payload?: DgtLivePayload | null
): TournamentGameLiveUpdate[] => {
  if (!payload) return [];
  const slug = payload.tournamentSlug?.trim();
  if (!slug || !payload.boards || !Array.isArray(payload.boards)) return [];
  return payload.boards
    .filter(board => typeof board.board === "number")
    .map(board => ({
      tournamentSlug: slug,
      round: payload.round,
      board: board.board,
      status: board.status === "finished" ? "final" : board.status ?? "live",
      result: board.result ?? null,
      whiteTimeMs: board.whiteTimeMs ?? null,
      blackTimeMs: board.blackTimeMs ?? null,
      sideToMove: board.sideToMove ?? null,
      finalFen: board.finalFen ?? null,
      moveList: board.moveList ?? null,
    }));
};

export default function useTournamentLiveFeed({
  tournamentSlug,
  round,
  intervalMs = 5000,
}: UseTournamentLiveFeedParams): number {
  const [version, setVersion] = useState(0);
  const timerRef = useRef<number | null>(null);
  const slugRef = useRef<string | null>(tournamentSlug ?? null);
  const roundRef = useRef<number | null>(round ?? null);

  useEffect(() => {
    slugRef.current = tournamentSlug ?? null;
    roundRef.current = typeof round === "number" && Number.isFinite(round) ? round : null;
  }, [round, tournamentSlug]);

  useEffect(() => {
    const fetchUpdates = async () => {
      const slug = slugRef.current;
      const activeRound = roundRef.current;
      if (!slug || activeRound == null) return;
      try {
        const payload: DgtLivePayload | null = fakeDgtFeed ?? null;
        const mapped = buildMockUpdates(payload);
        const applied = applyTournamentLiveUpdates(mapped);
        if (applied > 0) {
          setVersion(v => v + 1);
        }
      } catch {
        // Swallow errors; no fallback beyond static fake feed
      }
    };

    fetchUpdates();
    timerRef.current = window.setInterval(fetchUpdates, intervalMs);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs]);

  return version;
}
