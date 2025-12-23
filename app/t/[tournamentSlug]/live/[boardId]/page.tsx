import Link from "next/link";
import { redirect } from "next/navigation";
import LiveBoardPage from "../../../../live/[boardId]/page";
import { normalizeTournamentSlug, parseBoardIdentifier } from "@/lib/boardId";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";
import type { GameResult } from "@/lib/tournamentManifest";

type TournamentLivePageProps = {
  params: Promise<{ tournamentSlug: string; boardId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const normalizeResult = (result?: GameResult | null): GameResult | null => {
  if (!result || result === "·" || result === "*") return null;
  return result === "1/2-1/2" ? "½-½" : result;
};

const buildQueryString = (searchParams?: Record<string, string | string[] | undefined>) => {
  if (!searchParams) return "";
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      qs.set(key, value);
    } else if (Array.isArray(value)) {
      qs.delete(key);
      for (const item of value) {
        if (typeof item === "string") qs.append(key, item);
      }
    }
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
};

export default async function TournamentLivePage({ params, searchParams }: TournamentLivePageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const tournamentSlug = normalizeTournamentSlug((resolvedParams?.tournamentSlug ?? "").trim().toLowerCase());
  const boardId = resolvedParams?.boardId ?? "";
  const parsed = parseBoardIdentifier(boardId, tournamentSlug);

  if (parsed.tournamentSlug !== tournamentSlug) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto w-full max-w-4xl px-4 py-10">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-6 py-8 shadow-xl ring-1 ring-white/5">
            <h1 className="text-lg font-semibold text-white">This board is not configured for this tournament.</h1>
            <p className="mt-2 text-sm text-slate-300">Pick a valid board from the tournament homepage.</p>
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

  const game = getTournamentGameManifest(tournamentSlug, parsed.round, parsed.board);
  if (!game) {
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

  const normalizedResult = normalizeResult(game.result);
  const isFinished = game.status === "final" || Boolean(normalizedResult) || Boolean(game.finalFen);
  if (isFinished) {
    redirect(
      `/t/${encodeURIComponent(tournamentSlug)}/replay/${encodeURIComponent(boardId)}${buildQueryString(resolvedSearchParams)}`
    );
  }

  return (
    <LiveBoardPage
      params={Promise.resolve({
        boardId,
        tournamentId: tournamentSlug,
      })}
    />
  );
}
