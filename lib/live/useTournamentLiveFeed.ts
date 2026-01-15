"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyTournamentLiveUpdates,
  type TournamentGameLiveUpdate,
} from "@/lib/tournamentManifest";
import type { DgtLivePayload } from "@/lib/live/dgtPayload";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";

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
      white: board.white ?? null,
      black: board.black ?? null,
      status: board.status === "finished" ? "final" : board.status ?? "live",
      result: board.result ?? null,
      whiteTimeMs: board.whiteTimeMs ?? null,
      blackTimeMs: board.blackTimeMs ?? null,
      sideToMove: board.sideToMove ?? null,
      previewFen: board.fen ?? board.finalFen ?? null,
      finalFen: board.finalFen ?? null,
      moveList: board.moveList ?? board.moves ?? null,
    }));
};

const resolveLiveEndpoint = (slug: string) => {
  const broadcast = getBroadcastTournament(slug);
  if (broadcast?.sourceType === "livechesscloud") {
    return "/api/tournament/lcc";
  }
  if (broadcast?.sourceType === "lichessBroadcast") {
    return "/api/tournament/lichess";
  }
  return "/api/tournament/live";
};

export default function useTournamentLiveFeed({
  tournamentSlug,
  round,
  intervalMs = 5000,
}: UseTournamentLiveFeedParams): number {
  const [version, setVersion] = useState(0);
  const timerRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);
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
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      try {
        const query = new URLSearchParams({
          slug,
          round: String(activeRound),
        });
        const endpoint = resolveLiveEndpoint(slug);
        const response = await fetch(`${endpoint}?${query.toString()}`, {
          cache: "no-store",
        });
        if (response.status === 204) return;
        if (!response.ok) return;
        const payload = (await response.json()) as DgtLivePayload | null;
        const mapped = buildMockUpdates(payload);
        const applied = applyTournamentLiveUpdates(mapped);
        if (applied > 0) {
          setVersion(v => v + 1);
        }
      } catch {
        // Swallow errors; live feed is best-effort.
      } finally {
        fetchInFlightRef.current = false;
      }
    };

    const slug = slugRef.current;
    const activeRound = roundRef.current;
    if (!slug || activeRound == null) return;
    fetchUpdates();
    timerRef.current = window.setInterval(fetchUpdates, intervalMs);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs, round, tournamentSlug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tournamentSlug?: string; round?: number }>).detail;
      const slug = slugRef.current?.trim().toLowerCase();
      const activeRound = roundRef.current;
      if (!slug || activeRound == null) return;
      const detailSlug = detail?.tournamentSlug?.trim().toLowerCase();
      if (detailSlug && detailSlug !== slug) return;
      if (typeof detail?.round === "number" && Number.isFinite(detail.round)) {
        if (Math.floor(detail.round) !== activeRound) return;
      }
      setVersion(v => v + 1);
    };
    window.addEventListener("tournament-live-update", handler);
    return () => {
      window.removeEventListener("tournament-live-update", handler);
    };
  }, []);

  return version;
}
