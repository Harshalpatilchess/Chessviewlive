import TournamentBoardsNavigation from "@/components/boards/TournamentBoardsNavigation";
import { buildBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";
import { getTournamentBoardsForRound, getTournamentGameManifest } from "@/lib/tournamentManifest";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";

type TournamentHubPageProps = { params: Promise<{ tournamentSlug: string }> };

const DEFAULT_ROUND = 1;

export default async function TournamentHubPage({ params }: TournamentHubPageProps) {
  const resolvedParams = await params;
  const rawSlug = resolvedParams?.tournamentSlug ?? "";
  const tournamentSlug = rawSlug.trim();
  const normalizedSlug = normalizeTournamentSlug(tournamentSlug.toLowerCase());

  const boardNumbers = getTournamentBoardsForRound(normalizedSlug, DEFAULT_ROUND) ?? [];
  const boards = boardNumbers.reduce<BoardNavigationEntry[]>((acc, boardNumber) => {
    const game = getTournamentGameManifest(normalizedSlug, DEFAULT_ROUND, boardNumber);
    if (!game) return acc;
    acc.push({
      boardId: buildBoardIdentifier(normalizedSlug, DEFAULT_ROUND, boardNumber),
      boardNumber,
      result: game.result ?? null,
      status: game.status ?? "unknown",
      evaluation: game.evaluation ?? null,
      whiteTimeMs: game.whiteTimeMs ?? null,
      blackTimeMs: game.blackTimeMs ?? null,
      sideToMove: game.sideToMove ?? null,
      finalFen: game.finalFen ?? null,
      moveList: game.moveList ?? null,
      white: {
        name: game.white,
        title: game.whiteTitle,
        rating: game.whiteRating,
        flag: game.whiteFlag,
      },
      black: {
        name: game.black,
        title: game.blackTitle,
        rating: game.blackRating,
        flag: game.blackFlag,
      },
    });
    return acc;
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <header className="mb-6 rounded-2xl border border-white/10 bg-slate-900/60 px-5 py-4 shadow-xl ring-1 ring-white/5">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Tournament</p>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">{tournamentSlug || "Tournament"}</h1>
            <p className="text-sm text-slate-400">Round {DEFAULT_ROUND}</p>
          </div>
        </header>

        <TournamentBoardsNavigation tournamentSlug={normalizedSlug} boards={boards} />
      </div>
    </main>
  );
}
