import "server-only";

const LCC_BASE_URL = "https://1.pool.livechesscloud.com/get";
const PROBE_CACHE_TTL_MS = 4000;
const MAX_CONCURRENCY = 5;

type LiveChessCloudBoardState = {
  boardNo: number;
  whiteName: string;
  blackName: string;
  status?: string | null;
  result?: string | null;
  moveList: string[];
  sourceMeta: {
    fenSource: "livechesscloud";
    upstreamRound: number;
    upstreamGameId: string;
    lastFetchMs: number;
  };
};

type LiveChessCloudProbePayload = {
  tournamentId: string;
  round: number;
  boards: LiveChessCloudBoardState[];
};

type LiveChessCloudProbeDebug = {
  urls: {
    tournament: string;
    roundIndex: string;
    games: string[];
  };
  timingsMs: {
    tournament: number | null;
    roundIndex: number | null;
    games: {
      total: number;
      max: number;
      avg: number;
    };
  };
  counts: {
    gamesListed: number;
    gamesFetched: number;
    gamesFailed: number;
    boardsReturned: number;
    movesTotal: number;
  };
  cache?: {
    hit: boolean;
    ageMs: number;
    ttlMs: number;
  };
};

type FetchTiming = {
  ok: boolean;
  status: number;
  elapsedMs: number;
  json: unknown | null;
};

type CachedProbe = {
  payload: LiveChessCloudProbePayload;
  debug: LiveChessCloudProbeDebug;
  cachedAt: number;
  expiresAt: number;
};

const probeCache = new Map<string, CachedProbe>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeName = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  const direct = ["name", "player", "fullName", "shortName"].find(
    key => typeof value[key] === "string" && value[key]
  );
  if (direct) return String(value[direct]).trim();
  const first =
    typeof value.firstName === "string"
      ? value.firstName
      : typeof value.givenName === "string"
        ? value.givenName
        : "";
  const last =
    typeof value.lastName === "string"
      ? value.lastName
      : typeof value.familyName === "string"
        ? value.familyName
        : "";
  const combined = `${first} ${last}`.trim();
  return combined;
};

const buildTournamentUrl = (tournamentId: string) =>
  `${LCC_BASE_URL}/${encodeURIComponent(tournamentId)}/tournament.json`;

const buildRoundIndexUrl = (tournamentId: string, round: number) =>
  `${LCC_BASE_URL}/${encodeURIComponent(tournamentId)}/round-${round}/index.json`;

const buildGameUrl = (tournamentId: string, round: number, gameId: string) =>
  `${LCC_BASE_URL}/${encodeURIComponent(tournamentId)}/round-${round}/game-${gameId}.json?poll`;

const fetchJson = async (url: string): Promise<FetchTiming> => {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store" });
    const status = response.status;
    let json: unknown | null = null;
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

const extractGamesList = (indexJson: unknown): unknown[] => {
  if (!isRecord(indexJson)) return [];
  const directArrays = ["games", "pairings", "boards"];
  for (const key of directArrays) {
    const value = indexJson[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) return Object.values(value);
  }
  if (isRecord(indexJson.round)) {
    const roundValue = indexJson.round;
    for (const key of directArrays) {
      const value = roundValue[key];
      if (Array.isArray(value)) return value;
      if (isRecord(value)) return Object.values(value);
    }
  }
  return [];
};

const resolveStatus = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
};

const resolveResult = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
};

const normalizeGameId = (value: unknown, fallback: number): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(fallback);
};

