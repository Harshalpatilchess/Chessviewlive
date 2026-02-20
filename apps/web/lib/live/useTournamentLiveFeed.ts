"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyTournamentLiveUpdates,
  type TournamentGameLiveUpdate,
} from "@/lib/tournamentManifest";
import type { DgtBoardState, DgtLivePayload } from "@/lib/live/dgtPayload";
import { getBroadcastTournament } from "@/lib/broadcasts/catalog";
import {
  isPlaceholderPlayerName,
  normalizeBoardPlayers,
} from "@/lib/live/playerNormalization";

type UseTournamentLiveFeedParams = {
  tournamentSlug?: string | null;
  round?: number | null;
  intervalMs?: number;
  enabled?: boolean;
};

type UseTournamentLiveFeedResult = {
  version: number;
  hasFetchedOnce: boolean;
};

type RoundLike = {
  boards?: DgtBoardState[];
  games?: DgtBoardState[];
  pairings?: DgtBoardState[];
};

type LivePayloadWithRoundObject = Omit<DgtLivePayload, "round"> & {
  round?: number | RoundLike;
  games?: DgtBoardState[];
  pairings?: DgtBoardState[];
  roundData?: RoundLike;
};

const getSafeRound = (value?: number | null) => {
  if (!Number.isFinite(Number(value ?? NaN))) return 1;
  return Math.max(1, Math.floor(Number(value)));
};

