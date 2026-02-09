import { redirect } from "next/navigation";
import ReplayViewer from "@/components/viewer/ReplayViewer";
import { buildBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";

type RouteParams = {
  boardId: string;
  tournamentId?: string;
};

type ReplayBoardPageProps = {
  params: Promise<RouteParams>;
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
  liveUpdatesEnabled?: boolean;
  liveUpdatesIntervalMs?: number;
};

type ParsedReplayBoardParam = {
  tournamentSlug: string;
  round: number;
  board: number;
};

const BOARD_PARAM_REGEX = /^([a-z0-9-]+)-(?:board)?(\d+)\.(\d+)$/i;

const parseReplayBoardParam = (value: string): ParsedReplayBoardParam | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(BOARD_PARAM_REGEX);
  if (!match) return null;
  const [, slugRaw, roundRaw, boardRaw] = match;
  const round = Number.parseInt(roundRaw, 10);
  const board = Number.parseInt(boardRaw, 10);
  if (!Number.isFinite(round) || round < 1) return null;
  if (!Number.isFinite(board) || board < 1) return null;
  return {
    tournamentSlug: normalizeTournamentSlug(slugRaw),
    round,
    board,
  };
};

const resolveSearchParams = async (
  input?: ReplayBoardPageProps["searchParams"]
): Promise<Record<string, string | string[] | undefined>> => {
  if (!input) return {};
  if (typeof (input as Promise<Record<string, string | string[] | undefined>>).then === "function") {
    const resolved = await input;
    return resolved ?? {};
  }
  return input as Record<string, string | string[] | undefined>;
};

const buildQueryString = (params: Record<string, string | string[] | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string") {
      search.set(key, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === "string") {
          search.append(key, item);
        }
      });
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
};

export default async function ReplayBoardPage({
  params,
  searchParams,
  liveUpdatesEnabled,
  liveUpdatesIntervalMs,
}: ReplayBoardPageProps) {
  const { boardId } = await params;
  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const parsed = parseReplayBoardParam(boardId);

  if (!parsed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-center shadow-xl">
          <h1 className="text-lg font-semibold text-white">Invalid board id</h1>
          <p className="mt-2 text-sm text-slate-300">
            We could not parse this replay route.
          </p>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-300">
            {boardId}
          </div>
        </div>
      </main>
    );
  }

  const canonicalBoardId = buildBoardIdentifier(parsed.tournamentSlug, parsed.round, parsed.board);
  if (canonicalBoardId.toLowerCase() !== boardId.trim().toLowerCase()) {
    const queryString = buildQueryString(resolvedSearchParams);
    redirect(`/replay/${encodeURIComponent(canonicalBoardId)}${queryString}`);
  }

  return (
    <ReplayViewer
      boardId={canonicalBoardId}
      tournamentId={parsed.tournamentSlug}
      viewerVariant="full"
      liveUpdatesEnabled={liveUpdatesEnabled}
      liveUpdatesIntervalMs={liveUpdatesIntervalMs}
    />
  );
}