const extractSanMovesFromText = (text: string): string[] => {
  const tokens: string[] = [];
  const normalized = text
    .replace(/\r?\n/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ");
  const rawTokens = normalized.split(/\s+/);

  for (const raw of rawTokens) {
    if (!raw) continue;
    let token = raw.trim();
    if (!token) continue;
    token = token.replace(/^\d+\.(\.\.)?/, "");
    token = token.replace(/^\.+/, "");
    token = token.replace(/[!?]+$/g, "");
    token = token.replace(/(?:\d+:\d+(?::\d+)?|\d+\.\d+)$/g, "");
    if (!token) continue;
    if (token === "1-0" || token === "0-1" || token === "1/2-1/2" || token === "*") continue;
    if (/^\d+\.{1,3}$/.test(token)) continue;
    if (/^\d+$/.test(token)) continue;
    if (token.startsWith("0-0-0")) token = token.replace(/^0-0-0/, "O-O-O");
    if (token.startsWith("0-0")) token = token.replace(/^0-0/, "O-O");
    if (!/[a-hKQRNBO]/.test(token)) continue;
    tokens.push(token);
  }

  return tokens;
};

const extractSanMoves = (value: unknown): string[] => {
  if (typeof value === "string") {
    return extractSanMovesFromText(value);
  }
  if (!Array.isArray(value)) return [];
  const moves: string[] = [];
  value.forEach(item => {
    if (typeof item === "string") {
      moves.push(...extractSanMovesFromText(item));
      return;
    }
    if (!isRecord(item)) return;
    const candidate =
      typeof item.san === "string"
        ? item.san
        : typeof item.move === "string"
          ? item.move
          : typeof item.notation === "string"
            ? item.notation
            : null;
    if (candidate) {
      moves.push(...extractSanMovesFromText(candidate));
    }
  });
  return moves;
};

const extractMovesFromGame = (gameJson: unknown): string[] => {
  if (!isRecord(gameJson)) return [];
  if (Array.isArray(gameJson.moves)) return extractSanMoves(gameJson.moves);
  if (typeof gameJson.moves === "string") return extractSanMoves(gameJson.moves);
  if (Array.isArray(gameJson.moveList)) return extractSanMoves(gameJson.moveList);
  if (typeof gameJson.moveList === "string") return extractSanMoves(gameJson.moveList);
  if (typeof gameJson.pgn === "string") return extractSanMoves(gameJson.pgn);
  if (typeof gameJson.pgnText === "string") return extractSanMoves(gameJson.pgnText);
  if (typeof gameJson.san === "string") return extractSanMoves(gameJson.san);
  if (Array.isArray(gameJson.san)) return extractSanMoves(gameJson.san);
  return [];
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
};

export async function probeLiveChessCloud(options: {
  tournamentId: string;
  round: number;
  limit: number;
  debug?: boolean;
}): Promise<{ payload: LiveChessCloudProbePayload; debug: LiveChessCloudProbeDebug; cacheHit: boolean }> {
  const { tournamentId, round, limit } = options;
  const cacheKey = `${tournamentId}:${round}:${limit}`;
  const now = Date.now();
  const cached = probeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const debug = {
      ...cached.debug,
      cache: {
        hit: true,
        ageMs: Math.max(0, now - cached.cachedAt),
        ttlMs: PROBE_CACHE_TTL_MS,
      },
    };
    return { payload: cached.payload, debug, cacheHit: true };
  }

  const tournamentUrl = buildTournamentUrl(tournamentId);
  const roundUrl = buildRoundIndexUrl(tournamentId, round);
  const [tournamentFetch, roundFetch] = await Promise.all([fetchJson(tournamentUrl), fetchJson(roundUrl)]);
  if (!tournamentFetch.ok || !roundFetch.ok || !roundFetch.json) {
    const debug: LiveChessCloudProbeDebug = {
      urls: {
        tournament: tournamentUrl,
        roundIndex: roundUrl,
        games: [],
      },
      timingsMs: {
        tournament: tournamentFetch.ok ? tournamentFetch.elapsedMs : null,
        roundIndex: roundFetch.ok ? roundFetch.elapsedMs : null,
        games: { total: 0, max: 0, avg: 0 },
      },
      counts: {
        gamesListed: 0,
        gamesFetched: 0,
        gamesFailed: 0,
        boardsReturned: 0,
        movesTotal: 0,
      },
      cache: {
        hit: false,
        ageMs: 0,
        ttlMs: PROBE_CACHE_TTL_MS,
      },
    };
    const error = new Error("lcc_upstream_unavailable");
    (error as Error & { debug?: LiveChessCloudProbeDebug }).debug = debug;
    throw error;
  }

  const gamesList = extractGamesList(roundFetch.json);
  const cappedGames = gamesList.slice(0, Math.max(1, limit));
  const gameDescriptors = cappedGames.map((raw, idx) => {
    const record = isRecord(raw) ? raw : {};
    const gameId = normalizeGameId(record.gameId ?? record.id ?? record.game ?? record.no, idx + 1);
    const boardNo = coerceNumber(record.board ?? record.boardNo ?? record.table ?? record.boardNumber ?? record.no) ?? idx + 1;
    const whiteName = normalizeName(record.white ?? record.White ?? record.playerWhite);
    const blackName = normalizeName(record.black ?? record.Black ?? record.playerBlack);
    const status = resolveStatus(record.status ?? record.state);
    const result = resolveResult(record.result ?? record.score);
    return { gameId, boardNo, whiteName, blackName, status, result };
  });

  const gameUrls = gameDescriptors.map(game => buildGameUrl(tournamentId, round, game.gameId));
  const gameTimings: number[] = [];
  let gamesFailed = 0;
  let movesTotal = 0;

  const boards = await runWithConcurrency(gameDescriptors, MAX_CONCURRENCY, async (game, idx) => {
    const url = gameUrls[idx];
    const gameFetch = await fetchJson(url);
    gameTimings.push(gameFetch.elapsedMs);
    if (!gameFetch.ok) {
      gamesFailed += 1;
    }
    const moves = extractMovesFromGame(gameFetch.json);
    movesTotal += moves.length;
    const metaFetchMs = Date.now();
    const gameRecord = isRecord(gameFetch.json) ? gameFetch.json : null;
    const status = resolveStatus(gameRecord?.status ?? gameRecord?.state) ?? game.status;
    const result = resolveResult(gameRecord?.result ?? gameRecord?.score) ?? game.result;
    return {
      boardNo: game.boardNo,
      whiteName: game.whiteName,
      blackName: game.blackName,
      status,
      result,
      moveList: moves,
      sourceMeta: {
        fenSource: "livechesscloud",
        upstreamRound: round,
        upstreamGameId: game.gameId,
        lastFetchMs: metaFetchMs,
      },
    } satisfies LiveChessCloudBoardState;
  });

  const totalGameMs = gameTimings.reduce((acc, value) => acc + value, 0);
  const maxGameMs = gameTimings.reduce((acc, value) => Math.max(acc, value), 0);
  const avgGameMs = gameTimings.length ? totalGameMs / gameTimings.length : 0;

  const payload: LiveChessCloudProbePayload = {
    tournamentId,
    round,
    boards,
  };
  const debug: LiveChessCloudProbeDebug = {
    urls: {
      tournament: tournamentUrl,
      roundIndex: roundUrl,
      games: gameUrls,
    },
    timingsMs: {
      tournament: tournamentFetch.elapsedMs,
      roundIndex: roundFetch.elapsedMs,
      games: {
        total: Math.round(totalGameMs),
        max: Math.round(maxGameMs),
        avg: Math.round(avgGameMs),
      },
    },
    counts: {
      gamesListed: gamesList.length,
      gamesFetched: gameDescriptors.length,
      gamesFailed,
      boardsReturned: boards.length,
      movesTotal,
    },
    cache: {
      hit: false,
      ageMs: 0,
      ttlMs: PROBE_CACHE_TTL_MS,
    },
  };

  probeCache.set(cacheKey, {
    payload,
    debug,
    cachedAt: now,
    expiresAt: now + PROBE_CACHE_TTL_MS,
  });

  return { payload, debug, cacheHit: false };
}