const TATA_STEEL_SLUGS = new Set(["tata-steel-2026", "tata-steel-masters-2026"]);
const PLACEHOLDER_PLAYER_METADATA = new Set([
  "-",
  "--",
  "?",
  "??",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeMetadataToken = (value: unknown): string | null => {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return null;
  return PLACEHOLDER_PLAYER_METADATA.has(trimmed.toLowerCase()) ? null : trimmed;
};

const toPositiveInt = (value: unknown): number | null => {
  const numeric = Number(value ?? NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
};

const getIgnoreCase = (record: Record<string, unknown>, key: string): unknown => {
  if (key in record) return record[key];
  const lowered = key.toLowerCase();
  const matched = Object.keys(record).find(candidate => candidate.toLowerCase() === lowered);
  return matched ? record[matched] : undefined;
};

const normalizeFederationCode = (value: unknown): string | null => {
  const raw = normalizeMetadataToken(value);
  return raw ? raw.toUpperCase() : null;
};

const normalizeFlagValue = (value: unknown): string | null => {
  const raw = normalizeMetadataToken(value);
  if (!raw) return null;
  return /^[A-Za-z]{2,3}$/.test(raw) ? raw.toUpperCase() : raw;
};

const normalizeResolvedPlayerName = (value: unknown): string | null => {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return null;
  if (isPlaceholderPlayerName(trimmed) || trimmed.toLowerCase() === "unknown") {
    return null;
  }
  return trimmed;
};

const isTataSteelTournament = (slug: string) => {
  const normalized = slug.trim().toLowerCase();
  return TATA_STEEL_SLUGS.has(normalized) || normalized.includes("tata-steel");
};

const mapOfficialGamesToUpdates = (
  payload: unknown,
  slug: string,
  round: number
): TournamentGameLiveUpdate[] => {
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.games)) {
    return [];
  }
  return payload.games
    .map((game, index): TournamentGameLiveUpdate | null => {
      if (!isRecord(game)) return null;
      const whiteName = normalizeResolvedPlayerName(getIgnoreCase(game, "whiteName"));
      const blackName = normalizeResolvedPlayerName(getIgnoreCase(game, "blackName"));
      const whiteTitle = toTrimmedString(getIgnoreCase(game, "whiteTitle"));
      const blackTitle = toTrimmedString(getIgnoreCase(game, "blackTitle"));
      const whiteRating = toPositiveInt(getIgnoreCase(game, "whiteRating"));
      const blackRating = toPositiveInt(getIgnoreCase(game, "blackRating"));
      const whiteFederation =
        normalizeFederationCode(getIgnoreCase(game, "whiteFederation")) ??
        normalizeFederationCode(getIgnoreCase(game, "whiteCountry"));
      const blackFederation =
        normalizeFederationCode(getIgnoreCase(game, "blackFederation")) ??
        normalizeFederationCode(getIgnoreCase(game, "blackCountry"));
      const whiteFlag = normalizeFlagValue(getIgnoreCase(game, "whiteFlag")) ?? whiteFederation;
      const blackFlag = normalizeFlagValue(getIgnoreCase(game, "blackFlag")) ?? blackFederation;

      return {
        tournamentSlug: slug,
        round,
        board: index + 1,
        ...(whiteName ? { white: whiteName } : {}),
        ...(blackName ? { black: blackName } : {}),
        ...(whiteTitle ? { whiteTitle } : {}),
        ...(blackTitle ? { blackTitle } : {}),
        ...(whiteRating != null ? { whiteRating } : {}),
        ...(blackRating != null ? { blackRating } : {}),
        ...(whiteFederation ? { whiteCountry: whiteFederation } : {}),
        ...(blackFederation ? { blackCountry: blackFederation } : {}),
        ...(whiteFlag ? { whiteFlag } : {}),
        ...(blackFlag ? { blackFlag } : {}),
      } satisfies TournamentGameLiveUpdate;
    })
    .filter((update): update is TournamentGameLiveUpdate => Boolean(update));
};

const mergeLiveUpdates = (
  primaryUpdates: TournamentGameLiveUpdate[],
  officialUpdates: TournamentGameLiveUpdate[]
): TournamentGameLiveUpdate[] => {
  const keyFor = (update: TournamentGameLiveUpdate) =>
    `${update.tournamentSlug.trim().toLowerCase()}:${Math.floor(update.round)}:${Math.floor(update.board)}`;
  const merged = new Map<string, TournamentGameLiveUpdate>();

  primaryUpdates.forEach(update => {
    merged.set(keyFor(update), update);
  });

  officialUpdates.forEach(update => {
    const key = keyFor(update);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, update);
      return;
    }

    const resolvedWhite =
      normalizeResolvedPlayerName(existing.white) ?? normalizeResolvedPlayerName(update.white);
    const resolvedBlack =
      normalizeResolvedPlayerName(existing.black) ?? normalizeResolvedPlayerName(update.black);
    const resolvedWhiteTitle = toTrimmedString(existing.whiteTitle) ?? toTrimmedString(update.whiteTitle);
    const resolvedBlackTitle = toTrimmedString(existing.blackTitle) ?? toTrimmedString(update.blackTitle);
    const resolvedWhiteRating = toPositiveInt(existing.whiteRating) ?? toPositiveInt(update.whiteRating);
    const resolvedBlackRating = toPositiveInt(existing.blackRating) ?? toPositiveInt(update.blackRating);
    const resolvedWhiteCountry = toTrimmedString(existing.whiteCountry) ?? toTrimmedString(update.whiteCountry);
    const resolvedBlackCountry = toTrimmedString(existing.blackCountry) ?? toTrimmedString(update.blackCountry);
    const resolvedWhiteFlag = toTrimmedString(existing.whiteFlag) ?? toTrimmedString(update.whiteFlag);
    const resolvedBlackFlag = toTrimmedString(existing.blackFlag) ?? toTrimmedString(update.blackFlag);

    merged.set(key, {
      ...existing,
      ...(resolvedWhite ? { white: resolvedWhite } : {}),
      ...(resolvedBlack ? { black: resolvedBlack } : {}),
      ...(resolvedWhiteTitle ? { whiteTitle: resolvedWhiteTitle } : {}),
      ...(resolvedBlackTitle ? { blackTitle: resolvedBlackTitle } : {}),
      ...(resolvedWhiteRating != null ? { whiteRating: resolvedWhiteRating } : {}),
      ...(resolvedBlackRating != null ? { blackRating: resolvedBlackRating } : {}),
      ...(resolvedWhiteCountry ? { whiteCountry: resolvedWhiteCountry } : {}),
      ...(resolvedBlackCountry ? { blackCountry: resolvedBlackCountry } : {}),
      ...(resolvedWhiteFlag ? { whiteFlag: resolvedWhiteFlag } : {}),
      ...(resolvedBlackFlag ? { blackFlag: resolvedBlackFlag } : {}),
    });
  });

  return Array.from(merged.values());
};

