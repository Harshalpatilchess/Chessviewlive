import { Chess } from "chess.js";
import Image from "next/image";
import Link from "next/link";
import { Calendar, Users, Clock, MapPin } from "lucide-react";
import { BoardsFilterRow } from "@/components/boards/BoardsFilterRow";
import { BoardsNavigation } from "@/components/boards/BoardsNavigation";
import DebugSimulateMoveButton from "@/components/boards/DebugSimulateMoveButton";
import RoundTextDropdown from "@/components/boards/RoundTextDropdown";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { buildBoardIdentifier, normalizeTournamentSlug } from "@/lib/boardId";
import { BROADCASTS, getBroadcastTournament } from "@/lib/broadcasts/catalog";
import { pgnToPlies, pliesToFenAt } from "@/lib/chess/pgn";
import { getWorldCupPgnForBoard } from "@/lib/demoPgns";
import { getMiniEvalCp } from "@/lib/miniEval";
import { fetchLichessBroadcastRound, fetchLichessBroadcastTournament } from "@/lib/sources/lichessBroadcast";
import { probeLiveChessCloud } from "@/lib/sources/livechesscloud";
import { DEFAULT_ROUND, getTournamentConfig } from "@/lib/tournamentCatalog";
import {
  getTournamentRoundEntries,
  getTournamentRounds,
  type TournamentGame,
} from "@/lib/tournamentManifest";
import BroadcastHubSidebar from "./BroadcastHubSidebar";

type TournamentOverviewPageProps = {
  params: Promise<{ tournamentSlug: string }>;
  searchParams?: Record<string, string | string[] | undefined>;
};

const resolveParam = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const normalizeMode = (value?: string) => (value?.toLowerCase() === "replay" ? "replay" : "live");

const normalizeStatus = (value?: string): "live" | "all" | "finished" => {
  const candidate = value?.toLowerCase().trim() ?? "";
  if (candidate === "playing" || candidate === "live") return "live";
  if (candidate === "finished" || candidate === "results") return "finished";
  if (candidate === "all") return "all";
  return "all";
};

const parseRoundParam = (value?: string) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
};

const parsePerParam = (value?: string): 20 | 32 | 48 => {
  const parsed = Number(value);
  if (parsed === 20 || parsed === 32 || parsed === 48) return parsed;
  return 20;
};

const parsePageParam = (value?: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
};

const DEFAULT_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const buildPreviewFen = (game: TournamentGame | null, tournamentSlug: string, boardNumber: number) => {
  if (!game) return DEFAULT_START_FEN;
  if (game.finalFen) return game.finalFen;
  if (Array.isArray(game.moveList) && game.moveList.length > 0) {
    const chess = new Chess();
    for (const move of game.moveList) {
      try {
        chess.move(move, { sloppy: true });
      } catch {
        break;
      }
    }
    return chess.fen();
  }
  if (tournamentSlug === "worldcup2025") {
    const pgn = getWorldCupPgnForBoard(boardNumber);
    const plies = pgnToPlies(pgn);
    if (plies.length > 0) {
      return pliesToFenAt(plies, plies.length - 1);
    }
  }
  return DEFAULT_START_FEN;
};

const normalizeResultValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "*" || trimmed === "\u00b7") return "*";
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.includes("\u00bd")) return "1/2-1/2";
  if (compact === "1/2-1/2") return "1/2-1/2";
  return compact;
};

const isBoardFinished = (entry: BoardNavigationEntry) => {
  const normalized = normalizeResultValue(entry.result);
  return Boolean(normalized && normalized !== "*");
};
const resolveFilterStatus = (entry: BoardNavigationEntry) => {
  const normalizedResult = normalizeResultValue(entry.result);
  if (normalizedResult === "*") return "playing";
  if (normalizedResult) return "finished";
  if (entry.status === "final") return "finished";
  if (entry.status === "scheduled") return "scheduled";
  if (entry.status === "live") return "playing";
  return "playing";
};

