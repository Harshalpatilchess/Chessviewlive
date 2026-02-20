import type { Metadata } from "next";
import Link from "next/link";
import RoundTextDropdown from "@/components/boards/RoundTextDropdown";
import Flag from "@/components/live/Flag";
import TitleBadge from "@/components/boards/TitleBadge";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { buildBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";
import { BROADCASTS, getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { formatBoardResultLabel, getBoardStatusLabel, normalizeResultValue } from "@/lib/boards/boardStatus";
import { fetchLichessBroadcastRound, fetchLichessBroadcastTournament } from "@/lib/sources/lichessBroadcast";
import { probeLiveChessCloud } from "@/lib/sources/livechesscloud";
import { buildResultsJsonLd, buildResultsMetadata } from "@/lib/seo";
import { DEFAULT_ROUND, getTournamentConfig } from "@/lib/tournamentCatalog";
import {
  getTournamentRoundEntries,
  getTournamentRounds,
  type FideTitle,
  type TournamentGame,
  type TournamentRoundEntry,
} from "@/lib/tournamentManifest";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type TournamentResultsPageProps = {
  params: Promise<{ tournamentSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const resolveParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const parseRoundParam = (value?: string) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
};

const normalizeFideTitle = (value?: string | null): FideTitle | null => {
  if (!value) return null;
  const candidate = value.trim().toUpperCase();
  if (
    candidate === "GM" ||
    candidate === "IM" ||
    candidate === "FM" ||
    candidate === "CM" ||
    candidate === "WGM" ||
    candidate === "WIM" ||
    candidate === "WFM" ||
    candidate === "WCM"
  ) {
    return candidate as FideTitle;
  }
  return null;
};

const formatTournamentName = (slug: string) =>
  slug
    .split("-")
    .map(word => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ");

const normalizeTournamentTitle = (value: string) =>
  value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeBroadcastStatus = (
  value?: string | null,
  result?: TournamentGame["result"]
): TournamentGame["status"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalizedResult = normalizeResultValue(result ?? null);
  if (normalizedResult) return "final";
  if (normalized === "scheduled" || normalized === "upcoming" || normalized === "pending") return "scheduled";
  if (normalized === "finished" || normalized === "final" || normalized === "completed") return "final";
  if (normalized) return "live";
  return "live";
};

const normalizeBroadcastResult = (value?: string | null): TournamentGame["result"] => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized === "*" || normalized === "\u00b7") return "*";
  if (normalized === "1-0" || normalized === "0-1" || normalized === "1/2-1/2" || normalized === "\u00bd-\u00bd") {
    return normalized;
  }
  if (normalized.toLowerCase() === "draw") return "1/2-1/2";
  return null;
};

const isGameLive = (game: TournamentGame | null) => {
  if (!game) return false;
  const normalizedResult = normalizeResultValue(game.result ?? null);
  if (normalizedResult) return false;
  return game.status === "live";
};

const isGameFinished = (game: TournamentGame | null) => {
  if (!game) return false;
  const normalizedResult = normalizeResultValue(game.result ?? null);
  if (normalizedResult) return true;
  return game.status === "final";
};

const selectAutoRoundFromManifest = (tournamentSlug: string, rounds: number[]) => {
  if (!rounds.length) return null;
  let latestLive: number | null = null;
  let latestFinished: number | null = null;
  rounds.forEach(round => {
    const entries = getTournamentRoundEntries(tournamentSlug, round);
    if (entries.length === 0) return;
    const hasLive = entries.some(entry => isGameLive(entry.game));
    const allFinished = entries.every(entry => isGameFinished(entry.game));
    if (hasLive) latestLive = round;
    if (allFinished) latestFinished = round;
  });
  return latestLive ?? latestFinished;
};

const formatPoints = (points?: number | null) => {
  if (!Number.isFinite(points ?? NaN)) return "-";
  return Number.isInteger(points) ? String(points) : (points as number).toFixed(1);
};

export async function generateMetadata({
  params,
  searchParams,
}: TournamentResultsPageProps): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;
  const resolvedParams = await params;
  const rawSlug = resolvedParams?.tournamentSlug ?? "";
  const trimmedSlug = rawSlug.trim();
  const normalizedSlug = normalizeTournamentSlug(trimmedSlug);
  const roundParam = resolveParam(resolvedSearchParams.round);
  const roundIdParam = resolveParam(resolvedSearchParams.roundId);
  const requestedRound = parseRoundParam(roundParam);

  const broadcastEntry = getBroadcastTournament(normalizedSlug);
  const tournamentConfig = getTournamentConfig(normalizedSlug);
  const tournamentNameRaw = tournamentConfig?.name ?? broadcastEntry?.title ?? formatTournamentName(normalizedSlug);
  const tournamentName = normalizeTournamentTitle(tournamentNameRaw);
  const isLichessBroadcast = broadcastEntry?.sourceType === "lichessBroadcast";
  const broadcastRoundIdOverride = typeof roundIdParam === "string" && roundIdParam.trim() ? roundIdParam.trim() : null;
  const broadcastTournamentMeta =
    isLichessBroadcast && broadcastEntry?.lichessBroadcastId
      ? await fetchLichessBroadcastTournament({
          tournamentId: broadcastEntry.lichessBroadcastId,
          roundIdOverride: broadcastRoundIdOverride,
        }).catch(() => null)
      : null;
  const broadcastRoundsMeta = broadcastTournamentMeta?.snapshot.rounds ?? [];
  const roundIndexFromId = broadcastRoundIdOverride
    ? broadcastRoundsMeta.findIndex(round => round.id === broadcastRoundIdOverride)
    : -1;
  const broadcastDefaultRound = isLichessBroadcast
    ? roundIndexFromId >= 0
      ? roundIndexFromId + 1
      : broadcastTournamentMeta?.snapshot.activeRoundIndex ?? broadcastEntry?.defaultRound ?? DEFAULT_ROUND
    : broadcastEntry?.defaultRound ?? DEFAULT_ROUND;
  const defaultRound = broadcastDefaultRound ?? tournamentConfig?.round ?? DEFAULT_ROUND;
  const availableRounds = broadcastEntry
    ? broadcastRoundsMeta.length > 0
      ? broadcastRoundsMeta.map((_, index) => index + 1)
      : [broadcastDefaultRound]
    : getTournamentRounds(normalizedSlug);
  const hasExplicitRoundList = isLichessBroadcast && broadcastRoundsMeta.length > 0;
  const baseRoundOptions = availableRounds.length > 0 ? availableRounds : [defaultRound];
  const fallbackRoundOptions = Array.from({ length: 9 }, (_, index) => index + 1);
  const useFallbackRounds = !hasExplicitRoundList && baseRoundOptions.length <= 1;
  const roundSelectionOptions = useFallbackRounds ? fallbackRoundOptions : baseRoundOptions;
  const fallbackRound = roundSelectionOptions.includes(defaultRound)
    ? defaultRound
    : roundSelectionOptions[0] ?? defaultRound;
  const autoRound =
    !broadcastEntry && !requestedRound && !broadcastRoundIdOverride
      ? selectAutoRoundFromManifest(normalizedSlug, baseRoundOptions)
      : null;
  const activeRound =
    requestedRound && (roundSelectionOptions.length === 0 || roundSelectionOptions.includes(requestedRound))
      ? requestedRound
      : autoRound && (roundSelectionOptions.length === 0 || roundSelectionOptions.includes(autoRound))
        ? autoRound
        : fallbackRound;
  const activeRoundMeta = isLichessBroadcast ? broadcastRoundsMeta[activeRound - 1] : null;
  const activeRoundLabel = activeRoundMeta?.name?.trim() || tournamentConfig?.roundLabel || `Round ${activeRound}`;

  return buildResultsMetadata({
    tournamentName,
    slug: normalizedSlug,
    roundLabel: activeRoundLabel,
    round: activeRound,
  });
}

export default async function BroadcastResultsPage({ params, searchParams }: TournamentResultsPageProps) {
  const resolvedSearchParams = await searchParams;
  const resolvedParams = await params;
  const rawSlug = resolvedParams?.tournamentSlug ?? "";
  const trimmedSlug = rawSlug.trim();
  const normalizedSlug = normalizeTournamentSlug(trimmedSlug);
  const roundParam = resolveParam(resolvedSearchParams.round);
  const roundIdParam = resolveParam(resolvedSearchParams.roundId);
  const debugParam = resolveParam(resolvedSearchParams.debug);
  const requestedRound = parseRoundParam(roundParam);
  const isDebug = debugParam === "1";

  const broadcastEntry = getBroadcastTournament(normalizedSlug);
  const tournamentConfig = getTournamentConfig(normalizedSlug);
  const knownBroadcastSlugs = BROADCASTS.map(entry => entry.slug).filter(Boolean);
  const isKnownTournament = Boolean(tournamentConfig || broadcastEntry);

  if (!isKnownTournament) {
    return (
      <main className="min-h-screen bg-[#020817] text-slate-100">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.65),_transparent_60%)]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-4xl items-center px-6 py-16">
          <section className="w-full rounded-[28px] border border-white/10 bg-white/[0.06] p-10 shadow-[0_28px_80px_rgba(2,6,23,0.6)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">
              Tournament results
            </p>
            <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Tournament not found
            </h1>
            <p className="mt-3 max-w-xl text-sm text-slate-300">
              The tournament slug does not match a local demo or a curated broadcast. Browse the
              broadcast catalog to open a live event.
            </p>
            <div className="mt-8">
              <Link
                href="/broadcasts"
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:border-sky-300/60 hover:bg-sky-300/10"
              >
                View broadcasts
              </Link>
            </div>
            {isDebug ? (
              <p className="mt-6 text-xs font-semibold text-slate-400">
                Known broadcast slugs: {knownBroadcastSlugs.join(", ") || "none"}
              </p>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  const tournamentNameRaw = tournamentConfig?.name ?? broadcastEntry?.title ?? formatTournamentName(normalizedSlug);
  const tournamentName = normalizeTournamentTitle(tournamentNameRaw);
  const isLccBroadcast = broadcastEntry?.sourceType === "livechesscloud";
  const isLichessBroadcast = broadcastEntry?.sourceType === "lichessBroadcast";
  const broadcastRoundIdOverride = typeof roundIdParam === "string" && roundIdParam.trim() ? roundIdParam.trim() : null;
  const broadcastTournamentMeta = isLichessBroadcast && broadcastEntry?.lichessBroadcastId
    ? await fetchLichessBroadcastTournament({
        tournamentId: broadcastEntry.lichessBroadcastId,
        roundIdOverride: broadcastRoundIdOverride,
        debug: isDebug,
      }).catch(() => null)
    : null;
  const broadcastRoundsMeta = broadcastTournamentMeta?.snapshot.rounds ?? [];
  const roundIndexFromId = broadcastRoundIdOverride
    ? broadcastRoundsMeta.findIndex(round => round.id === broadcastRoundIdOverride)
    : -1;
  const broadcastDefaultRound = isLichessBroadcast
    ? roundIndexFromId >= 0
      ? roundIndexFromId + 1
      : broadcastTournamentMeta?.snapshot.activeRoundIndex ?? broadcastEntry?.defaultRound ?? DEFAULT_ROUND
    : broadcastEntry?.defaultRound ?? DEFAULT_ROUND;
  const defaultRound = broadcastDefaultRound ?? tournamentConfig?.round ?? DEFAULT_ROUND;
  const availableRounds = broadcastEntry
    ? broadcastRoundsMeta.length > 0
      ? broadcastRoundsMeta.map((_, index) => index + 1)
      : [broadcastDefaultRound]
    : getTournamentRounds(normalizedSlug);
  const hasExplicitRoundList = isLichessBroadcast && broadcastRoundsMeta.length > 0;
  const baseRoundOptions = availableRounds.length > 0 ? availableRounds : [defaultRound];
  const fallbackRoundOptions = Array.from({ length: 9 }, (_, index) => index + 1);
  const useFallbackRounds = !hasExplicitRoundList && baseRoundOptions.length <= 1;
  const roundSelectionOptions = useFallbackRounds ? fallbackRoundOptions : baseRoundOptions;
  const fallbackRound = roundSelectionOptions.includes(defaultRound)
    ? defaultRound
    : roundSelectionOptions[0] ?? defaultRound;
  const autoRound =
    !broadcastEntry && !requestedRound && !broadcastRoundIdOverride
      ? selectAutoRoundFromManifest(normalizedSlug, baseRoundOptions)
      : null;
  const activeRound =
    requestedRound && (roundSelectionOptions.length === 0 || roundSelectionOptions.includes(requestedRound))
      ? requestedRound
      : autoRound && (roundSelectionOptions.length === 0 || roundSelectionOptions.includes(autoRound))
        ? autoRound
        : fallbackRound;

  const lichessRoundId =
    broadcastRoundIdOverride ||
    broadcastRoundsMeta[activeRound - 1]?.id ||
    broadcastTournamentMeta?.snapshot.activeRoundId ||
    null;

  const lccPayload =
    isLccBroadcast && broadcastEntry?.tournamentId
      ? await probeLiveChessCloud({
          tournamentId: broadcastEntry.tournamentId,
          round: activeRound,
          limit: 64,
          debug: isDebug,
        }).catch(() => null)
      : null;
  const lichessPayload =
    isLichessBroadcast && broadcastEntry?.lichessBroadcastId
      ? await fetchLichessBroadcastRound({
          tournamentId: broadcastEntry.lichessBroadcastId,
          roundIdOverride: lichessRoundId,
          debug: isDebug,
        }).catch(() => null)
      : null;
  const broadcastBoards = isLccBroadcast
    ? lccPayload?.payload.boards ?? []
    : isLichessBroadcast
      ? lichessPayload?.boards ?? []
      : [];
  const roundEntries: TournamentRoundEntry[] = broadcastEntry
    ? broadcastBoards.map(board => {
        const boardNo = board.boardNo;
        let whiteRating = 0;
        let blackRating = 0;
        let whiteTitle: FideTitle | null = null;
        let blackTitle: FideTitle | null = null;
        let whiteCountry = "";
        let blackCountry = "";
        if ("whiteElo" in board) {
          whiteRating =
            typeof board.whiteElo === "number" && Number.isFinite(board.whiteElo) ? board.whiteElo : 0;
          blackRating =
            typeof board.blackElo === "number" && Number.isFinite(board.blackElo) ? board.blackElo : 0;
          whiteTitle = normalizeFideTitle(board.whiteTitle);
          blackTitle = normalizeFideTitle(board.blackTitle);
          whiteCountry = board.whiteCountry?.trim() || "";
          blackCountry = board.blackCountry?.trim() || "";
        }
        return {
          board: boardNo,
          game: {
            tournamentSlug: normalizedSlug,
            boardId: buildBoardIdentifier(normalizedSlug, activeRound, boardNo),
            round: activeRound,
            board: boardNo,
            white: board.whiteName?.trim() || "?",
            whiteTitle,
            whiteRating,
            whiteCountry,
            whiteFlag: whiteCountry,
            black: board.blackName?.trim() || "?",
            blackTitle,
            blackRating,
            blackCountry,
            blackFlag: blackCountry,
            result: normalizeBroadcastResult(board.result),
            status: normalizeBroadcastStatus(board.status, normalizeBroadcastResult(board.result)),
            moveList: board.moveList ?? null,
          },
        };
      })
    : getTournamentRoundEntries(normalizedSlug, activeRound);
  const boardEntries: BoardNavigationEntry[] = roundEntries
    .map(({ board, game }) => ({
      boardId: game.boardId ?? buildBoardIdentifier(normalizedSlug, activeRound, board),
      boardNumber: board,
      result: game.result ?? null,
      status: game.status ?? "scheduled",
      evaluation: game.evaluation ?? null,
      whiteTimeMs: game.whiteTimeMs ?? null,
      blackTimeMs: game.blackTimeMs ?? null,
      sideToMove: game.sideToMove ?? null,
      finalFen: game.finalFen ?? null,
      moveList: game.moveList ?? null,
      white: {
        name: game.white ?? "White player",
        title: game.whiteTitle ?? null,
        rating: Number.isFinite(game.whiteRating) && game.whiteRating > 0 ? game.whiteRating : undefined,
        flag: game.whiteFlag ?? game.whiteCountry ?? undefined,
      },
      black: {
        name: game.black ?? "Black player",
        title: game.blackTitle ?? null,
        rating: Number.isFinite(game.blackRating) && game.blackRating > 0 ? game.blackRating : undefined,
        flag: game.blackFlag ?? game.blackCountry ?? undefined,
      },
    }))
    .sort((a, b) => a.boardNumber - b.boardNumber);

  const activeRoundMeta = isLichessBroadcast ? broadcastRoundsMeta[activeRound - 1] : null;
  const activeRoundLabel = activeRoundMeta?.name?.trim() || tournamentConfig?.roundLabel || `Round ${activeRound}`;

  const roundMenuItems = (() => {
    const now = Date.now();
    const roundDateFormatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const roundTimeFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const formatRoundDateLabel = (startsAtMs: number | null) => {
      if (startsAtMs == null) return "-";
      const date = new Date(startsAtMs);
      return `${roundDateFormatter.format(date)} · ${roundTimeFormatter.format(date)}`;
    };
    const resolveRoundStatus = (round: number, startsAtMs: number | null) => {
      if (round === activeRound) {
        const hasLive = boardEntries.some(entry => entry.status === "live");
        const allFinished = boardEntries.length > 0 && boardEntries.every(entry => entry.status === "final");
        if (allFinished) return { statusLabel: "Finished", statusTone: "finished" as const };
        if (hasLive) return { statusLabel: "Live", statusTone: "live" as const };
        return { statusLabel: "Not started", statusTone: "notStarted" as const };
      }
      if (startsAtMs != null && startsAtMs > now) {
        return { statusLabel: "Not started", statusTone: "notStarted" as const };
      }
      if (round < activeRound) {
        return { statusLabel: "Finished", statusTone: "finished" as const };
      }
      return { statusLabel: "Not started", statusTone: "notStarted" as const };
    };
    return roundSelectionOptions.map(round => {
      const meta = isLichessBroadcast ? broadcastRoundsMeta[round - 1] : null;
      const startsAtMs = meta?.startsAtMs ?? null;
      const dateLabel = formatRoundDateLabel(startsAtMs);
      const { statusLabel, statusTone } = resolveRoundStatus(round, startsAtMs ?? null);
      return {
        value: round,
        label: `Round ${round}`,
        dateLabel,
        statusTone,
        statusLabel,
        roundId: meta?.id ?? null,
      };
    });
  })();

  const leaderboardRows = (() => {
    const roster = new Map<
      string,
      { name: string; rating?: number; title?: string | null; flag?: string }
    >();
    const pointsMap = new Map<string, number>();
    const recordPlayer = (player: BoardNavigationEntry["white"]) => {
      const name = player.name?.trim();
      if (!name) return;
      const normalized = name.toLowerCase();
      const existing = roster.get(normalized);
      if (!existing) {
        roster.set(normalized, {
          name,
          rating: player.rating,
          title: player.title ?? null,
          flag: player.flag,
        });
        return;
      }
      if (existing.rating == null && player.rating != null) {
        existing.rating = player.rating;
      }
      if (existing.title == null && player.title) {
        existing.title = player.title;
      }
      if (!existing.flag && player.flag) {
        existing.flag = player.flag;
      }
    };
    const recordPoints = (player: BoardNavigationEntry["white"], points: number) => {
      const name = player.name?.trim();
      if (!name) return;
      const normalized = name.toLowerCase();
      pointsMap.set(normalized, (pointsMap.get(normalized) ?? 0) + points);
    };
    boardEntries.forEach(entry => {
      recordPlayer(entry.white);
      recordPlayer(entry.black);
      const result = normalizeResultValue(entry.result);
      if (!result) return;
      if (result === "1-0") {
        recordPoints(entry.white, 1);
        recordPoints(entry.black, 0);
      } else if (result === "0-1") {
        recordPoints(entry.white, 0);
        recordPoints(entry.black, 1);
      } else if (result === "1/2-1/2") {
        recordPoints(entry.white, 0.5);
        recordPoints(entry.black, 0.5);
      }
    });
    return Array.from(roster.values())
      .map(player => {
        const normalized = player.name?.trim().toLowerCase() ?? "";
        const points = pointsMap.has(normalized) ? pointsMap.get(normalized) ?? null : null;
        return { ...player, points };
      })
      .sort((a, b) => {
        const pointsA = Number.isFinite(a.points ?? NaN) ? (a.points as number) : null;
        const pointsB = Number.isFinite(b.points ?? NaN) ? (b.points as number) : null;
        if (pointsA == null && pointsB != null) return 1;
        if (pointsA != null && pointsB == null) return -1;
        if (pointsA != null && pointsB != null && pointsA !== pointsB) return pointsB - pointsA;
        const ratingA = Number.isFinite(a.rating ?? NaN) ? (a.rating as number) : null;
        const ratingB = Number.isFinite(b.rating ?? NaN) ? (b.rating as number) : null;
        if (ratingA == null && ratingB != null) return 1;
        if (ratingA != null && ratingB == null) return -1;
        if (ratingA != null && ratingB != null && ratingA !== ratingB) return ratingB - ratingA;
        return a.name.localeCompare(b.name);
      });
  })();
  const hasLeaderboard = leaderboardRows.some(player => Number.isFinite(player.points ?? NaN));
  const resultsJsonLd = buildResultsJsonLd({
    tournamentName,
    slug: normalizedSlug,
    roundLabel: activeRoundLabel,
    round: activeRound,
    leaderboard: hasLeaderboard ? leaderboardRows : null,
  });

  return (
    <main className="min-h-screen bg-[#020817] text-slate-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(resultsJsonLd) }}
      />
      <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6">
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                Results
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{tournamentName}</h1>
              <p className="mt-2 text-sm text-slate-400">{activeRoundLabel}</p>
              <Link
                href={`/broadcast/${encodeURIComponent(normalizedSlug)}?round=${activeRound}`}
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white"
              >
                Back to boards
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <RoundTextDropdown
                items={roundMenuItems}
                activeRound={activeRound}
                tournamentSlug={normalizedSlug}
              />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Standings</h2>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Points
            </span>
          </div>
          {hasLeaderboard ? (
            <div className="mt-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-slate-900/40">
              {leaderboardRows.map((player, index) => (
                <div
                  key={`${player.name}-${index}`}
                  className="grid grid-cols-[28px_minmax(0,1fr)_52px_52px] items-center gap-2 px-3 py-2 text-sm text-slate-200"
                >
                  <span className="text-xs font-semibold text-slate-400">{index + 1}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    {player.flag ? (
                      <Flag country={player.flag} className="text-base leading-none" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
                    )}
                    {player.title ? <TitleBadge title={player.title} /> : null}
                    <span className="min-w-0 truncate">{player.name}</span>
                  </div>
                  <span className="text-right text-xs font-semibold text-slate-400">
                    {player.rating ?? "-"}
                  </span>
                  <span className="text-right text-sm font-semibold text-white">
                    {formatPoints(player.points)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-6 text-sm text-slate-400">
              Standings unavailable for this event yet.
            </div>
          )}
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Round results</h2>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {boardEntries.length} boards
            </span>
          </div>
          {boardEntries.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              {boardEntries.map(entry => {
                const resultLabel = formatBoardResultLabel(entry.result);
                const statusLabel = getBoardStatusLabel(entry);
                const centerLabel = resultLabel ?? statusLabel;
                return (
                  <div
                    key={entry.boardId}
                    className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">#{entry.boardNumber}</span>
                      {entry.white.flag ? (
                        <Flag country={entry.white.flag} className="text-base leading-none" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
                      )}
                      {entry.white.title ? <TitleBadge title={entry.white.title} /> : null}
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-100">
                        {entry.white.name}
                      </span>
                      <span className="ml-auto text-xs font-semibold text-slate-400">
                        {entry.white.rating ?? "-"}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {centerLabel}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500">
                        Board {entry.boardNumber}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 justify-end text-right">
                      <span className="text-xs font-semibold text-slate-400">
                        {entry.black.rating ?? "-"}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-100">
                        {entry.black.name}
                      </span>
                      {entry.black.title ? <TitleBadge title={entry.black.title} /> : null}
                      {entry.black.flag ? (
                        <Flag country={entry.black.flag} className="text-base leading-none" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-6 text-sm text-slate-400">
              Results unavailable for this round yet.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
