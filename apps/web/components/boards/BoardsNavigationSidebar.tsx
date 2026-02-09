"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Flag from "@/components/live/Flag";
import TitleBadge from "@/components/boards/TitleBadge";
import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";
import { parseBoardIdentifier } from "@/lib/boardId";
import { buildViewerBoardPath } from "@/lib/paths";
import { getBoardStatusLabel, normalizeResultValue } from "@/lib/boards/boardStatus";
import useTournamentLiveFeed from "@/lib/live/useTournamentLiveFeed";
import { getTournamentGameManifest } from "@/lib/tournamentManifest";

type BoardsNavigationSidebarProps = {
  boards: BoardNavigationEntry[];
  selectedBoardId?: string;
  tournamentSlug: string;
  mode?: "live" | "replay";
  debug?: boolean;
  debugRoundId?: string | null;
  activeRound: number;
  roundNotStarted?: boolean;
  liveUpdatesEnabled?: boolean;
  liveUpdatesIntervalMs?: number;
  viewMode?: "pairing" | "leaderboard";
  onViewModeChange?: (nextMode: "pairing" | "leaderboard") => void;
  searchQuery?: string;
  onSearchQueryChange?: (nextValue: string) => void;
  leaderboardPlayers?: Array<{
    name: string;
    rating?: number;
    points?: number | null;
    title?: string | null;
    flag?: string;
  }>;
};

type LeaderboardPlayer = NonNullable<BoardsNavigationSidebarProps["leaderboardPlayers"]>[number];

const normalizePlayerKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const normalizeLastNameKey = (name: string) => {
  const normalized = normalizePlayerKey(name);
  if (!normalized) return "";
  const parts = normalized.split(" ");
  return parts[parts.length - 1] ?? "";
};
const resolvePlayerMeta = (
  player: LeaderboardPlayer,
  metaMap: Map<string, { title?: string | null; flag?: string; name: string; rating?: number }>,
  metaLastNameMap: Map<string, Array<{ title?: string | null; flag?: string; name: string; rating?: number }>>
) => {
  const displayName = player.name?.trim() ?? "";
  const key = displayName ? normalizePlayerKey(displayName) : "";
  const fallback = key ? metaMap.get(key) : undefined;
  let resolved = fallback;
  if (!resolved && key) {
    const lastNameKey = normalizeLastNameKey(key);
    const candidates = lastNameKey ? metaLastNameMap.get(lastNameKey) ?? [] : [];
    if (candidates.length === 1) {
      resolved = candidates[0];
    } else if (candidates.length > 1) {
      const rating = Number.isFinite(player.rating ?? NaN) ? (player.rating as number) : null;
      if (rating != null) {
        resolved =
          candidates.find(candidate => candidate.rating === rating) ??
          candidates
            .slice()
            .sort((a, b) => {
              const ratingA = Number.isFinite(a.rating ?? NaN) ? (a.rating as number) : null;
              const ratingB = Number.isFinite(b.rating ?? NaN) ? (b.rating as number) : null;
              if (ratingA == null && ratingB != null) return 1;
              if (ratingA != null && ratingB == null) return -1;
              if (ratingA != null && ratingB != null) {
                return Math.abs(ratingA - rating) - Math.abs(ratingB - rating);
              }
              return 0;
            })[0];
      }
      resolved ??= candidates[0];
    }
  }
  return {
    displayName: resolved?.name ?? displayName,
    title: player.title ?? resolved?.title ?? null,
    flag: player.flag ?? resolved?.flag,
  };
};

const NAV_ROW_HEIGHT_PX = 52;
const NAV_ROW_GAP_PX = 6;
const NAV_LIST_PAD_PX = 16;
const LEADERBOARD_MAX_HEIGHT_PX = 248;

