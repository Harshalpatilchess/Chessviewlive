import Link from "next/link";
import {
  getTournamentBoardsForRound,
  getTournamentGameManifest,
  type FideTitle,
} from "@/lib/tournamentManifest";

type TournamentHubPageProps = { params: { tournamentSlug: string } };

type PlayerInfo = {
  name: string;
  title?: FideTitle | null;
  rating: number;
};

type BoardCard = {
  key: string;
  boardId: string;
  round: number;
  board: number;
  white: PlayerInfo;
  black: PlayerInfo;
};

const DEFAULT_ROUND = 1;
const FALLBACK_BOARD_NUMBERS = [1, 2, 3, 4];

function formatPlayerLine(player: PlayerInfo) {
  const parts: string[] = [];
  if (player.title) parts.push(player.title);
  parts.push(player.name);
  if (player.rating) parts.push(`(${player.rating})`);
  return parts.join(" ");
}

export default function TournamentHubPage({ params }: TournamentHubPageProps) {
  const rawSlug = params?.tournamentSlug ?? "";
  const tournamentSlug = rawSlug.trim();
  const normalizedSlug = tournamentSlug.toLowerCase();

  if (normalizedSlug !== "worldcup") {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-16">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-6 py-8 text-center shadow-xl ring-1 ring-white/5">
            <p className="text-lg font-semibold text-white">
              Tournament "{tournamentSlug || "unknown"}" is not configured yet.
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Check the tournament slug or come back soon.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const boardNumbers =
    getTournamentBoardsForRound(normalizedSlug, DEFAULT_ROUND) ?? FALLBACK_BOARD_NUMBERS;

  const boards: BoardCard[] = boardNumbers
    .map(boardNumber => {
      const game = getTournamentGameManifest(normalizedSlug, DEFAULT_ROUND, boardNumber);
      if (!game) return null;
      const boardId = `${normalizedSlug}-board${DEFAULT_ROUND}.${boardNumber}`;
      return {
        key: boardId,
        boardId,
        round: DEFAULT_ROUND,
        board: boardNumber,
        white: {
          name: game.white,
          title: game.whiteTitle,
          rating: game.whiteRating,
        },
        black: {
          name: game.black,
          title: game.blackTitle,
          rating: game.blackRating,
        },
      };
    })
    .filter(Boolean) as BoardCard[];

  const pageTitle = "World Cup - Boards";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">
              Tournament Hub
            </p>
            <h1 className="text-3xl font-semibold text-white">{pageTitle}</h1>
          </div>
          <p className="text-sm text-slate-400">Round {DEFAULT_ROUND}</p>
        </header>

        {boards.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-6 py-10 text-center shadow-xl ring-1 ring-white/5">
            <p className="text-base text-slate-200">No boards configured yet for this tournament.</p>
            <p className="mt-1 text-sm text-slate-400">Check back when pairings are available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {boards.map(board => (
              <article
                key={board.key}
                className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-xl ring-1 ring-white/5 transition duration-200 hover:-translate-y-0.5 hover:ring-blue-400/40"
              >
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-white">
                    {formatPlayerLine(board.white)} vs {formatPlayerLine(board.black)}
                  </h2>
                  <p className="text-sm text-slate-400">
                    Round {board.round} · Board {board.board}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <Link
                    href={`/live/${board.boardId}`}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-blue-500/60 bg-blue-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-[1px] hover:bg-blue-500 focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-400/70 sm:w-auto"
                  >
                    Watch live
                  </Link>
                  <Link
                    href={`/replay/${board.boardId}`}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-100 shadow-lg transition hover:-translate-y-[1px] hover:border-blue-400/50 hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-400/70 sm:w-auto"
                  >
                    Watch replay
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
