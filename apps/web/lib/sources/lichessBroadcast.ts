import "server-only";

import {
  deriveFenFromPgn,
  extractLatestClockPairFromPgn,
  getSideToMoveFromFen,
  type PgnParseMode,
} from "@/lib/chess/pgnServer";

const LICHESS_BROADCAST_BASE = "https://lichess.org/api/broadcast";
const TOURNAMENT_TTL_MS = 20000;
const ROUND_PGN_TTL_MS = 4000;

type LichessBroadcastRoundMeta = {
  id: string;
  name: string;
  startsAt: string | null;
  startsAtMs: number | null;
  slug: string | null;
  url: string | null;
};

type LichessBroadcastTournamentMeta = {
  id: string;
  slug: string;
  name: string | null;
};

export type LichessBroadcastTournamentSnapshot = {
  tournament: LichessBroadcastTournamentMeta;
  rounds: LichessBroadcastRoundMeta[];
  activeRoundId: string | null;
  activeRoundIndex: number | null;
};

export type LichessBroadcastBoard = {
  boardNo: number;
  whiteName: string;
  blackName: string;
  whiteTitle: string | null;
  blackTitle: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  whiteCountry: string | null;
  blackCountry: string | null;
  status: "live" | "final" | "scheduled";
  result: "1-0" | "0-1" | "1/2-1/2" | "½-½" | "*" | null;
  moveList: string[];
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
  sideToMove?: "white" | "black" | null;
  clockUpdatedAtMs?: number | null;
};

export type LichessBroadcastRoundSnapshot = {
  roundsMeta: LichessBroadcastRoundMeta[];
  activeRoundId: string | null;
  activeRoundIndex: number | null;
  boards: LichessBroadcastBoard[];
  debug?: {
    urls: {
      tournament: string;
      roundPgn: string;
    };
    timingsMs: {
      tournament: number | null;
      roundPgn: number | null;
    };
    counts: {
      rounds: number;
      boards: number;
      moves: number;
    };
    roundUrlUsed?: string | null;
    pgnUrlUsed?: string;
    httpStatus?: number | null;
    contentType?: string | null;
    pgnBytes?: number;
    pgnStartsWith?: string;
    gamesParsedCount?: number;
    firstGame?: {
      whiteTag: string | null;
      blackTag: string | null;
      whiteName: string;
      blackName: string;
      result: LichessBroadcastBoard["result"];
      movesCount: number;
      parseMode: PgnParseMode;
      failedToken: string | null;
      error: string | null;
      parseIssue: string | null;
    } | null;
    cache?: {
      tournamentHit: boolean;
      roundHit: boolean;
      tournamentAgeMs: number | null;
      roundAgeMs: number | null;
    };
  };
};

type CacheEntry<T> = {
  value: T;
  cachedAt: number;
  expiresAt: number;
};

const tournamentCache = new Map<string, CacheEntry<LichessBroadcastTournamentSnapshot>>();
const roundPgnCache = new Map<
  string,
  CacheEntry<{ text: string; contentType: string | null; status: number }>
>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const stripBom = (value: string): string => value.replace(/^\uFEFF/, "");

const normalizeStartsAt = (value: unknown): { iso: string | null; ms: number | null } => {
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? { iso: value.trim(), ms } : { iso: value.trim(), ms: null };
  }
  const numeric = toNumber(value);
  if (numeric == null) return { iso: null, ms: null };
  const ms = numeric < 1e12 ? numeric * 1000 : numeric;
  const iso = new Date(ms).toISOString();
  return { iso, ms };
};

const readCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, now: number) => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return cached;
};

const fetchJson = async (url: string) => {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store" });
    const status = response.status;
    let json: unknown = null;
    try {
      json = (await response.json()) as unknown;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      json,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      json: null,
    };
  }
};

const fetchText = async (url: string) => {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store" });
    const status = response.status;
    const text = await response.text();
    const contentType = response.headers.get("content-type");
    return {
      ok: response.ok,
      status,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      text,
      contentType,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      text: "",
      contentType: null,
    };
  }
};