export default function BoardsNavigationSidebar({
  boards,
  selectedBoardId,
  tournamentSlug,
  debug = false,
  debugRoundId = null,
  activeRound,
  roundNotStarted = false,
  liveUpdatesEnabled = true,
  liveUpdatesIntervalMs,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  leaderboardPlayers = [],
}: BoardsNavigationSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [notStartedNotice, setNotStartedNotice] = useState<string | null>(null);
  const [internalViewMode, setInternalViewMode] = useState<"pairing" | "leaderboard">("leaderboard");
  const lastNotStartedRoundRef = useRef<number | null>(null);
  const [internalSearchValue, setInternalSearchValue] = useState("");
  const resolvedSearchValue = searchQuery ?? internalSearchValue;
  const handleSearchChange = onSearchQueryChange ?? setInternalSearchValue;
  const normalizedQuery = resolvedSearchValue.trim().toLowerCase();
  const resolvedViewMode = viewMode ?? internalViewMode;
  const handleViewModeChange = onViewModeChange ?? setInternalViewMode;

  const filteredBoards = useMemo(() => {
    if (!normalizedQuery) return boards;
    return boards.filter(board => {
      const whiteName = board.white?.name ?? "";
      const blackName = board.black?.name ?? "";
      return (
        whiteName.toLowerCase().includes(normalizedQuery) ||
        blackName.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [boards, normalizedQuery]);
  const showPairingView = resolvedViewMode === "pairing";
  const displayBoards = roundNotStarted || !showPairingView ? [] : filteredBoards;
  const hasLeaderboard = leaderboardPlayers.length > 0;
  const showNotStartedNotice = roundNotStarted && showPairingView;
  const formatPoints = (points?: number | null) => {
    if (!Number.isFinite(points ?? NaN)) return "—";
    return Number.isInteger(points) ? String(points) : (points as number).toFixed(1);
  };
  const metaMap = useMemo(() => {
    const map = new Map<string, { title?: string | null; flag?: string; name: string; rating?: number }>();
    const recordPlayer = (player: BoardNavigationEntry["white"]) => {
      const name = player.name?.trim();
      if (!name) return;
      const key = normalizePlayerKey(name);
      if (!key) return;
      const existing = map.get(key) ?? { name };
      const next = {
        name,
        rating: existing.rating ?? player.rating,
        title: existing.title ?? player.title ?? null,
        flag: existing.flag ?? player.flag,
      };
      map.set(key, next);
    };
    boards.forEach(entry => {
      recordPlayer(entry.white);
      recordPlayer(entry.black);
    });
    return map;
  }, [boards]);
  const metaLastNameMap = useMemo(() => {
    const map = new Map<
      string,
      Array<{ title?: string | null; flag?: string; name: string; rating?: number }>
    >();
    metaMap.forEach(meta => {
      const lastNameKey = normalizeLastNameKey(meta.name);
      if (!lastNameKey) return;
      const existing = map.get(lastNameKey) ?? [];
      existing.push(meta);
      map.set(lastNameKey, existing);
    });
    return map;
  }, [metaMap]);
  const resolvedLeaderboardRows = useMemo(
    () =>
      leaderboardPlayers.map(player => {
        const meta = resolvePlayerMeta(player, metaMap, metaLastNameMap);
        return { ...player, ...meta };
      }),
    [leaderboardPlayers, metaMap, metaLastNameMap]
  );
  const leaderboardMetaStats = useMemo(() => {
    const total = resolvedLeaderboardRows.length;
    const enriched = resolvedLeaderboardRows.filter(player => player.flag || player.title).length;
    return { total, enriched };
  }, [resolvedLeaderboardRows]);
  const filteredLeaderboardRows = useMemo(() => {
    if (!normalizedQuery) return resolvedLeaderboardRows;
    return resolvedLeaderboardRows.filter(player => {
      const displayName = player.displayName ?? "";
      const fallbackName = player.name ?? "";
      return (
        displayName.toLowerCase().includes(normalizedQuery) ||
        fallbackName.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [normalizedQuery, resolvedLeaderboardRows]);
  const emptyLabel = roundNotStarted
    ? "No boards available for this round yet."
    : "No players match this search yet.";
  const listMaxHeight = `${LEADERBOARD_MAX_HEIGHT_PX}px`;
  const linkQuery = useMemo(() => {
    if (!searchParams) return "";
    const query = new URLSearchParams(searchParams.toString());
    query.delete("tab");
    query.delete("round");
    query.delete("page");
    const queryString = query.toString();
    return queryString ? `?${queryString}` : "";
  }, [searchParams]);
  const liveFeedConfig = useMemo(() => {
    if (!tournamentSlug || displayBoards.length === 0) return null;
    const candidateId = displayBoards[0]?.boardId;
    if (!candidateId) return null;
    const parsed = parseBoardIdentifier(candidateId, tournamentSlug);
    return { tournamentSlug: parsed.tournamentSlug, round: parsed.round };
  }, [displayBoards, tournamentSlug]);
  const liveFeedVersion = useTournamentLiveFeed({
    tournamentSlug: liveFeedConfig?.tournamentSlug ?? null,
    round: liveFeedConfig?.round ?? null,
    enabled: liveUpdatesEnabled,
    intervalMs: liveUpdatesIntervalMs,
  });
  const resolvedPairingsBoards = useMemo(() => {
    if (!liveFeedConfig) return displayBoards;
    return displayBoards.map(entry => {
      const game = getTournamentGameManifest(
        liveFeedConfig.tournamentSlug,
        liveFeedConfig.round,
        entry.boardNumber
      );
      if (!game) return entry;
      return {
        ...entry,
        result: game.result ?? entry.result,
        status: game.status ?? entry.status,
        evaluation: game.evaluation ?? entry.evaluation ?? null,
        whiteTimeMs: game.whiteTimeMs ?? entry.whiteTimeMs ?? null,
        blackTimeMs: game.blackTimeMs ?? entry.blackTimeMs ?? null,
        sideToMove: game.sideToMove ?? entry.sideToMove ?? null,
        previewFen: game.previewFen ?? entry.previewFen ?? null,
        finalFen: game.finalFen ?? entry.finalFen ?? null,
        moveList: game.moveList ?? entry.moveList ?? null,
      };
    });
  }, [displayBoards, liveFeedConfig, liveFeedVersion]);
  const updateSelectedParam = useCallback(
    (boardId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("selected", boardId);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );
  const renderPlayerRow = (
    player: BoardNavigationEntry["white"],
    fallbackLabel: string,
    scorePrefix?: string | null
  ) => {
    const ratingValue = Number.isFinite(player?.rating ?? NaN) ? String(player.rating) : "—";
    const ratingTone = ratingValue === "—" ? "text-slate-500/80" : "text-slate-400";
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-slate-50">
        {player?.flag ? (
          <Flag country={player.flag} className="text-base leading-none" />
        ) : (
          <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
        )}
        {player?.title ? <TitleBadge title={player.title} /> : null}
        {scorePrefix ? (
          <span className="mr-0.5 text-[11px] font-semibold leading-none tabular-nums text-slate-200">
            {scorePrefix}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{player?.name || fallbackLabel}</span>
        <span className={`ml-auto text-[11px] font-semibold tabular-nums ${ratingTone}`}>
          {ratingValue}
        </span>
      </div>
    );
  };
  const pairingsPanel = (() => {
    if (resolvedPairingsBoards.length === 0) {
      return (
        <div className="flex items-center justify-center px-2 pb-3 text-sm text-slate-400">
          {emptyLabel}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        {resolvedPairingsBoards.map(board => {
          const statusLabel = getBoardStatusLabel(board);
          const normalizedResult = normalizeResultValue(board.result);
          const scorePrefixWhite =
            normalizedResult === "1-0"
              ? "1"
              : normalizedResult === "0-1"
                ? "0"
                : normalizedResult === "1/2-1/2"
                  ? "\u00bd"
                  : null;
          const scorePrefixBlack =
            normalizedResult === "1-0"
              ? "0"
              : normalizedResult === "0-1"
                ? "1"
                : normalizedResult === "1/2-1/2"
                  ? "\u00bd"
                  : null;
          const isFinished = board.status === "final" || Boolean(normalizedResult);
          const statusMode = isFinished ? "replay" : "live";
          const resolvedMode = statusMode;
          const baseHref = buildViewerBoardPath(board.boardId, resolvedMode);
          const href = `${baseHref}${linkQuery}`;
          const isSelected = selectedBoardId === board.boardId;
          const rowClass = isSelected
            ? "border-sky-400/70 bg-slate-800/90 text-slate-100"
            : "border-white/10 bg-slate-900/70 text-slate-200 hover:border-white/30 hover:bg-slate-900/90";
          return (
            <Link
              key={board.boardId}
              href={href}
              scroll={false}
              onClick={event => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                if (debug) {
                  const gameIndex = Math.max(0, board.boardNumber - 1);
                  console.log("BOARD_CLICK", {
                    boardId: board.boardId,
                    roundId: debugRoundId ?? null,
                    gameIndex,
                    route: href,
                  });
                }
                updateSelectedParam(board.boardId);
              }}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition h-[var(--nav-row-h)] ${rowClass}`}
            >
              <div className="flex h-7 items-center justify-center rounded-lg border border-white/10 bg-slate-950/70 px-2 text-[11px] font-semibold tabular-nums text-slate-200">
                #{board.boardNumber}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-col">
                  {renderPlayerRow(
                    board.white,
                    `Board #${board.boardNumber}`,
                    isFinished ? scorePrefixWhite : null
                  )}
                  {renderPlayerRow(board.black, "White / Black", isFinished ? scorePrefixBlack : null)}
                </div>
              </div>
              {!isFinished && statusLabel !== "\u2014" ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">
                  {statusLabel}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    );
  })();
  const sidebarPanel = showPairingView ? (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-1.5">
      {pairingsPanel}
    </div>
  ) : hasLeaderboard ? (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70">
      {debug ? (
        <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold text-slate-500">
          leaderboard meta: enriched {leaderboardMetaStats.enriched}/{leaderboardMetaStats.total}
        </div>
      ) : null}
      <div className="sticky top-0 z-10 grid grid-cols-[24px_minmax(0,1fr)_48px_40px] gap-1 border-b border-white/10 bg-slate-900/80 px-2 py-2 text-[10px] font-semibold text-slate-400 backdrop-blur">
        <span>#</span>
        <span>Player</span>
        <span className="text-right">Rating</span>
        <span className="text-right">Pts</span>
      </div>
      <div className="divide-y divide-white/10">
        {filteredLeaderboardRows.map((player, index) => (
          <div
            key={`${player.name}-${index}`}
            className="grid grid-cols-[24px_minmax(0,1fr)_48px_40px] gap-1 px-2 py-2 text-[11px] text-slate-200"
          >
            <span className="text-slate-400">{index + 1}</span>
            <div className="flex min-w-0 items-center gap-1.5">
              {player.flag ? (
                <Flag country={player.flag} className="text-base leading-none" />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-white/10 bg-slate-800" aria-hidden />
              )}
              {player.title ? <TitleBadge title={player.title} /> : null}
              <span className="min-w-0 flex-1 truncate">{player.displayName}</span>
            </div>
            <span className="text-right text-slate-400">{player.rating ?? "—"}</span>
            <span className="text-right text-slate-200">{formatPoints(player.points)}</span>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm text-slate-400">
      Leaderboard not available for this event.
    </div>
  );

  useEffect(() => {
    if (!roundNotStarted) {
      setNotStartedNotice(null);
      lastNotStartedRoundRef.current = null;
      return;
    }
    if (lastNotStartedRoundRef.current === activeRound) return;
    lastNotStartedRoundRef.current = activeRound;
    setNotStartedNotice(`Round ${activeRound} hasn't started yet.`);
  }, [activeRound, roundNotStarted]);

  return (
    <aside
      className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 shadow-sm"
      style={
        {
          "--nav-row-h": `${NAV_ROW_HEIGHT_PX}px`,
          "--nav-row-gap": `${NAV_ROW_GAP_PX}px`,
          "--nav-list-pad": `${NAV_LIST_PAD_PX}px`,
          "--nav-rows": "5",
        } as CSSProperties
      }
    >
      <div className="flex items-center gap-2 px-2 pb-2 pt-2">
        <div className="inline-flex items-center rounded-full border border-white/10 bg-slate-950/70 p-0.5 shadow-sm">
          {(["leaderboard", "pairing"] as const).map(option => {
            const isActive = resolvedViewMode === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleViewModeChange(option)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 ${
                  isActive
                    ? "border border-emerald-400/60 bg-emerald-400/15 text-white shadow-sm"
                    : "border border-transparent text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
                aria-pressed={isActive}
              >
                {option === "leaderboard" ? "Leaderboard" : "Pairings"}
              </button>
            );
          })}
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="search"
            value={resolvedSearchValue}
            onChange={event => {
              const nextValue = event.target.value;
              handleSearchChange(nextValue);
            }}
            placeholder="Search player..."
            aria-label="Search player"
            className="h-6 w-full rounded-full border border-white/25 bg-white/10 px-2.5 text-[11px] font-semibold text-slate-100 placeholder:text-slate-200 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pl-2 pr-3" style={{ maxHeight: listMaxHeight }}>
        {showNotStartedNotice ? (
          <div className="mx-2 mb-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] font-semibold text-amber-100">
            {notStartedNotice}
          </div>
        ) : null}
        {sidebarPanel}
      </div>
    </aside>
  );
}
