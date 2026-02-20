import { NextResponse } from "next/server";
import type { GameSummary } from "@chessview/core";
import { extractLatestClockPairFromPgn } from "@/lib/chess/pgnServer";
import type { DgtBoardPlayer } from "@/lib/live/dgtPayload";
import { enrichPlayerFromRoster } from "@/lib/live/rosterEnrichment";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const LICHESS_BROADCAST_API = "https://lichess.org/api/broadcast";
const TATA_STEEL_CANONICAL_SLUG = "tata-steel-masters-2026";
const TATA_STEEL_BROADCAST_ID = "3COxSfdj";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const LIVE_ROUND_CACHE_TTL_MS = 12_000;
const STABLE_ROUND_CACHE_TTL_MS = 180_000;

type LichessRoundMeta = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
};

type LichessTournamentResponse = {
  rounds?: unknown;
};

type LichessGamePlayer = {
  user?: {
    name?: unknown;
    title?: unknown;
  };
  name?: unknown;
  title?: unknown;
  rating?: unknown;
  fed?: unknown;
  clock?: unknown;
};

type LichessRoundGame = {
  id?: unknown;
  fen?: unknown;
  lastMove?: unknown;
  status?: unknown;
  result?: unknown;
  winner?: unknown;
  players?: {
    white?: LichessGamePlayer;
    black?: LichessGamePlayer;
  };
};

type LichessRoundResponse = {
  round?: {
    id?: unknown;
    name?: unknown;
    slug?: unknown;
  };
  games?: unknown;
};

type PlayerProbeSide = {
  name: string | null;
  title: string | null;
  rating: number | null;
  federation: string | null;
  country: string | null;
  flag: string | null;
  __metaSource?: "upstream" | "roster" | "missing";
};

type DebugPlayerProbe = {
  board: number;
  source: "round_json" | "round_pgn";
  raw: {
    white: PlayerProbeSide;
    black: PlayerProbeSide;
  };
  normalized: {
    white: PlayerProbeSide;
    black: PlayerProbeSide;
  };
};

type DebugPayload = {
  source: string;
  urls: {
    tournament: string;
    round: string | null;
    roundPgn: string | null;
  };
  resolved: {
    inputSlug: string;
    tournamentKey: string;
    broadcastId: string | null;
    roundRequested: number;
    roundId: string | null;
    roundName: string | null;
    sourceUsed: "round_json" | "round_pgn" | "unresolved";
  };
  counts: {
    roundsDiscovered: number;
    upstreamGames: number;
    pgnGames: number;
    normalizedGames: number;
    missingPlayerGames: number;
  };
  cache?: {
    hit: boolean;
    key: string | null;
    ageMs: number | null;
    ttlMs: number | null;
    source: "memory" | "upstream";
  };
  playerProbe?: DebugPlayerProbe;
};

const OFFICIAL_BROADCAST_IDS: Record<string, string> = {
  [TATA_STEEL_CANONICAL_SLUG]: TATA_STEEL_BROADCAST_ID,
};

type CachedRoundGames = {
  games: GameSummary[];
  roundName: string | null;
  sourceUsed: "round_json" | "round_pgn";
  upstreamGames: number;
  pgnGames: number;
  missingPlayerGames: number;
  playerProbe?: DebugPlayerProbe;
  cachedAt: number;
  expiresAt: number;
};

const roundGamesCache = new Map<string, CachedRoundGames>();

const toTrimmedString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

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

const toNullableString = (value: unknown): string | null => {
  const trimmed = toTrimmedString(value);
  return trimmed || null;
};

const normalizePlayerMetadataToken = (value: unknown): string | null => {
  const trimmed = toNullableString(value);
  if (!trimmed) return null;
  return PLACEHOLDER_PLAYER_METADATA.has(trimmed.toLowerCase()) ? null : trimmed;
};

const normalizeFederationMetadata = (value: unknown): string | undefined => {
  const sanitized = normalizePlayerMetadataToken(value);
  if (!sanitized) return undefined;
  return sanitized.toUpperCase();
};

const normalizeFlagMetadata = (value: unknown): string | undefined => {
  const sanitized = normalizePlayerMetadataToken(value);
  if (!sanitized) return undefined;
  return /^[A-Za-z]{2,3}$/.test(sanitized) ? sanitized.toUpperCase() : sanitized;
};