const parseTournamentJson = (json: unknown, fallbackId: string): LichessBroadcastTournamentSnapshot => {
  const payload = isRecord(json) ? json : {};
  const tour = isRecord(payload.tour) ? payload.tour : payload;
  const roundsRaw = Array.isArray(payload.rounds) ? payload.rounds : [];
  const tournament: LichessBroadcastTournamentMeta = {
    id: toString(tour.id) || fallbackId,
    slug: toString(tour.slug),
    name: toString(tour.name) || null,
  };
  const rounds: LichessBroadcastRoundMeta[] = roundsRaw
    .map(raw => {
      if (!isRecord(raw)) return null;
      const id = toString(raw.id);
      if (!id) return null;
      const name = toString(raw.name) || `Round ${id}`;
      const startsAt = normalizeStartsAt(raw.startsAt ?? raw.startsAtMs ?? raw.startsAtSeconds);
      const roundRecord = isRecord(raw.round) ? raw.round : null;
      const slug = toString(raw.slug) || toString(roundRecord?.slug) || null;
      const directUrl =
        toString(raw.url ?? raw.roundUrl ?? raw.permalink ?? raw.href) ||
        toString(roundRecord?.url ?? roundRecord?.permalink ?? roundRecord?.href);
      const derivedUrl =
        !directUrl && tournament.slug && slug
          ? `https://lichess.org/broadcast/${tournament.slug}/${slug}/${id}`
          : "";
      const url = directUrl || derivedUrl || null;
      return {
        id,
        name,
        startsAt: startsAt.iso,
        startsAtMs: startsAt.ms,
        slug,
        url,
      };
    })
    .filter((round): round is LichessBroadcastRoundMeta => Boolean(round));
  return {
    tournament,
    rounds,
    activeRoundId: null,
    activeRoundIndex: null,
  };
};

const selectActiveRound = (
  rounds: LichessBroadcastRoundMeta[],
  roundIdOverride?: string | null
): { id: string | null; index: number | null } => {
  if (roundIdOverride) {
    const idx = rounds.findIndex(round => round.id === roundIdOverride);
    return { id: roundIdOverride, index: idx >= 0 ? idx + 1 : null };
  }
  if (rounds.length === 0) return { id: null, index: null };
  const now = Date.now();
  const eligible = rounds
    .map((round, index) => ({ round, index }))
    .filter(item => item.round.startsAtMs != null && item.round.startsAtMs <= now);
  if (eligible.length === 0) {
    return { id: rounds[0].id, index: 1 };
  }
  eligible.sort((a, b) => (a.round.startsAtMs ?? 0) - (b.round.startsAtMs ?? 0));
  const latest = eligible[eligible.length - 1];
  return { id: latest.round.id, index: latest.index + 1 };
};

const splitPgnGames = (pgn: string): string[] => {
  const lines = pgn.split(/\r?\n/);
  const games: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    const normalizedLine = stripBom(line);
    if (/^\s*\[Event\s/.test(normalizedLine) && buffer.length > 0) {
      games.push(buffer.join("\n").trim());
      buffer = [];
    }
    if (normalizedLine.trim() === "" && buffer.length === 0) continue;
    buffer.push(normalizedLine);
  }
  if (buffer.length > 0) {
    games.push(buffer.join("\n").trim());
  }
  return games.filter(Boolean);
};

const parsePgnHeaders = (pgn: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  const lines = pgn.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = stripBom(line).trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) continue;
    const match = trimmed.match(/^\[([A-Za-z0-9_]+)\s+"(.*)"\]$/);
    if (!match) continue;
    headers[match[1]] = match[2].replace(/\\"/g, "\"").trim();
  }
  return headers;
};

const normalizeResult = (value?: string | null): LichessBroadcastBoard["result"] => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (trimmed === "*" || trimmed === "\u00b7") return "*";
  if (trimmed === "1-0" || trimmed === "0-1" || trimmed === "1/2-1/2" || trimmed === "½-½") {
    return trimmed;
  }
  if (trimmed.toLowerCase() === "draw") return "1/2-1/2";
  return null;
};