const fetchOfficialMetadataUpdates = async (slug: string, round: number): Promise<TournamentGameLiveUpdate[]> => {
  if (!isTataSteelTournament(slug)) return [];
  try {
    const query = new URLSearchParams({
      slug,
      round: String(round),
    });
    const response = await fetch(`/api/tournament/official?${query.toString()}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response || !response.ok) return [];
    const payload = (await response.json().catch(() => null)) as unknown;
    return mapOfficialGamesToUpdates(payload, slug, round);
  } catch {
    return [];
  }
};

const buildMockUpdates = (
  payload?: DgtLivePayload | null
): TournamentGameLiveUpdate[] => {
  if (!payload) return [];
  const slug = payload.tournamentSlug?.trim();
  if (!slug) return [];
  const data = payload as LivePayloadWithRoundObject;
  const roundObject: RoundLike | null = data.round && typeof data.round === "object" ? data.round : null;
  const boards = data.boards ?? data.games ?? [];
  const normalizedBoards = Array.isArray(boards) ? boards : [];
  const roundObjectBoards = Array.isArray(roundObject?.boards)
    ? roundObject.boards
    : Array.isArray(roundObject?.games)
      ? roundObject.games
      : Array.isArray(roundObject?.pairings)
        ? roundObject.pairings
        : [];
  const nestedRoundDataBoards = Array.isArray(data.roundData?.boards)
    ? data.roundData?.boards
    : Array.isArray(data.roundData?.games)
      ? data.roundData?.games
      : Array.isArray(data.roundData?.pairings)
        ? data.roundData?.pairings
        : [];
  const boardsForUpdates =
    normalizedBoards.length > 0
      ? normalizedBoards
      : roundObjectBoards.length > 0
        ? roundObjectBoards
        : nestedRoundDataBoards;
  const roundNumber = typeof data.round === "number" && Number.isFinite(data.round) ? data.round : payload.round;
  return boardsForUpdates
    .filter(board => typeof board.board === "number")
    .map(board => {
      const normalizedPlayers = normalizeBoardPlayers({
        white: board.white,
        black: board.black,
        whiteName: board.whiteName ?? null,
        blackName: board.blackName ?? null,
        whiteRating: board.whiteElo ?? null,
        blackRating: board.blackElo ?? null,
        pgn: board.pgn ?? null,
        allowManifestFallback: false,
      });
      const whiteName = normalizedPlayers.white.name;
      const blackName = normalizedPlayers.black.name;
      const safeWhiteName =
        whiteName && !isPlaceholderPlayerName(whiteName) && whiteName.toLowerCase() !== "unknown"
          ? whiteName
          : null;
      const safeBlackName =
        blackName && !isPlaceholderPlayerName(blackName) && blackName.toLowerCase() !== "unknown"
          ? blackName
          : null;
      const whiteTitle =
        typeof normalizedPlayers.white.title === "string" && normalizedPlayers.white.title.trim().length > 0
          ? normalizedPlayers.white.title.trim()
          : null;
      const blackTitle =
        typeof normalizedPlayers.black.title === "string" && normalizedPlayers.black.title.trim().length > 0
          ? normalizedPlayers.black.title.trim()
          : null;
      const whiteRating =
        Number.isFinite(Number(normalizedPlayers.white.rating ?? NaN)) && Number(normalizedPlayers.white.rating) > 0
          ? Math.trunc(Number(normalizedPlayers.white.rating))
          : null;
      const blackRating =
        Number.isFinite(Number(normalizedPlayers.black.rating ?? NaN)) && Number(normalizedPlayers.black.rating) > 0
          ? Math.trunc(Number(normalizedPlayers.black.rating))
          : null;
      const whiteCountry =
        (typeof normalizedPlayers.white.country === "string" && normalizedPlayers.white.country.trim()) ||
        (typeof normalizedPlayers.white.federation === "string" && normalizedPlayers.white.federation.trim()) ||
        null;
      const blackCountry =
        (typeof normalizedPlayers.black.country === "string" && normalizedPlayers.black.country.trim()) ||
        (typeof normalizedPlayers.black.federation === "string" && normalizedPlayers.black.federation.trim()) ||
        null;
      const whiteFlag =
        typeof normalizedPlayers.white.flag === "string" && normalizedPlayers.white.flag.trim().length > 0
          ? normalizedPlayers.white.flag.trim()
          : null;
      const blackFlag =
        typeof normalizedPlayers.black.flag === "string" && normalizedPlayers.black.flag.trim().length > 0
          ? normalizedPlayers.black.flag.trim()
          : null;
      return {
        tournamentSlug: slug,
        round: roundNumber,
        board: board.board,
        white: safeWhiteName,
        black: safeBlackName,
        whiteTitle,
        blackTitle,
        whiteRating,
        blackRating,
        whiteCountry,
        blackCountry,
        whiteFlag,
        blackFlag,
        whiteNameSource: normalizedPlayers.white.nameSource ?? null,
        blackNameSource: normalizedPlayers.black.nameSource ?? null,
        whiteMissingReason: normalizedPlayers.white.missingReason ?? null,
        blackMissingReason: normalizedPlayers.black.missingReason ?? null,
        status: board.status === "finished" ? "final" : board.status ?? "live",
        result: board.result ?? null,
        whiteTimeMs: board.whiteTimeMs ?? null,
        blackTimeMs: board.blackTimeMs ?? null,
        clockUpdatedAtMs: board.clockUpdatedAtMs ?? null,
        sideToMove: board.sideToMove ?? null,
        previewFen: board.fen ?? board.finalFen ?? null,
        finalFen: board.finalFen ?? null,
        moveList: board.moveList ?? board.moves ?? null,
      } satisfies TournamentGameLiveUpdate;
    });
};

const resolveLiveEndpoint = (slug: string) => {
  if (slug.trim().toLowerCase() === "worldcup2025") {
    return "/api/tournament/live";
  }
  const broadcast = getBroadcastTournament(slug);
  if (broadcast?.sourceType === "livechesscloud") {
    return "/api/tournament/lcc";
  }
  if (broadcast?.sourceType === "lichessBroadcast") {
    return "/api/tournament/lichess";
  }
  return "/api/tournament/live";
};

export default function useTournamentLiveFeed({
  tournamentSlug,
  round,
  intervalMs = 20000,
  enabled = true,
}: UseTournamentLiveFeedParams): UseTournamentLiveFeedResult {
  const [version, setVersion] = useState(0);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const timerRef = useRef<number | null>(null);
  const timerKeyRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);
  const slugRef = useRef<string | null>(tournamentSlug ?? null);
  const roundRef = useRef<number | null>(round ?? null);
  const enabledRef = useRef(enabled);
  const debugPayloadShapeRef = useRef<string>("");
  const debugRequestSignatureRef = useRef<string>("");

  useEffect(() => {
    slugRef.current = tournamentSlug ?? null;
    roundRef.current = typeof round === "number" && Number.isFinite(round) ? Math.floor(round) : null;
    enabledRef.current = enabled;
  }, [enabled, round, tournamentSlug]);

  useEffect(() => {
    const fetchUpdates = async () => {
      if (!enabledRef.current) return;
      const slug = slugRef.current;
      if (!slug) return;
      const activeRound = getSafeRound(roundRef.current);
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      try {
        const query = new URLSearchParams({
          slug,
          round: String(activeRound),
        });
        const endpoint = resolveLiveEndpoint(slug);
        const requestUrl = `${endpoint}?${query.toString()}`;
        const primaryResponsePromise = fetch(requestUrl, {
          cache: "no-store",
        }).catch(() => null);
        const officialMetadataPromise = fetchOfficialMetadataUpdates(slug, activeRound);
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
          const signature = `${slug}:${activeRound}:${requestUrl}`;
          if (debugRequestSignatureRef.current !== signature) {
            debugRequestSignatureRef.current = signature;
            console.log("[broadcast-live] request", {
              selectedRound: activeRound,
              requestUrl,
            });
          }
        }
        const [response, officialMetadataUpdates] = await Promise.all([
          primaryResponsePromise,
          officialMetadataPromise,
        ]);

        let mapped: TournamentGameLiveUpdate[] = [];
        if (response && response.status !== 204 && response.ok) {
          const payload = (await response.json()) as DgtLivePayload | null;
          if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
            const raw = (payload ?? {}) as DgtLivePayload & {
              games?: unknown;
              pairings?: unknown;
              roundData?: Record<string, unknown> | null;
            };
            const keys = Object.keys(raw).sort();
            const roundDataKeys = raw.roundData && typeof raw.roundData === "object"
              ? Object.keys(raw.roundData).sort()
              : [];
            const signature = `${keys.join(",")}::${roundDataKeys.join(",")}`;
            if (debugPayloadShapeRef.current !== signature) {
              debugPayloadShapeRef.current = signature;
              console.log("[live-feed] payload keys", {
                keys,
                roundDataKeys,
                hasBoards: Array.isArray(raw.boards),
                hasGames: Array.isArray(raw.games),
                hasPairings: Array.isArray(raw.pairings),
              });
            }
          }
          mapped = buildMockUpdates(payload);
        }
        const mergedUpdates = mergeLiveUpdates(mapped, officialMetadataUpdates);
        const applied = applyTournamentLiveUpdates(mergedUpdates);
        if (applied > 0) {
          setVersion(v => v + 1);
        }
      } catch {
        // Swallow errors; live feed is best-effort.
      } finally {
        fetchInFlightRef.current = false;
        setHasFetchedOnce(true);
      }
    };

    const slug = slugRef.current;
    if (!enabled || !slug) return;
    const activeRound = getSafeRound(roundRef.current);
    const safeIntervalMs = Math.min(30000, Math.max(15000, intervalMs));
    const timerKey = `${slug}:${activeRound}:${safeIntervalMs}`;
    if (timerRef.current && timerKeyRef.current === timerKey) return;
    timerKeyRef.current = timerKey;
    fetchUpdates();
    timerRef.current = window.setInterval(fetchUpdates, safeIntervalMs);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      timerKeyRef.current = null;
    };
  }, [enabled, intervalMs, round, tournamentSlug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tournamentSlug?: string; round?: number }>).detail;
      const slug = slugRef.current?.trim().toLowerCase();
      if (!slug) return;
      const activeRound = getSafeRound(roundRef.current);
      const detailSlug = detail?.tournamentSlug?.trim().toLowerCase();
      if (detailSlug && detailSlug !== slug) return;
      if (typeof detail?.round === "number" && Number.isFinite(detail.round)) {
        if (Math.floor(detail.round) !== activeRound) return;
      }
      setVersion(v => v + 1);
    };
    window.addEventListener("tournament-live-update", handler);
    return () => {
      window.removeEventListener("tournament-live-update", handler);
    };
  }, []);

  return { version, hasFetchedOnce };
}
