"use client";

import type { DgtLivePayload } from "@/lib/live/dgtPayload";
import { pgnToDgtBoard } from "@/lib/live/pgnToDgtPayload";
import { samplePgns } from "@/lib/live/samplePgns";

const fakeDgtFeed: DgtLivePayload = {
  tournamentSlug: "worldcup",
  round: 1,
  boards: [
    {
      board: 1,
      whiteTimeMs: 8 * 60 * 1000,
      blackTimeMs: 7 * 60 * 1000,
      sideToMove: "black",
      status: "live",
      result: null,
    },
    {
      board: 2,
      whiteTimeMs: 2 * 60 * 1000,
      blackTimeMs: 90 * 1000,
      sideToMove: "white",
      status: "live",
      result: null,
    },
    {
      board: 3,
      whiteTimeMs: 45 * 1000,
      blackTimeMs: 3 * 60 * 1000,
      sideToMove: "white",
      status: "live",
      result: null,
    },
    {
      board: 4,
      whiteTimeMs: null,
      blackTimeMs: null,
      sideToMove: null,
      status: "finished",
      result: "1-0",
    },
    {
      board: 5,
      whiteTimeMs: null,
      blackTimeMs: null,
      sideToMove: null,
      status: "finished",
      result: "0-1",
    },
    {
      board: 6,
      whiteTimeMs: null,
      blackTimeMs: null,
      sideToMove: null,
      status: "finished",
      result: "½-½",
    },
    ...samplePgns.map((pgn, idx) => pgnToDgtBoard(pgn, { board: 100 + idx + 1 })),
  ],
};

export default fakeDgtFeed;
