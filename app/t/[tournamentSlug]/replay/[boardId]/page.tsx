"use client";

import Link from "next/link";
import { use } from "react";
import ReplayBoardPage from "../../../../replay/[boardId]/page";
import { buildBoardIdentifier, normalizeTournamentSlug, parseBoardIdentifier } from "@/lib/boardId";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";

type TournamentReplayPageProps = {
  params: Promise<{ tournamentSlug: string; boardId: string }>;
};

export default function TournamentReplayPage({ params }: TournamentReplayPageProps) {
  const resolved = use(params);
  const tournamentSlug = normalizeTournamentSlug(resolved.tournamentSlug);
  const boardId = resolved.boardId ?? "";
  const parsed = parseBoardIdentifier(boardId, tournamentSlug);
  const normalizedBoardId = buildBoardIdentifier(
    parsed.tournamentSlug,
    parsed.round,
    parsed.board
  ).toLowerCase();
  const parsedOk =
    parsed.tournamentSlug === tournamentSlug &&
    normalizedBoardId === boardId.trim().toLowerCase();
  const game = parsedOk
    ? getTournamentGameManifest(tournamentSlug, parsed.round, parsed.board)
    : null;

  if (!parsedOk || !game) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto w-full max-w-4xl px-4 py-10">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-6 py-8 shadow-xl ring-1 ring-white/5">
            <h1 className="text-lg font-semibold text-white">This board is not configured for this tournament.</h1>
            <p className="mt-2 text-sm text-slate-300">Pick another board from the tournament homepage.</p>
            <Link
              href={`/t/${encodeURIComponent(tournamentSlug)}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-800/70 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              ← Back to boards
            </Link>
          </div>
        </div>
      </main>
    );
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
