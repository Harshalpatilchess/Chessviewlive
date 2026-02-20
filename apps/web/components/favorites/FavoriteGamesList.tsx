"use client";

import { useEffect, useMemo, useState } from "react";
import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import { parseBoardIdentifier, buildBoardIdentifier } from "@/lib/boardId";
import { pgnToPlies, pliesToFenAt } from "@/lib/chess/pgn";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import {
  FAVORITES_UPDATED_EVENT,
  isFavorite,
  listFavorites,
  resolveTournamentName,
  toggleFavorite,
  type FavoriteGameEntry,
} from "@/lib/favoriteGames";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { getMiniEvalCp } from "@/lib/miniEval";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";

const DEFAULT_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const SAMPLE_TOURNAMENT = "worldcup2025";
const SAMPLE_ROUND = 1;
const IS_DEV = process.env.NODE_ENV === "development";

const buildSampleEntry = (board: number, mode: "live" | "replay"): FavoriteGameEntry => {
  const tournamentSlug = SAMPLE_TOURNAMENT;
  const boardId = buildBoardIdentifier(tournamentSlug, SAMPLE_ROUND, board);
  const game = getTournamentGameManifest(tournamentSlug, SAMPLE_ROUND, board);
  const pgn = getWorldCupPgnForBoard(board);
  const plies = pgnToPlies(pgn);
  const fen = plies.length > 0 ? pliesToFenAt(plies, plies.length - 1) : DEFAULT_START_FEN;

  return {
    id: boardId,
    tournamentSlug,
    tournamentName: resolveTournamentName(tournamentSlug),
    round: SAMPLE_ROUND,
    roundLabel: `Round ${SAMPLE_ROUND}`,
    boardId,
    boardLabel: `Board ${SAMPLE_ROUND}.${board}`,
    whitePlayer: game?.white?.trim() || "Official source unavailable",
    blackPlayer: game?.black?.trim() || "Official source unavailable",
    fen,
    mode,
    updatedAt: Date.now(),
  };
};

export default function FavoriteGamesList() {
  const [favorites, setFavorites] = useState<FavoriteGameEntry[]>([]);

  useEffect(() => {
    const update = () => setFavorites(listFavorites());
    update();
    const handleStorage = () => update();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(FAVORITES_UPDATED_EVENT, handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(FAVORITES_UPDATED_EVENT, handleStorage);
    };
  }, []);

  const boardEntries = useMemo<BoardNavigationEntry[]>(
    () =>
      favorites.map(entry => {
        const parsed = parseBoardIdentifier(entry.boardId, entry.tournamentSlug);
        const previewFen = typeof entry.fen === "string" && entry.fen.trim() ? entry.fen : null;
        return {
          boardId: entry.boardId,
          boardNumber: parsed.board,
          status: entry.mode === "replay" ? "final" : "live",
          previewFen,
          miniEvalCp: previewFen ? getMiniEvalCp(previewFen) : null,
          white: { name: entry.whitePlayer ?? "Official source unavailable" },
          black: { name: entry.blackPlayer ?? "Official source unavailable" },
        };
      }),
    [favorites]
  );

  const handleSeedFavorites = () => {
    const samples = [buildSampleEntry(1, "live"), buildSampleEntry(2, "replay")];
    samples.forEach(entry => {
      if (!isFavorite(entry.id)) {
        toggleFavorite(entry);
      }
    });
  };

  return (
    <div className="grid gap-4">
      {IS_DEV ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleSeedFavorites}
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/10"
          >
            Add sample favorite
          </button>
        </div>
      ) : null}
      <BoardsNavigation
        boards={boardEntries}
        sidebarBoards={boardEntries}
        layout="grid"
        variant="tournament"
        gridColsClassName="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        liveUpdatesEnabled={false}
        emptyLabel="No favorite games yet."
      />
    </div>
  );
}