const buildRosterEnrichedPlayer = (options: {
  tournamentKey: string;
  name: string;
  title?: string | null;
  rating?: number | null;
  federation?: string | null;
  country?: string | null;
  flag?: string | null;
  debug: boolean;
}): DgtBoardPlayer => {
  const player: DgtBoardPlayer = {
    name: options.name,
    ...(options.title ? { title: options.title } : {}),
    ...(options.rating != null ? { rating: options.rating } : {}),
    ...(options.federation ? { federation: options.federation } : {}),
    ...(options.country ? { country: options.country } : {}),
    ...(options.flag ? { flag: options.flag } : {}),
  };
  return enrichPlayerFromRoster(options.tournamentKey, player, { debug: options.debug });
};

const readRoundGamesCache = (key: string, now: number): CachedRoundGames | null => {
  const cached = roundGamesCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    roundGamesCache.delete(key);
    return null;
  }
  return cached;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return undefined;
};

const parseRoundParam = (raw: string | null): number | null => {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const round = Math.floor(parsed);
  if (round < 1) return null;
  return round;
};

const resolveTournamentKey = (rawSlug: string): string => {
  const normalized = rawSlug.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (
    normalized === "tata-steel-2026" ||
    normalized === TATA_STEEL_CANONICAL_SLUG ||
    normalized.includes("tata-steel")
  ) {
    return TATA_STEEL_CANONICAL_SLUG;
  }
  return normalized;
};

const extractRoundNumber = (value: string): number | null => {
  const matchFromName = value.match(/round\s+(\d+)/i);
  if (matchFromName) {
    const parsed = Number(matchFromName[1]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }

  const matchFromSlug = value.match(/round[-_]?(\d+)/i) ?? value.match(/\b(\d+)\b/);
  if (!matchFromSlug) return null;
  const parsed = Number(matchFromSlug[1]);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
};

const formatLichessClock = (secondsRaw: unknown): string => {
  const seconds = toOptionalNumber(secondsRaw);
  if (seconds == null) return "";
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatClockMs = (clockMs?: number | null): string => {
  if (!Number.isFinite(clockMs ?? NaN)) return "";
  const safeSeconds = Math.max(0, Math.floor(Number(clockMs) / 1000));
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const mapResults = (
  statusRaw: unknown,
  winnerRaw: unknown,
  resultRaw: unknown
): { isLive: boolean; whiteResult?: string; blackResult?: string } => {
  const status = toTrimmedString(statusRaw).toLowerCase();
  const winner = toTrimmedString(winnerRaw).toLowerCase();
  const result = toTrimmedString(resultRaw);

  if (result === "1-0") return { isLive: false, whiteResult: "1", blackResult: "0" };
  if (result === "0-1") return { isLive: false, whiteResult: "0", blackResult: "1" };
  if (result === "1/2-1/2" || result === "½-½") {
    return { isLive: false, whiteResult: "½", blackResult: "½" };
  }

  if (winner === "white") return { isLive: false, whiteResult: "1", blackResult: "0" };
  if (winner === "black") return { isLive: false, whiteResult: "0", blackResult: "1" };

  const finalStatuses = new Set([
    "mate",
    "resign",
    "outtime",
    "draw",
    "stalemate",
    "variantend",
    "timeout",
    "aborted",
  ]);
  if (finalStatuses.has(status)) {
    if (status === "draw" || status === "stalemate") {
      return { isLive: false, whiteResult: "½", blackResult: "½" };
    }
    return { isLive: false };
  }

  if (status === "created" || status === "scheduled" || status === "pending") {
    return { isLive: false };
  }

  if (status === "started" || status === "live") {
    return { isLive: true };
  }

  return { isLive: true };
};

const buildFailure = (options: {
  error: string;
  status: number;
  tournamentKey: string;
  round: number;
  debugEnabled: boolean;
  debugPayload: DebugPayload;
}) => {
  const { error, status, tournamentKey, round, debugEnabled, debugPayload } = options;
  return NextResponse.json(
    debugEnabled
      ? {
          ok: false,
          error,
          tournamentKey,
          round,
          debug: debugPayload,
        }
      : {
          ok: false,
          error,
          tournamentKey,
          round,
        },
    { status }
  );
};

const readPlayerName = (player: LichessGamePlayer | undefined): string => {
  const userName = toTrimmedString(player?.user?.name);
  if (userName) return userName;
  return toTrimmedString(player?.name);
};

const splitPgnGames = (pgnText: string): string[] => {
  const lines = pgnText.split(/\r?\n/);
  const games: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[Event ") && current.length > 0) {
      games.push(current.join("\n").trim());
      current = [];
    }
    if (trimmed === "" && current.length === 0) continue;
    current.push(line);
  }
  if (current.length > 0) {
    games.push(current.join("\n").trim());
  }
  return games.filter(Boolean);
};

const parsePgnHeaders = (gamePgn: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  const lines = gamePgn.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) continue;
    const match = trimmed.match(/^\[([A-Za-z0-9_]+)\s+"(.*)"\]$/);
    if (!match) continue;
    headers[match[1]] = match[2].replace(/\\"/g, "\"").trim();
  }
  return headers;
};