const FIDE_TITLES = new Set(["GM", "IM", "FM", "CM", "WGM", "WIM", "WFM", "WCM"]);

const normalizeTitle = (value?: string | null): string | null => {
  const normalized = toString(value).toUpperCase();
  if (!normalized) return null;
  return FIDE_TITLES.has(normalized) ? normalized : null;
};

const normalizeCountryCode = (value?: string | null): string | null => {
  const normalized = toString(value).toUpperCase();
  return normalized || null;
};

const parseRating = (value?: string | null): number | null => {
  const parsed = toNumber(value);
  if (!parsed || parsed <= 0) return null;
  return Math.floor(parsed);
};

const readHeaderValue = (headers: Record<string, string>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = headers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const normalizeStatus = (
  result: LichessBroadcastBoard["result"],
  value?: string | null,
  termination?: string | null
): LichessBroadcastBoard["status"] => {
  if (result && result !== "*") return "final";
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  const terminationValue = typeof termination === "string" ? termination.trim().toLowerCase() : "";
  if (terminationValue && terminationValue !== "unterminated" && terminationValue !== "in progress") {
    return "final";
  }
  if (trimmed === "scheduled" || trimmed === "upcoming" || trimmed === "pending") return "scheduled";
  return "live";
};

const parseBoardNumber = (headers: Record<string, string>, fallback: number) => {
  const candidates = [
    headers.Board,
    headers.BoardNo,
    headers.BoardNumber,
    headers.Table,
    headers.Game,
  ];
  for (const value of candidates) {
    const parsed = toNumber(value);
    if (parsed && parsed >= 1) return Math.floor(parsed);
  }
  return fallback;
};

type PgnRoundParseDebug = {
  gamesParsedCount: number;
  firstGame: {
    whiteTag: string | null;
    blackTag: string | null;
    whiteName: string;
    blackName: string;
    result: LichessBroadcastBoard["result"];
    movesCount: number;
    parseMode: PgnParseMode;
    failedToken: string | null;
    error: string | null;
    parseIssue: string | null;
  } | null;
};

const parseBoardsFromPgn = (
  pgn: string
): {
  boards: LichessBroadcastBoard[];
  debug: PgnRoundParseDebug;
} => {
  const games = splitPgnGames(pgn);
  const boards: LichessBroadcastBoard[] = [];
  const parsedAtMs = Date.now();
  let firstGameDebug: PgnRoundParseDebug["firstGame"] = null;
  games.forEach((game, index) => {
    const headers = parsePgnHeaders(game);
    const result = normalizeResult(headers.Result);
    const status = normalizeStatus(result, headers.Status, headers.Termination);
    const whiteTag = headers.White?.trim() || null;
    const blackTag = headers.Black?.trim() || null;
    const whiteName =
      whiteTag || headers.WhiteName?.trim() || headers.WhitePlayer?.trim() || "?";
    const blackName =
      blackTag || headers.BlackName?.trim() || headers.BlackPlayer?.trim() || "?";
    const whiteTitle = normalizeTitle(
      readHeaderValue(headers, ["WhiteTitle", "WhiteFideTitle", "WhiteTitleFide"])
    );
    const blackTitle = normalizeTitle(
      readHeaderValue(headers, ["BlackTitle", "BlackFideTitle", "BlackTitleFide"])
    );
    const whiteElo = parseRating(
      readHeaderValue(headers, ["WhiteElo", "WhiteRating", "WhiteFideElo", "WhiteEloFide"])
    );
    const blackElo = parseRating(
      readHeaderValue(headers, ["BlackElo", "BlackRating", "BlackFideElo", "BlackEloFide"])
    );
    const whiteCountry = normalizeCountryCode(
      readHeaderValue(headers, ["WhiteCountry", "WhiteFederation", "WhiteFed"])
    );
    const blackCountry = normalizeCountryCode(
      readHeaderValue(headers, ["BlackCountry", "BlackFederation", "BlackFed"])
    );
    const boardNo = parseBoardNumber(headers, index + 1);
    const parsed = deriveFenFromPgn(game);
    const moveList = parsed.moveList ?? [];
    const sideToMove = getSideToMoveFromFen(parsed.fen);
    const latestClockPair = extractLatestClockPairFromPgn(game, {
      sideToMove,
      fen: parsed.fen,
      moveCount: moveList.length,
    });
    const hasClockData =
      Number.isFinite(latestClockPair.whiteTimeMs ?? NaN) ||
      Number.isFinite(latestClockPair.blackTimeMs ?? NaN);
    if (!firstGameDebug) {
      const parseIssue =
        moveList.length > 0
          ? null
          : parsed.error?.message ?? (parsed.failedToken ? `invalid token ${parsed.failedToken}` : "no-moves");
      firstGameDebug = {
        whiteTag,
        blackTag,
        whiteName,
        blackName,
        result,
        movesCount: moveList.length,
        parseMode: parsed.parseMode,
        failedToken: parsed.failedToken,
        error: parsed.error?.message ?? null,
        parseIssue,
      };
    }
    boards.push({
      boardNo,
      whiteName,
      blackName,
      whiteTitle,
      blackTitle,
      whiteElo,
      blackElo,
      whiteCountry,
      blackCountry,
      status,
      result,
      moveList,
      whiteTimeMs: latestClockPair.whiteTimeMs,
      blackTimeMs: latestClockPair.blackTimeMs,
      sideToMove: latestClockPair.sideToMove ?? sideToMove,
      clockUpdatedAtMs: hasClockData ? parsedAtMs : null,
    });
  });
  return {
    boards: boards.sort((a, b) => a.boardNo - b.boardNo),
    debug: {
      gamesParsedCount: games.length,
      firstGame: firstGameDebug,
    },
  };
};

export async function fetchLichessBroadcastTournament(options: {
  tournamentId: string;
  roundIdOverride?: string | null;
  debug?: boolean;
}): Promise<{ snapshot: LichessBroadcastTournamentSnapshot; debug?: LichessBroadcastRoundSnapshot["debug"] }> {
  const { tournamentId, roundIdOverride, debug } = options;
  const now = Date.now();
  const cacheKey = tournamentId;
  const cached = readCache(tournamentCache, cacheKey, now);
  let tournamentTiming: number | null = null;
  let snapshot: LichessBroadcastTournamentSnapshot;
  let cacheHit = false;

  if (cached) {
    snapshot = cached.value;
    cacheHit = true;
  } else {
    const url = `${LICHESS_BROADCAST_BASE}/${encodeURIComponent(tournamentId)}`;
    const fetchResult = await fetchJson(url);
    tournamentTiming = fetchResult.elapsedMs;
    if (!fetchResult.ok || !fetchResult.json) {
      throw new Error("lichess_broadcast_unavailable");
    }
    snapshot = parseTournamentJson(fetchResult.json, tournamentId);
    const selected = selectActiveRound(snapshot.rounds, roundIdOverride);
    snapshot = {
      ...snapshot,
      activeRoundId: selected.id,
      activeRoundIndex: selected.index,
    };
    tournamentCache.set(cacheKey, {
      value: snapshot,
      cachedAt: now,
      expiresAt: now + TOURNAMENT_TTL_MS,
    });
  }

  if (cacheHit && roundIdOverride) {
    const selected = selectActiveRound(snapshot.rounds, roundIdOverride);
    snapshot = {
      ...snapshot,
      activeRoundId: selected.id,
      activeRoundIndex: selected.index,
    };
  }

  return {
    snapshot,
    debug: debug
      ? {
          urls: {
            tournament: `${LICHESS_BROADCAST_BASE}/${encodeURIComponent(tournamentId)}`,
            roundPgn: "",
          },
          timingsMs: {
            tournament: tournamentTiming,
            roundPgn: null,
          },
          counts: {
            rounds: snapshot.rounds.length,
            boards: 0,
            moves: 0,
          },
          cache: {
            tournamentHit: cacheHit,
            roundHit: false,
            tournamentAgeMs: cacheHit && cached ? Math.max(0, now - cached.cachedAt) : null,
            roundAgeMs: null,
          },
        }
      : undefined,
  };
}

export async function fetchLichessBroadcastRound(options: {
  tournamentId: string;
  roundIdOverride?: string | null;
  debug?: boolean;
}): Promise<LichessBroadcastRoundSnapshot> {
  const { tournamentId, roundIdOverride, debug } = options;
  const now = Date.now();
  const tournamentResult = await fetchLichessBroadcastTournament({
    tournamentId,
    roundIdOverride,
    debug,
  });
  const snapshot = tournamentResult.snapshot;
  const activeRoundId = snapshot.activeRoundId;
  if (!activeRoundId) {
    return {
      roundsMeta: snapshot.rounds,
      activeRoundId: null,
      activeRoundIndex: snapshot.activeRoundIndex,
      boards: [],
      ...(debug ? { debug: tournamentResult.debug } : {}),
    };
  }

  const activeRoundMeta = snapshot.rounds.find(round => round.id === activeRoundId) ?? null;
  const roundUrlUsed = activeRoundMeta?.url ?? null;
  const pgnUrlUsed = `${LICHESS_BROADCAST_BASE}/round/${encodeURIComponent(activeRoundId)}.pgn`;

  const cachedRound = readCache(roundPgnCache, activeRoundId, now);
  let roundPgn = "";
  let roundTiming: number | null = null;
  let roundCacheHit = false;
  let roundContentType: string | null = null;
  let roundHttpStatus: number | null = null;
  if (cachedRound) {
    roundPgn = cachedRound.value.text;
    roundContentType = cachedRound.value.contentType;
    roundHttpStatus = cachedRound.value.status;
    roundCacheHit = true;
  } else {
    const fetchResult = await fetchText(pgnUrlUsed);
    roundTiming = fetchResult.elapsedMs;
    roundHttpStatus = fetchResult.status;
    if (!fetchResult.ok) {
      throw new Error("lichess_broadcast_round_unavailable");
    }
    roundPgn = fetchResult.text;
    roundContentType = fetchResult.contentType ?? null;
    roundPgnCache.set(activeRoundId, {
      value: { text: roundPgn, contentType: roundContentType, status: fetchResult.status },
      cachedAt: now,
      expiresAt: now + ROUND_PGN_TTL_MS,
    });
  }

  const parseResult = roundPgn
    ? parseBoardsFromPgn(roundPgn)
    : { boards: [], debug: { gamesParsedCount: 0, firstGame: null } };
  const boards = parseResult.boards;
  const movesCount = boards.reduce((acc, board) => acc + board.moveList.length, 0);
  const pgnBytes = roundPgn ? Buffer.byteLength(roundPgn, "utf8") : 0;
  const pgnStartsWith = roundPgn ? roundPgn.replace(/\s+/g, " ").trim().slice(0, 40) : "";

  const debugBlock = debug
    ? {
        urls: {
          tournament: `${LICHESS_BROADCAST_BASE}/${encodeURIComponent(tournamentId)}`,
          roundPgn: pgnUrlUsed,
        },
        timingsMs: {
          tournament: tournamentResult.debug?.timingsMs.tournament ?? null,
          roundPgn: roundTiming,
        },
        counts: {
          rounds: snapshot.rounds.length,
          boards: boards.length,
          moves: movesCount,
        },
        roundUrlUsed,
        pgnUrlUsed,
        httpStatus: roundHttpStatus,
        contentType: roundContentType,
        pgnBytes,
        pgnStartsWith,
        gamesParsedCount: parseResult.debug.gamesParsedCount,
        firstGame: parseResult.debug.firstGame,
        cache: {
          tournamentHit: Boolean(tournamentResult.debug?.cache?.tournamentHit),
          roundHit: roundCacheHit,
          tournamentAgeMs: tournamentResult.debug?.cache?.tournamentAgeMs ?? null,
          roundAgeMs: roundCacheHit && cachedRound ? Math.max(0, now - cachedRound.cachedAt) : null,
        },
      }
    : undefined;

  return {
    roundsMeta: snapshot.rounds,
    activeRoundId,
    activeRoundIndex: snapshot.activeRoundIndex,
    boards,
    ...(debugBlock ? { debug: debugBlock } : {}),
  };
}
