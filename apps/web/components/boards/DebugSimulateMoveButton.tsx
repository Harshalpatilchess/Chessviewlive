"use client";

import { useCallback, useState } from "react";
import { Chess } from "chess.js";
import { parseBoardIdentifier } from "@/lib/boardId";
import { queueForceEval } from "@/lib/engine/miniEvalDebug";
import {
  applyTournamentLiveUpdates,
  getTournamentGameManifest,
  type TournamentGame,
  type TournamentGameLiveUpdate,
} from "@/lib/tournamentManifest";

type DebugSimulateMoveButtonProps = {
  boardId: string;
  tournamentSlug: string;
  previewFen?: string | null;
};

const START_FEN = new Chess().fen();

const getFenHash = (fen: string) => {
  const trimmed = fen.trim();
  const [placement] = trimmed.split(/\s+/);
  return placement ?? trimmed;
};

const resolveBaseFen = (game: TournamentGame | null, previewFen?: string | null) => {
  if (game?.finalFen) return game.finalFen;
  if (typeof previewFen === "string" && previewFen.trim()) return previewFen.trim();
  return START_FEN;
};

const tryAdvanceFen = (fen: string, oldHash: string) => {
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    return null;
  }
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  for (const move of moves) {
    chess.move(move);
    const nextFen = chess.fen();
    if (getFenHash(nextFen) !== oldHash) {
      return { fen: nextFen };
    }
    chess.undo();
  }
  chess.move(moves[0]);
  return { fen: chess.fen() };
};

export default function DebugSimulateMoveButton({
  boardId,
  tournamentSlug,
  previewFen,
}: DebugSimulateMoveButtonProps) {
  const [isRunning, setIsRunning] = useState(false);

  const handleClick = useCallback(() => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const parsed = parseBoardIdentifier(boardId, tournamentSlug);
      const game = getTournamentGameManifest(parsed.tournamentSlug, parsed.round, parsed.board);
      const currentFen = resolveBaseFen(game, previewFen);
      const oldHash = getFenHash(currentFen);
      const result = tryAdvanceFen(currentFen, oldHash);

      if (!result) {
        console.warn("[debug] simulate move failed: no legal moves", { boardId });
        return;
      }

      const update: TournamentGameLiveUpdate = {
        tournamentSlug: parsed.tournamentSlug,
        round: parsed.round,
        board: parsed.board,
        finalFen: result.fen,
      };

      applyTournamentLiveUpdates([update]);
      const newHash = getFenHash(result.fen);
      if (oldHash === newHash) {
        console.warn("[debug] simulate move did not change fenHash", { boardId: parsed, oldHash, newHash });
      }
      queueForceEval(boardId, newHash);
      console.info("[debug] simulate move", {
        boardId: parsed,
        oldHash,
        newHash,
        autoEvalExpected: true,
        forceUpstream: true,
      });
      window.dispatchEvent(
        new CustomEvent("tournament-live-update", {
          detail: { tournamentSlug: parsed.tournamentSlug, round: parsed.round, board: parsed.board },
        })
      );
    } finally {
      window.setTimeout(() => {
        setIsRunning(false);
      }, 300);
    }
  }, [boardId, isRunning, previewFen, tournamentSlug]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isRunning}
      className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-60"
      aria-label="Simulate move for top board"
    >
      Simulate move
    </button>
  );
}