const parseRoundTag = (value?: string): number | null => {
  if (!value) return null;
  const match = value.match(/^(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
};

const parseGameIdFromUrlTag = (value?: string): string => {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  const match = raw.match(/\/([A-Za-z0-9]{8,12})(?:[/?#]|$)/);
  return match?.[1] ?? "";
};

const mapResultTag = (value?: string): { isLive: boolean; whiteResult?: string; blackResult?: string } => {
  const result = (value ?? "").trim();
  if (result === "1-0") return { isLive: false, whiteResult: "1", blackResult: "0" };
  if (result === "0-1") return { isLive: false, whiteResult: "0", blackResult: "1" };
  if (result === "1/2-1/2" || result === "½-½") {
    return { isLive: false, whiteResult: "½", blackResult: "½" };
  }
  return { isLive: true };
};

const parseGamesFromRoundPgn = (options: {
  pgnText: string;
  tournamentKey: string;
  fallbackRound: number;
  debugEnabled: boolean;
}): {
  games: GameSummary[];
  rawCount: number;
  missingPlayerGames: number;
  playerProbe: DebugPlayerProbe | null;
} => {
  const { pgnText, tournamentKey, fallbackRound, debugEnabled } = options;
  const gamesRaw = splitPgnGames(pgnText);
  const nowIso = new Date().toISOString();
  let missingPlayerGames = 0;
  let playerProbe: DebugPlayerProbe | null = null;

  const games: GameSummary[] = gamesRaw
    .map((gameText, index): GameSummary | null => {
      const headers = parsePgnHeaders(gameText);
      const whiteName = (headers.White ?? "").trim();
      const blackName = (headers.Black ?? "").trim();
      if (!whiteName || !blackName) {
        missingPlayerGames += 1;
        return null;
      }

      const roundFromTag = parseRoundTag(headers.Round);
      const gameIdFromSite = parseGameIdFromUrlTag(headers.Site);
      const gameIdFromGameUrl = parseGameIdFromUrlTag(headers.GameURL);
      const mappedResult = mapResultTag(headers.Result);
      const latestClockPair = extractLatestClockPairFromPgn(gameText, {
        fen: headers.FEN?.trim() || START_FEN,
      });
      const whiteRawTitle = toNullableString(headers.WhiteTitle);
      const blackRawTitle = toNullableString(headers.BlackTitle);
      const whiteRawRating = toOptionalNumber(headers.WhiteElo) ?? null;
      const blackRawRating = toOptionalNumber(headers.BlackElo) ?? null;
      const whiteRawCountry = toNullableString(headers.WhiteCountry);
      const blackRawCountry = toNullableString(headers.BlackCountry);
      const whiteRawFederation =
        toNullableString(headers.WhiteFederation) ?? toNullableString(headers.WhiteFed) ?? whiteRawCountry;
      const blackRawFederation =
        toNullableString(headers.BlackFederation) ?? toNullableString(headers.BlackFed) ?? blackRawCountry;
      const whiteRawFlag = toNullableString(headers.WhiteFlag) ?? toNullableString(headers.WhiteFlagEmoji);
      const blackRawFlag = toNullableString(headers.BlackFlag) ?? toNullableString(headers.BlackFlagEmoji);
      const whiteEnriched = buildRosterEnrichedPlayer({
        tournamentKey,
        name: whiteName,
        title: normalizePlayerMetadataToken(headers.WhiteTitle) ?? null,
        rating: toOptionalNumber(headers.WhiteElo) ?? null,
        federation:
          normalizeFederationMetadata(headers.WhiteCountry) ??
          normalizeFederationMetadata(headers.WhiteFederation) ??
          normalizeFederationMetadata(headers.WhiteFed) ??
          null,
        country: normalizeFederationMetadata(headers.WhiteCountry) ?? null,
        flag: normalizeFlagMetadata(headers.WhiteFlag) ?? normalizeFlagMetadata(headers.WhiteFlagEmoji) ?? null,
        debug: debugEnabled,
      });
      const blackEnriched = buildRosterEnrichedPlayer({
        tournamentKey,
        name: blackName,
        title: normalizePlayerMetadataToken(headers.BlackTitle) ?? null,
        rating: toOptionalNumber(headers.BlackElo) ?? null,
        federation:
          normalizeFederationMetadata(headers.BlackCountry) ??
          normalizeFederationMetadata(headers.BlackFederation) ??
          normalizeFederationMetadata(headers.BlackFed) ??
          null,
        country: normalizeFederationMetadata(headers.BlackCountry) ?? null,
        flag: normalizeFlagMetadata(headers.BlackFlag) ?? normalizeFlagMetadata(headers.BlackFlagEmoji) ?? null,
        debug: debugEnabled,
      });

      if (!playerProbe && index === 0) {
        playerProbe = {
          board: 1,
          source: "round_pgn",
          raw: {
            white: {
              name: whiteName || null,
              title: whiteRawTitle,
              rating: whiteRawRating,
              federation: whiteRawFederation,
              country: whiteRawCountry,
              flag: whiteRawFlag,
            },
            black: {
              name: blackName || null,
              title: blackRawTitle,
              rating: blackRawRating,
              federation: blackRawFederation,
              country: blackRawCountry,
              flag: blackRawFlag,
            },
          },
          normalized: {
            white: {
              name: whiteEnriched.name ?? null,
              title: whiteEnriched.title ?? null,
              rating: whiteEnriched.rating ?? null,
              federation: whiteEnriched.federation ?? null,
              country: whiteEnriched.country ?? null,
              flag: whiteEnriched.flag ?? null,
              ...(debugEnabled && whiteEnriched.__metaSource
                ? { __metaSource: whiteEnriched.__metaSource }
                : {}),
            },
            black: {
              name: blackEnriched.name ?? null,
              title: blackEnriched.title ?? null,
              rating: blackEnriched.rating ?? null,
              federation: blackEnriched.federation ?? null,
              country: blackEnriched.country ?? null,
              flag: blackEnriched.flag ?? null,
              ...(debugEnabled && blackEnriched.__metaSource
                ? { __metaSource: blackEnriched.__metaSource }
                : {}),
            },
          },
        };
      }

      return {
        gameId:
          gameIdFromSite ||
          gameIdFromGameUrl ||
          `${tournamentKey}-r${fallbackRound}-g${index + 1}`,
        whiteName,
        blackName,
        whiteTitle: whiteEnriched.title ?? undefined,
        blackTitle: blackEnriched.title ?? undefined,
        whiteFederation: whiteEnriched.federation ?? whiteEnriched.country ?? undefined,
        blackFederation: blackEnriched.federation ?? blackEnriched.country ?? undefined,
        whiteRating: whiteEnriched.rating ?? undefined,
        blackRating: blackEnriched.rating ?? undefined,
        isLive: mappedResult.isLive,
        whiteClock: formatClockMs(latestClockPair.whiteTimeMs),
        blackClock: formatClockMs(latestClockPair.blackTimeMs),
        whiteResult: mappedResult.whiteResult,
        blackResult: mappedResult.blackResult,
        fen: headers.FEN?.trim() || START_FEN,
        pgn: gameText,
        round: roundFromTag ?? fallbackRound,
        lastUpdatedAt: nowIso,
      } satisfies GameSummary;
    })
    .filter((game): game is GameSummary => game !== null);

  return {
    games,
    rawCount: gamesRaw.length,
    missingPlayerGames,
    playerProbe,
  };
};

const resolveRoundMeta = (rounds: LichessRoundMeta[], requestedRound: number) => {
  for (const round of rounds) {
    const roundName = toTrimmedString(round.name);
    const roundSlug = toTrimmedString(round.slug);
    const roundNo = extractRoundNumber(roundName) ?? extractRoundNumber(roundSlug);
    const roundId = toTrimmedString(round.id);
    if (roundNo === requestedRound && roundId) {
      return {
        roundId,
        roundName: roundName || null,
      };
    }
  }

  const fallback = rounds[requestedRound - 1];
  const fallbackId = toTrimmedString(fallback?.id);
  if (fallback && fallbackId) {
    return {
      roundId: fallbackId,
      roundName: toTrimmedString(fallback.name) || null,
    };
  }

  return {
    roundId: null,
    roundName: null,
  };
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const inputSlug = url.searchParams.get("slug")?.trim() ?? "";
  const roundParam = parseRoundParam(url.searchParams.get("round"));
  const roundIdParam = toTrimmedString(url.searchParams.get("roundId"));
  const debugEnabled = url.searchParams.get("debug") === "1";
  const tournamentKey = resolveTournamentKey(inputSlug);
  const requestedRound = roundParam ?? 0;

  const debugPayload: DebugPayload = {
    source: "lichess-broadcast-round-json",
    urls: {
      tournament: "",
      round: null,
      roundPgn: null,
    },
    resolved: {
      inputSlug,
      tournamentKey,
      broadcastId: null,
      roundRequested: requestedRound,
      roundId: roundIdParam || null,
      roundName: null,
      sourceUsed: "unresolved",
    },
    counts: {
      roundsDiscovered: 0,
      upstreamGames: 0,
      pgnGames: 0,
      normalizedGames: 0,
      missingPlayerGames: 0,
    },
  };

  if (!inputSlug) {
    return buildFailure({
      error: "missing_slug",
      status: 400,
      tournamentKey,
      round: requestedRound,
      debugEnabled,
      debugPayload,
    });
  }

  if (!roundParam) {
    return buildFailure({
      error: "invalid_round",
      status: 400,
      tournamentKey,
      round: requestedRound,
      debugEnabled,
      debugPayload,
    });
  }

  const broadcastId = OFFICIAL_BROADCAST_IDS[tournamentKey] ?? null;
  debugPayload.resolved.broadcastId = broadcastId;
  if (!broadcastId) {
    return buildFailure({
      error: "unsupported_tournament",
      status: 404,
      tournamentKey,
      round: roundParam,
      debugEnabled,
      debugPayload,
    });
  }

  const tournamentUrl = `${LICHESS_BROADCAST_API}/${encodeURIComponent(broadcastId)}`;
  debugPayload.urls.tournament = tournamentUrl;

  try {
    let resolvedRoundId = roundIdParam || null;
    let resolvedRoundName: string | null = null;

    if (!resolvedRoundId) {
      const tournamentRes = await fetch(tournamentUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!tournamentRes.ok) {
        return buildFailure({
          error: "broadcast_lookup_failed",
          status: 502,
          tournamentKey,
          round: roundParam,
          debugEnabled,
          debugPayload,
        });
      }

      const tournamentJson = (await tournamentRes.json()) as LichessTournamentResponse;
      const rounds = Array.isArray(tournamentJson.rounds)
        ? (tournamentJson.rounds as LichessRoundMeta[])
        : [];
      debugPayload.counts.roundsDiscovered = rounds.length;

      const resolvedRound = resolveRoundMeta(rounds, roundParam);
      resolvedRoundId = resolvedRound.roundId;
      resolvedRoundName = resolvedRound.roundName;
    }

    debugPayload.resolved.roundId = resolvedRoundId;
    debugPayload.resolved.roundName = resolvedRoundName;
    if (!resolvedRoundId) {
      return buildFailure({
        error: "round_not_found",
        status: 404,
        tournamentKey,
        round: roundParam,
        debugEnabled,
        debugPayload,
      });
    }

    const roundUrl = `${LICHESS_BROADCAST_API}/round/${encodeURIComponent(resolvedRoundId)}`;
    const roundPgnUrl = `${LICHESS_BROADCAST_API}/round/${encodeURIComponent(resolvedRoundId)}.pgn`;
    debugPayload.urls.round = roundUrl;
    debugPayload.urls.roundPgn = roundPgnUrl;
    const cacheKey = `${tournamentKey}:${resolvedRoundId}`;
    const now = Date.now();
    const cachedRound = readRoundGamesCache(cacheKey, now);
    if (cachedRound) {
      const sourceLabel =
        cachedRound.sourceUsed === "round_pgn"
          ? "lichess-broadcast-round-pgn"
          : "lichess-broadcast-round-json";
      debugPayload.source = sourceLabel;
      debugPayload.resolved.sourceUsed = cachedRound.sourceUsed;
      debugPayload.resolved.roundName = cachedRound.roundName;
      debugPayload.counts.upstreamGames = cachedRound.upstreamGames;
      debugPayload.counts.pgnGames = cachedRound.pgnGames;
      debugPayload.counts.normalizedGames = cachedRound.games.length;
      debugPayload.counts.missingPlayerGames = cachedRound.missingPlayerGames;
      if (cachedRound.playerProbe) {
        debugPayload.playerProbe = cachedRound.playerProbe;
      }
      debugPayload.cache = {
        hit: true,
        key: cacheKey,
        ageMs: Math.max(0, now - cachedRound.cachedAt),
        ttlMs: Math.max(0, cachedRound.expiresAt - cachedRound.cachedAt),
        source: "memory",
      };
      return NextResponse.json(
        debugEnabled
          ? {
              ok: true,
              tournamentKey,
              round: roundParam,
              games: cachedRound.games,
              debug: debugPayload,
            }
          : {
              ok: true,
              tournamentKey,
              round: roundParam,
              games: cachedRound.games,
            }
      );
    }

    let roundGames: LichessRoundGame[] = [];
    let roundNameFromRoundPayload = "";
    let roundSlugFromRoundPayload = "";
    let roundJsonFetchFailed = false;

    try {
      const roundRes = await fetch(roundUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!roundRes.ok) {
        roundJsonFetchFailed = true;
      } else {
        const roundJson = (await roundRes.json()) as LichessRoundResponse;
        roundGames = Array.isArray(roundJson.games)
          ? (roundJson.games as LichessRoundGame[])
          : [];
        roundNameFromRoundPayload = toTrimmedString(roundJson.round?.name);
        roundSlugFromRoundPayload = toTrimmedString(roundJson.round?.slug);
        debugPayload.counts.upstreamGames = roundGames.length;
      }
    } catch {
      roundJsonFetchFailed = true;
    }

    const normalizedRound =
      extractRoundNumber(roundNameFromRoundPayload) ??
      extractRoundNumber(roundSlugFromRoundPayload) ??
      extractRoundNumber(debugPayload.resolved.roundName ?? "") ??
      roundParam;

    if (!resolvedRoundName && roundNameFromRoundPayload) {
      resolvedRoundName = roundNameFromRoundPayload;
      debugPayload.resolved.roundName = resolvedRoundName;
    }

    let normalizedGames: GameSummary[] = [];
    let missingPlayerGames = 0;
    let playerProbe: DebugPlayerProbe | null = null;

    if (roundGames.length > 0) {
      const nowIso = new Date().toISOString();
      const jsonMissingPlayerGames = roundGames.filter(game => {
        const whiteName = readPlayerName(game.players?.white);
        const blackName = readPlayerName(game.players?.black);
        return !whiteName || !blackName;
      }).length;

      if (jsonMissingPlayerGames === 0) {
        normalizedGames = roundGames.map((game, index) => {
          const whitePlayer = game.players?.white;
          const blackPlayer = game.players?.black;
          const whiteRecord = (whitePlayer && typeof whitePlayer === "object"
            ? (whitePlayer as Record<string, unknown>)
            : null);
          const blackRecord = (blackPlayer && typeof blackPlayer === "object"
            ? (blackPlayer as Record<string, unknown>)
            : null);
          const whiteName = readPlayerName(whitePlayer);
          const blackName = readPlayerName(blackPlayer);
          const whiteRawTitle = toNullableString(whitePlayer?.user?.title || whitePlayer?.title);
          const blackRawTitle = toNullableString(blackPlayer?.user?.title || blackPlayer?.title);
          const whiteRawRating = toOptionalNumber(whitePlayer?.rating) ?? null;
          const blackRawRating = toOptionalNumber(blackPlayer?.rating) ?? null;
          const whiteRawFederation = toNullableString(whitePlayer?.fed);
          const blackRawFederation = toNullableString(blackPlayer?.fed);
          const whiteRawCountry =
            toNullableString(whiteRecord?.country) ?? toNullableString(whiteRecord?.countryCode);
          const blackRawCountry =
            toNullableString(blackRecord?.country) ?? toNullableString(blackRecord?.countryCode);
          const whiteRawFlag =
            toNullableString(whiteRecord?.flag) ?? toNullableString(whiteRecord?.flagEmoji);
          const blackRawFlag =
            toNullableString(blackRecord?.flag) ?? toNullableString(blackRecord?.flagEmoji);
          const whiteEnriched = buildRosterEnrichedPlayer({
            tournamentKey,
            name: whiteName,
            title: normalizePlayerMetadataToken(whitePlayer?.user?.title || whitePlayer?.title) ?? null,
            rating: toOptionalNumber(whitePlayer?.rating) ?? null,
            federation:
              normalizeFederationMetadata(whitePlayer?.fed) ??
              normalizeFederationMetadata(whiteRecord?.federation) ??
              normalizeFederationMetadata(whiteRecord?.country) ??
              normalizeFederationMetadata(whiteRecord?.countryCode) ??
              null,
            country:
              normalizeFederationMetadata(whiteRecord?.country) ??
              normalizeFederationMetadata(whiteRecord?.countryCode) ??
              null,
            flag:
              normalizeFlagMetadata(whiteRecord?.flag) ??
              normalizeFlagMetadata(whiteRecord?.flagEmoji) ??
              null,
            debug: debugEnabled,
          });
          const blackEnriched = buildRosterEnrichedPlayer({
            tournamentKey,
            name: blackName,
            title: normalizePlayerMetadataToken(blackPlayer?.user?.title || blackPlayer?.title) ?? null,
            rating: toOptionalNumber(blackPlayer?.rating) ?? null,
            federation:
              normalizeFederationMetadata(blackPlayer?.fed) ??
              normalizeFederationMetadata(blackRecord?.federation) ??
              normalizeFederationMetadata(blackRecord?.country) ??
              normalizeFederationMetadata(blackRecord?.countryCode) ??
              null,
            country:
              normalizeFederationMetadata(blackRecord?.country) ??
              normalizeFederationMetadata(blackRecord?.countryCode) ??
              null,
            flag:
              normalizeFlagMetadata(blackRecord?.flag) ??
              normalizeFlagMetadata(blackRecord?.flagEmoji) ??
              null,
            debug: debugEnabled,
          });
          const mappedResult = mapResults(game.status, game.winner, game.result);
          const gameId =
            toTrimmedString(game.id) || `${tournamentKey}-r${normalizedRound}-g${index + 1}`;
          const fen = toTrimmedString(game.fen) || START_FEN;

          if (!playerProbe && index === 0) {
            playerProbe = {
              board: 1,
              source: "round_json",
              raw: {
                white: {
                  name: whiteName || null,
                  title: whiteRawTitle,
                  rating: whiteRawRating,
                  federation: whiteRawFederation,
                  country: whiteRawCountry,
                  flag: whiteRawFlag,
                },
                black: {
                  name: blackName || null,
                  title: blackRawTitle,
                  rating: blackRawRating,
                  federation: blackRawFederation,
                  country: blackRawCountry,
                  flag: blackRawFlag,
                },
              },
              normalized: {
                white: {
                  name: whiteEnriched.name ?? null,
                  title: whiteEnriched.title ?? null,
                  rating: whiteEnriched.rating ?? null,
                  federation: whiteEnriched.federation ?? null,
                  country: whiteEnriched.country ?? null,
                  flag: whiteEnriched.flag ?? null,
                  ...(debugEnabled && whiteEnriched.__metaSource
                    ? { __metaSource: whiteEnriched.__metaSource }
                    : {}),
                },
                black: {
                  name: blackEnriched.name ?? null,
                  title: blackEnriched.title ?? null,
                  rating: blackEnriched.rating ?? null,
                  federation: blackEnriched.federation ?? null,
                  country: blackEnriched.country ?? null,
                  flag: blackEnriched.flag ?? null,
                  ...(debugEnabled && blackEnriched.__metaSource
                    ? { __metaSource: blackEnriched.__metaSource }
                    : {}),
                },
              },
            };
          }

          return {
            gameId,
            whiteName,
            blackName,
            whiteTitle: whiteEnriched.title ?? undefined,
            blackTitle: blackEnriched.title ?? undefined,
            whiteFederation: whiteEnriched.federation ?? whiteEnriched.country ?? undefined,
            blackFederation: blackEnriched.federation ?? blackEnriched.country ?? undefined,
            whiteRating: whiteEnriched.rating ?? undefined,
            blackRating: blackEnriched.rating ?? undefined,
            isLive: mappedResult.isLive,
            whiteClock: formatLichessClock(whitePlayer?.clock),
            blackClock: formatLichessClock(blackPlayer?.clock),
            whiteResult: mappedResult.whiteResult,
            blackResult: mappedResult.blackResult,
            fen,
            lastMove: toTrimmedString(game.lastMove) || undefined,
            pgn: "",
            round: normalizedRound,
            lastUpdatedAt: nowIso,
          } satisfies GameSummary;
        });
        debugPayload.source = "lichess-broadcast-round-json";
        debugPayload.resolved.sourceUsed = "round_json";
      }
    }

    if (normalizedGames.length === 0) {
      const roundPgnRes = await fetch(roundPgnUrl, {
        cache: "no-store",
      }).catch(() => null);

      if (!roundPgnRes || !roundPgnRes.ok) {
        return buildFailure({
          error: roundJsonFetchFailed ? "round_fetch_failed" : "empty_games",
          status: 502,
          tournamentKey,
          round: roundParam,
          debugEnabled,
          debugPayload,
        });
      }

      const pgnText = await roundPgnRes.text();
      if (!pgnText.trim() || pgnText.trim().startsWith("<")) {
        return buildFailure({
          error: "round_fetch_failed",
          status: 502,
          tournamentKey,
          round: roundParam,
          debugEnabled,
          debugPayload,
        });
      }

      const parsedPgn = parseGamesFromRoundPgn({
        pgnText,
        tournamentKey,
        fallbackRound: roundParam,
        debugEnabled,
      });
      debugPayload.counts.pgnGames = parsedPgn.rawCount;
      missingPlayerGames = parsedPgn.missingPlayerGames;
      if (missingPlayerGames > 0) {
        debugPayload.counts.missingPlayerGames = missingPlayerGames;
        return buildFailure({
          error: "missing_player_data",
          status: 502,
          tournamentKey,
          round: roundParam,
          debugEnabled,
          debugPayload,
        });
      }

      normalizedGames = parsedPgn.games;
      playerProbe = parsedPgn.playerProbe;
      debugPayload.source = "lichess-broadcast-round-pgn";
      debugPayload.resolved.sourceUsed = "round_pgn";
    }

    debugPayload.counts.normalizedGames = normalizedGames.length;
    debugPayload.counts.missingPlayerGames = missingPlayerGames;
    if (playerProbe) {
      debugPayload.playerProbe = playerProbe;
    }
    if (normalizedGames.length === 0) {
      return buildFailure({
        error: "empty_games",
        status: 502,
        tournamentKey,
        round: roundParam,
        debugEnabled,
        debugPayload,
      });
    }

    const allFinishedGames =
      normalizedGames.length > 0 &&
      normalizedGames.every(game => {
        const whiteResult = toTrimmedString(game.whiteResult);
        const blackResult = toTrimmedString(game.blackResult);
        return Boolean(whiteResult || blackResult);
      });
    const ttlMs = allFinishedGames ? STABLE_ROUND_CACHE_TTL_MS : LIVE_ROUND_CACHE_TTL_MS;
    const cacheNow = Date.now();
    const sourceUsed = debugPayload.resolved.sourceUsed === "round_pgn" ? "round_pgn" : "round_json";
    roundGamesCache.set(cacheKey, {
      games: normalizedGames,
      roundName: resolvedRoundName,
      sourceUsed,
      upstreamGames: debugPayload.counts.upstreamGames,
      pgnGames: debugPayload.counts.pgnGames,
      missingPlayerGames,
      playerProbe: playerProbe ?? undefined,
      cachedAt: cacheNow,
      expiresAt: cacheNow + ttlMs,
    });
    debugPayload.cache = {
      hit: false,
      key: cacheKey,
      ageMs: 0,
      ttlMs,
      source: "upstream",
    };

    return NextResponse.json(
      debugEnabled
        ? {
            ok: true,
            tournamentKey,
            round: roundParam,
            games: normalizedGames,
            debug: debugPayload,
          }
        : {
            ok: true,
            tournamentKey,
            round: roundParam,
            games: normalizedGames,
          }
    );
  } catch {
    return buildFailure({
      error: "upstream_unavailable",
      status: 502,
      tournamentKey,
      round: roundParam,
      debugEnabled,
      debugPayload,
    });
  }
}