const formatTournamentName = (slug: string) =>
  slug
    .split("-")
    .map(word => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ");

const normalizeBroadcastStatus = (
  value?: string | null,
  result?: TournamentGame["result"]
): TournamentGame["status"] => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalizedResult = normalizeResultValue(result);
  if (normalizedResult && normalizedResult !== "*") return "final";
  if (normalizedResult === "*") return "live";
  if (normalized === "scheduled" || normalized === "upcoming" || normalized === "pending") return "scheduled";
  if (normalized === "finished" || normalized === "final" || normalized === "completed") return "final";
  if (normalized) return "live";
  return "live";
};

const normalizeBroadcastResult = (value?: string | null): TournamentGame["result"] => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized === "*" || normalized === "\u00b7") return "*";
  if (normalized === "1-0" || normalized === "0-1" || normalized === "1/2-1/2" || normalized === "½-½") {
    return normalized;
  }
  if (normalized.toLowerCase() === "draw") return "1/2-1/2";
  return null;
};

const formatRelativeTime = (diffMs: number) => {
  const totalMinutes = Math.max(1, Math.ceil(diffMs / 60000));
  if (totalMinutes < 60) {
    return `in ${totalMinutes} min`;
  }
  const totalHours = Math.max(1, Math.ceil(totalMinutes / 60));
  if (totalHours < 24) {
    return `in ${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  }
  const totalDays = Math.max(1, Math.ceil(totalHours / 24));
  return `in ${totalDays} day${totalDays === 1 ? "" : "s"}`;
};

export default async function TournamentOverviewPage({
  params,
  searchParams,
}: TournamentOverviewPageProps) {
  const resolvedParams = await params;
  const rawSlug = resolvedParams?.tournamentSlug ?? "";
  const trimmedSlug = rawSlug.trim();
  const normalizedSlug = normalizeTournamentSlug(trimmedSlug);
  const roundParam = resolveParam(searchParams?.round);
  const roundIdParam = resolveParam(searchParams?.roundId);
  const modeParam = resolveParam(searchParams?.mode);
  const rawStatusParam = searchParams?.status;
  const statusParam = resolveParam(searchParams?.status);
  const searchParam = resolveParam(searchParams?.search);
  const perParam = resolveParam(searchParams?.per);
  const pageParam = resolveParam(searchParams?.page);
  const debugParam = resolveParam(searchParams?.debug);
  const selectedParam = resolveParam(searchParams?.selected);
  const broadcastEntry = getBroadcastTournament(normalizedSlug);
  const isBroadcast = Boolean(broadcastEntry);
  const activeMode = normalizeMode(modeParam);
  const rawStatusLabel = Array.isArray(rawStatusParam)
    ? rawStatusParam.join(",")
    : rawStatusParam ?? "none";
  const activePer = parsePerParam(perParam);
  const requestedPage = parsePageParam(pageParam);
  const isDebug = debugParam === "1";
  const selectedBoardId = typeof selectedParam === "string" ? selectedParam : undefined;
  const requestedRound = parseRoundParam(roundParam);

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
              Tournament hub
            </p>
            <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Tournament not found
            </h1>
            <p className="mt-3 max-w-xl text-sm text-slate-300">
              The tournament slug doesn’t match a local demo or a curated broadcast. Browse the
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
  const tournamentName = tournamentConfig?.name ?? broadcastEntry?.title ?? formatTournamentName(normalizedSlug);
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
  const availableRounds = isBroadcast
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
  const activeRound =
    requestedRound && (roundSelectionOptions.length === 0 || roundSelectionOptions.includes(requestedRound))
      ? requestedRound
      : fallbackRound;
  const heroImage = tournamentConfig?.heroImage ?? null;
  const placeholderFlag = tournamentConfig?.placeholderFlag ?? "\uD83C\uDFC6";
  const startsAt = tournamentConfig?.startsAt ? new Date(tournamentConfig.startsAt) : null;
  const endsAt = tournamentConfig?.endsAt ? new Date(tournamentConfig.endsAt) : null;
  const dateRangeLabel = (() => {
    if (!startsAt || !Number.isFinite(startsAt.getTime())) return "—";
    const formatDay = new Intl.DateTimeFormat("en-US", { day: "numeric" });
    const formatMonth = new Intl.DateTimeFormat("en-US", { month: "short" });
    const startLabel = `${formatDay.format(startsAt)} ${formatMonth.format(startsAt)}`;
    if (!endsAt || !Number.isFinite(endsAt.getTime())) return startLabel;
    const endDay = formatDay.format(endsAt);
    const endMonth = formatMonth.format(endsAt);
    const endLabel = `${endDay} ${endMonth}`;
    return `${startLabel} to ${endLabel}`;
  })();
  const participantsLabel = Number.isFinite(tournamentConfig?.participants ?? NaN)
    ? `${tournamentConfig?.participants} players`
    : "—";
  const timeControlLabel = (() => {
    const raw = tournamentConfig?.timeControl?.trim();
    if (!raw) return "—";
    const match = raw.match(/^(\d+)\s*\+\s*(\d+)$/);
    if (!match) return raw;
    const base = Number(match[1]);
    const increment = Number(match[2]);
    if (!Number.isFinite(base) || !Number.isFinite(increment)) return raw;
    const baseMinutes = base >= 300 ? Math.round(base / 60) : base;
    const minutesLabel = `${baseMinutes} min`;
    const secondsLabel = `${increment} sec`;
    return `${minutesLabel} + ${secondsLabel}`;
  })();
  const locationLabel = tournamentConfig?.location?.trim() || "—";
  const tournamentInfoStrip = (
    <div className="mt-3 grid grid-cols-2 gap-2.5">
      {[
        { Icon: Calendar, value: dateRangeLabel },
        { Icon: Users, value: participantsLabel },
        { Icon: Clock, value: timeControlLabel },
        { Icon: MapPin, value: locationLabel },
      ].map(({ Icon, value }) => (
        <div
          key={`${Icon.displayName ?? Icon.name}-${value}`}
          className="flex min-w-0 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] font-semibold text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-sm"
        >
          <Icon className="h-3 w-3 text-slate-300" aria-hidden />
          <span className="min-w-0 leading-snug text-slate-100">{value}</span>
        </div>
      ))}
    </div>
  );

  const broadcastFetchLimit = Math.max(activePer * Math.max(requestedPage, 1), 64);
  const lccPayload =
    isLccBroadcast && broadcastEntry?.tournamentId
      ? await probeLiveChessCloud({
          tournamentId: broadcastEntry.tournamentId,
          round: activeRound,
          limit: broadcastFetchLimit,
          debug: isDebug,
        }).catch(() => null)
      : null;
  const lichessRoundId =
    broadcastRoundIdOverride ||
    broadcastRoundsMeta[activeRound - 1]?.id ||
    broadcastTournamentMeta?.snapshot.activeRoundId ||
    null;
  const debugRoundId = isLichessBroadcast ? lichessRoundId : null;
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
  const roundEntries = isBroadcast
    ? broadcastBoards.map(board => {
        const boardNo = board.boardNo;
        const boardId = buildBoardIdentifier(normalizedSlug, activeRound, boardNo);
        const whiteName = board.whiteName?.trim() || "?";
        const blackName = board.blackName?.trim() || "?";
        const normalizedResult = normalizeBroadcastResult(board.result);
        const whiteRating = Number.isFinite(board.whiteElo ?? NaN) ? (board.whiteElo as number) : 0;
        const blackRating = Number.isFinite(board.blackElo ?? NaN) ? (board.blackElo as number) : 0;
        const whiteTitle = board.whiteTitle?.trim() || null;
        const blackTitle = board.blackTitle?.trim() || null;
        const whiteCountry = board.whiteCountry?.trim() || "";
        const blackCountry = board.blackCountry?.trim() || "";
        return {
          board: boardNo,
          game: {
            tournamentSlug: normalizedSlug,
            boardId,
            round: activeRound,
            board: boardNo,
            white: whiteName,
            whiteTitle,
            whiteRating,
            whiteCountry,
            whiteFlag: whiteCountry,
            black: blackName,
            blackTitle,
            blackRating,
            blackCountry,
            blackFlag: blackCountry,
            result: normalizedResult,
            status: normalizeBroadcastStatus(board.status, normalizedResult),
            moveList: board.moveList ?? null,
          },
        };
      })
    : getTournamentRoundEntries(normalizedSlug, activeRound);
  const allBoardEntries: BoardNavigationEntry[] = roundEntries.map(({ board, game }) => {
    const whiteRating =
      Number.isFinite(game.whiteRating) && game.whiteRating > 0 ? game.whiteRating : undefined;
    const blackRating =
      Number.isFinite(game.blackRating) && game.blackRating > 0 ? game.blackRating : undefined;
    const previewFen = buildPreviewFen(game, normalizedSlug, board);
    const miniEvalCp = getMiniEvalCp(previewFen);
    const boardId = game.boardId ?? buildBoardIdentifier(normalizedSlug, activeRound, board);

    return {
      boardId,
      boardNumber: board,
      result: game.result ?? null,
      status: game.status ?? "scheduled",
      evaluation: game.evaluation ?? null,
      miniEvalCp,
      whiteTimeMs: game.whiteTimeMs ?? null,
      blackTimeMs: game.blackTimeMs ?? null,
      clockUpdatedAtMs: game.clockUpdatedAtMs ?? null,
      sideToMove: game.sideToMove ?? null,
      finalFen: game.finalFen ?? null,
      previewFen,
      moveList: game.moveList ?? null,
      white: {
        name: game.white ?? "White player",
        title: game.whiteTitle ?? null,
        rating: whiteRating,
        flag: game.whiteFlag ?? game.whiteCountry ?? undefined,
      },
      black: {
        name: game.black ?? "Black player",
        title: game.blackTitle ?? null,
        rating: blackRating,
        flag: game.blackFlag ?? game.blackCountry ?? undefined,
      },
    };
  });
  const boardEntries = allBoardEntries;
  const roundHasBoards = allBoardEntries.length > 0;
  const roundHasStarted = allBoardEntries.some(entry => {
    const normalizedResult = normalizeResultValue(entry.result);
    const hasResult = Boolean(normalizedResult && normalizedResult !== "*");
    const moveCount = Array.isArray(entry.moveList) ? entry.moveList.length : 0;
    const hasClock =
      Number.isFinite(Number(entry.whiteTimeMs ?? NaN)) ||
      Number.isFinite(Number(entry.blackTimeMs ?? NaN));
    return (
      entry.status === "live" ||
      entry.status === "final" ||
      hasResult ||
      moveCount > 0 ||
      hasClock ||
      Boolean(entry.sideToMove)
    );
  });
  const roundNotStarted = !roundHasBoards || !roundHasStarted;
  const roundIsComplete =
    roundHasBoards && boardEntries.every(entry => resolveFilterStatus(entry) === "finished");
  const roundEmptyLabel = roundNotStarted
    ? "No boards available for this round yet."
    : "No boards match this filter yet.";
  const resolveRoundStatus = (round: number, startsAtMs: number | null, now: number) => {
    if (round === activeRound) {
      if (roundIsComplete) {
        return { statusLabel: "Finished", statusTone: "finished" as const };
      }
      if (roundNotStarted || (startsAtMs != null && startsAtMs > now)) {
        return { statusLabel: "Not started", statusTone: "notStarted" as const };
      }
      return { statusLabel: "Live", statusTone: "live" as const };
    }
    if (startsAtMs != null && startsAtMs > now) {
      return { statusLabel: "Not started", statusTone: "notStarted" as const };
    }
    if (round < activeRound) {
      return { statusLabel: "Finished", statusTone: "finished" as const };
    }
    return { statusLabel: "Not started", statusTone: "notStarted" as const };
  };
  const roundMenuItems = (() => {
    const now = Date.now();
    return roundSelectionOptions.map(round => {
      const meta = isLichessBroadcast ? broadcastRoundsMeta[round - 1] : null;
      const startsAtMs = meta?.startsAtMs ?? null;
      const dateLabel = startsAtMs
        ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(startsAtMs)
          )
        : "—";
      const { statusLabel, statusTone } = resolveRoundStatus(round, startsAtMs ?? null, now);
      return {
        value: round,
        label: `Round ${round}`,
        dateLabel,
        statusTone,
        statusLabel,
      };
    });
  })();
  const playerRoster = (() => {
    const roster = new Map<
      string,
      { name: string; rating?: number; title?: string | null; flag?: string }
    >();
    const recordPlayer = (player: BoardNavigationEntry["white"]) => {
      const name = player.name?.trim();
      if (!name) return;
      const normalized = name.toLowerCase();
      if (!isBroadcast && (normalized === "white player" || normalized === "black player")) return;
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

    allBoardEntries.forEach(entry => {
      recordPlayer(entry.white);
      recordPlayer(entry.black);
    });

    return Array.from(roster.values()).sort((a, b) => {
      const ratingA = Number.isFinite(a.rating) ? a.rating : 0;
      const ratingB = Number.isFinite(b.rating) ? b.rating : 0;
      if (ratingA !== ratingB) return ratingB - ratingA;
      return a.name.localeCompare(b.name);
    });
  })();
  const playerRows = playerRoster.length > 0 ? playerRoster : tournamentConfig?.topPlayers ?? playerRoster;
  const leaderboardRows = (() => {
    const rosterLookup = new Map(
      playerRoster.map(player => [player.name.toLowerCase(), player])
    );
    const pointsMap = new Map<string, number>();
    const recordPoints = (player: BoardNavigationEntry["white"], points: number) => {
      const name = player.name?.trim();
      if (!name) return;
      const normalized = name.toLowerCase();
      if (!isBroadcast && (normalized === "white player" || normalized === "black player")) return;
      pointsMap.set(normalized, (pointsMap.get(normalized) ?? 0) + points);
    };

    allBoardEntries.forEach(entry => {
      const result = normalizeResultValue(entry.result);
      if (!result || result === "*") return;
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

    return playerRows
      .map((player, index) => {
        const normalized = player.name?.trim().toLowerCase() ?? "";
        const rosterEntry = rosterLookup.get(normalized);
        const points = pointsMap.has(normalized) ? pointsMap.get(normalized) ?? null : null;
        const title = "title" in player ? player.title : undefined;
        const flag = "flag" in player ? player.flag : undefined;
        return {
          name: player.name,
          rating: player.rating ?? rosterEntry?.rating,
          title: title ?? rosterEntry?.title ?? null,
          flag: flag ?? rosterEntry?.flag,
          points,
          __index: index,
        };
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
        return a.__index - b.__index;
      })
      .map(({ __index, ...player }) => player);
  })();
  const rawBoardsCount = boardEntries.length;
  const finishedBoardsCount = boardEntries.filter(entry => resolveFilterStatus(entry) === "finished").length;
  const playingBoardsCount = boardEntries.filter(entry => resolveFilterStatus(entry) === "playing").length;
  const unknownBoardsCount = boardEntries.filter(
    entry => !entry.status || entry.status === "unknown"
  ).length;
  const statusCountsLabel = `playing:${playingBoardsCount} finished:${finishedBoardsCount} results:${finishedBoardsCount} unknown:${unknownBoardsCount}`;
  const hasStatusParam = typeof statusParam === "string" && statusParam.trim().length > 0;
  const parsedStatusParam = hasStatusParam ? normalizeStatus(statusParam) : null;
  const fallbackStatus = "all";
  const activeStatus = parsedStatusParam ?? fallbackStatus;
  const gridSearchQuery = typeof searchParam === "string" ? searchParam.trim() : "";
  const normalizedGridSearchQuery = gridSearchQuery.toLowerCase();
  const boardLinkMode = activeMode === "replay" ? "replay" : undefined;
  const filteredBoards = (() => {
    if (boardEntries.length === 0) return [];
    const filtered = boardEntries.filter(entry => {
      const filterStatus = resolveFilterStatus(entry);
      if (activeStatus === "live") return filterStatus === "playing";
      if (activeStatus === "finished") return filterStatus === "finished";
      return filterStatus !== "scheduled";
    });

    return filtered.slice().sort((a, b) => a.boardNumber - b.boardNumber);
  })();
  const displayBoards = roundNotStarted ? [] : filteredBoards;
  const gridBoards =
    normalizedGridSearchQuery.length > 0
      ? displayBoards.filter(board => {
          const whiteName = board.white?.name ?? "";
          const blackName = board.black?.name ?? "";
          return (
            whiteName.toLowerCase().includes(normalizedGridSearchQuery) ||
            blackName.toLowerCase().includes(normalizedGridSearchQuery)
          );
        })
      : displayBoards;
  const filteredCount = gridBoards.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / activePer));
  const activePage = Math.min(Math.max(requestedPage, 1), pageCount);
  const startIndex = (activePage - 1) * activePer;
  const paginatedBoards = gridBoards.slice(startIndex, startIndex + activePer);
  const pagedCount = paginatedBoards.length;
  const totalGamesThisRound = rawBoardsCount;
  const liveGamesThisRound = playingBoardsCount;
  const displayedGamesCount = pagedCount;

  return (
    <main className="min-h-screen bg-[#020817] text-slate-100">
      <div
        className="mx-auto w-full px-4 pb-6 pt-3 lg:px-8 max-w-[1440px] 2xl:max-w-[1776px]"
      >
        <section
          className="rounded-3xl border border-white/10 bg-slate-950/60 p-3 shadow-sm mt-2"
        >
          <div className="grid gap-2">
              <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(320px,1fr)_3fr] lg:gap-1">
                <div className="flex min-h-0 flex-col lg:self-stretch">
                  <BroadcastHubSidebar
                    boards={displayBoards}
                    selectedBoardId={selectedBoardId}
                    tournamentSlug={normalizedSlug}
                    mode={boardLinkMode}
                    debug={isDebug}
                    debugRoundId={debugRoundId}
                    activeRound={activeRound}
                    roundNotStarted={roundNotStarted}
                    leaderboardPlayers={leaderboardRows}
                  />
                </div>
                <section className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-xl ring-1 ring-white/5">
                  <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-semibold text-white sm:text-3xl">
                          {tournamentName}
                        </h1>
                        {isDebug ? (
                          <span className="rounded-full border border-rose-400/70 bg-rose-500/15 px-3 py-1 text-[11px] font-semibold text-rose-100">
                            Debug: Boards Tab Wired
                          </span>
                        ) : null}
                      </div>
                      {tournamentInfoStrip}
                  <div className="mt-2 flex justify-center">
                    <RoundTextDropdown items={roundMenuItems} activeRound={activeRound} />
                  </div>
                </div>
                    <div className="relative min-h-[180px] bg-slate-950/60 p-3 sm:min-h-[220px] sm:p-4 lg:min-h-[240px] lg:p-5">
                      {heroImage ? (
                        <Image
                          src={heroImage}
                          alt={`${tournamentName} banner`}
                          fill
                          sizes="(min-width: 1280px) 40vw, (min-width: 768px) 45vw, 100vw"
                          className="object-contain"
                          priority
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black">
                          <span className="text-5xl drop-shadow-[0_12px_24px_rgba(2,6,23,0.5)]">
                            {placeholderFlag}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {isDebug ? (
                    <div className="px-5 pb-0 pt-3 sm:px-6">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2 text-xs font-semibold text-slate-400">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            rawStatusParam {rawStatusLabel} | resolvedSelectedStatus {activeStatus} | Raw{" "}
                            {rawBoardsCount} | Filtered {filteredCount} | Page {activePage}/{pageCount} |{" "}
                            statusCounts {statusCountsLabel} | totalGamesThisRound {totalGamesThisRound} |{" "}
                            liveGamesThisRound {liveGamesThisRound} | displayedGamesCount {displayedGamesCount}
                          </span>
                          {normalizedSlug === "worldcup2025" && paginatedBoards[0]?.boardId ? (
                            <DebugSimulateMoveButton
                              boardId={paginatedBoards[0].boardId}
                              tournamentSlug={normalizedSlug}
                              previewFen={paginatedBoards[0].previewFen ?? null}
                            />
                          ) : null}
                      </div>
                    </div>
                  </div>
                  ) : null}
                  <div className="mt-2 hidden lg:block px-5 pt-2 pb-2 sm:px-6">
                    <BoardsFilterRow
                      totalCount={filteredCount}
                      rawCount={rawBoardsCount}
                      playingCount={playingBoardsCount}
                      page={activePage}
                      status={activeStatus}
                      pageCount={pageCount}
                    />
                  </div>
                </section>
              </div>
              <div className="relative z-10 overflow-visible border-t border-white/10 pt-6">
                <BoardsNavigation
                  boards={paginatedBoards}
                  sidebarBoards={paginatedBoards}
                  gridColsClassName="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  tournamentSlug={normalizedSlug}
                  mode={boardLinkMode}
                  layout="grid"
                  selectedBoardId={selectedBoardId}
                  variant="tournament"
                  debug={isDebug}
                  debugRoundId={debugRoundId}
                  emptyLabel={roundEmptyLabel}
                />
              </div>
            </div>
        </section>
      </div>
    </main>
  );
}
