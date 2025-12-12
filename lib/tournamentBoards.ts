import { formatBoardLabel } from "@/lib/boardContext";

export type BoardContextInfo = {
  label?: string;
  white?: string;
  black?: string;
  status?: string;
  result?: string;
};

export type BoardStatusInfo = {
  statusText?: string;
  resultText?: string;
};

type BoardContextMap = Record<string, BoardContextInfo>;
type TournamentBoardContextConfig = Record<string, BoardContextMap>;

const scopedCache = new Map<string, BoardContextMap | null>();
let globalCache: TournamentBoardContextConfig | null | undefined;
const boardListCache = new Map<string, string[] | null>();

export function getBoardContext(
  tournamentId?: string | null,
  boardId?: string | null
): BoardContextInfo | null {
  const tId = sanitizeInput(tournamentId);
  const bId = sanitizeInput(boardId);
  if (!tId || !bId) {
    return null;
  }

  const scoped = readScopedContextMap(tId);
  const scopedMatch = resolveBoardContext(scoped, bId);
  if (scopedMatch) return scopedMatch;

  const globalConfig = readGlobalContextConfig();
  if (!globalConfig) return null;
  const tournamentContexts = resolveTournamentContext(globalConfig, tId);
  if (!tournamentContexts) return null;
  return resolveBoardContext(tournamentContexts, bId);
}

export function getTournamentBoardIds(tournamentId?: string | null): string[] | null {
  const normalized = sanitizeInput(tournamentId);
  if (!normalized) return null;
  const cacheKey = normalized.toLowerCase();
  if (boardListCache.has(cacheKey)) {
    return boardListCache.get(cacheKey) ?? null;
  }
  const boards = readBoardsFromEnv(normalized);
  boardListCache.set(cacheKey, boards);
  return boards;
}

export function getBoardPlayers(
  tournamentId?: string | null,
  boardId?: string | null
): { white?: string; black?: string } {
  const context = getBoardContext(tournamentId, boardId);
  if (!context) return {};
  const white = sanitizeInput(context.white);
  const black = sanitizeInput(context.black);
  const result: { white?: string; black?: string } = {};
  if (white) result.white = white;
  if (black) result.black = black;
  return result;
}

export function getBoardStatus(
  tournamentId?: string | null,
  boardId?: string | null
): BoardStatusInfo {
  const context = getBoardContext(tournamentId, boardId);
  if (!context) return {};
  const status = sanitizeInput(context.status);
  const result = sanitizeInput(context.result);
  const info: BoardStatusInfo = {};
  if (status) {
    const friendly = mapStatusLabel(status);
    if (friendly) info.statusText = friendly;
  }
  if (result) {
    info.resultText = result;
  }
  return info;
}

export function formatBoardStatusLabel(status?: BoardStatusInfo | null) {
  if (!status) return null;
  if (status.statusText && status.resultText) {
    return `${status.statusText} • ${status.resultText}`;
  }
  if (status.statusText) return status.statusText;
  if (status.resultText) return `Result: ${status.resultText}`;
  return null;
}

export function getTournamentBoardOptions(tournamentId?: string | null) {
  const boards = getTournamentBoardIds(tournamentId);
  if (!boards || boards.length === 0) return null;
  return boards.map(boardId => ({
    boardId,
    label: formatBoardLabel(boardId),
  }));
}

function readScopedContextMap(tournamentId: string): BoardContextMap | null {
  const cacheKey = normalizeKeySegment(tournamentId);
  if (scopedCache.has(cacheKey)) {
    return scopedCache.get(cacheKey) ?? null;
  }
  const envNames = [
    `NEXT_PUBLIC_TOURNAMENT_${cacheKey}_BOARD_CONTEXTS`,
    `TOURNAMENT_${cacheKey}_BOARD_CONTEXTS`,
  ];
  const raw = envNames
    .map(name => process.env[name])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (!raw) {
    scopedCache.set(cacheKey, null);
    return null;
  }
  const parsed = parseBoardContextMap(raw);
  scopedCache.set(cacheKey, parsed);
  return parsed;
}

function readGlobalContextConfig(): TournamentBoardContextConfig | null {
  if (globalCache !== undefined) {
    return globalCache;
  }
  const envNames = [
    "NEXT_PUBLIC_TOURNAMENT_BOARD_CONTEXTS_JSON",
    "TOURNAMENT_BOARD_CONTEXTS_JSON",
  ];
  const raw = envNames
    .map(name => process.env[name])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (!raw) {
    globalCache = null;
    return null;
  }
  globalCache = parseTournamentBoardContextConfig(raw);
  return globalCache;
}

function resolveTournamentContext(
  config: TournamentBoardContextConfig,
  tournamentId: string
) {
  const candidates = buildTournamentKeyCandidates(tournamentId);
  for (const key of candidates) {
    if (key && config[key]) {
      return config[key];
    }
  }
  return null;
}

function resolveBoardContext(map: BoardContextMap | null, boardId: string) {
  if (!map) return null;
  const candidates = buildBoardKeyCandidates(boardId);
  for (const key of candidates) {
    if (key && map[key]) {
      return map[key];
    }
  }
  return null;
}

function parseBoardContextMap(raw: string): BoardContextMap | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return toBoardContextMap(parsed);
  } catch {
    return null;
  }
}

function parseTournamentBoardContextConfig(
  raw: string
): TournamentBoardContextConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const result: TournamentBoardContextConfig = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const map = toBoardContextMap(value);
      if (map) {
        result[key] = map;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function toBoardContextMap(input: unknown): BoardContextMap | null {
  if (!input || typeof input !== "object") return null;
  const record: BoardContextMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const context = coerceBoardContext(value);
    if (context) {
      record[key] = context;
    }
  }
  return Object.keys(record).length > 0 ? record : null;
}

function coerceBoardContext(value: unknown): BoardContextInfo | null {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { label } : null;
  }
  if (!value || typeof value !== "object") return null;
  const context: BoardContextInfo = {};
  const record = value as {
    label?: unknown;
    white?: unknown;
    black?: unknown;
    status?: unknown;
    result?: unknown;
  };
  if (typeof record.label === "string") {
    const label = record.label.trim();
    if (label) context.label = label;
  }
  if (typeof record.white === "string") {
    const white = record.white.trim();
    if (white) context.white = white;
  }
  if (typeof record.black === "string") {
    const black = record.black.trim();
    if (black) context.black = black;
  }
  if (typeof record.status === "string") {
    const status = record.status.trim();
    if (status) context.status = status;
  }
  if (typeof record.result === "string") {
    const result = record.result.trim();
    if (result) context.result = result;
  }
  return Object.keys(context).length > 0 ? context : null;
}

function sanitizeInput(value?: string | null) {
  if (!value) return "";
  return value.trim();
}

function normalizeKeySegment(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function buildTournamentKeyCandidates(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const candidates = [
    trimmed,
    trimmed.toLowerCase(),
    trimmed.replace(/\s+/g, "-").toLowerCase(),
    encodeURIComponent(trimmed),
    normalizeKeySegment(trimmed),
  ];
  return Array.from(new Set(candidates));
}

function buildBoardKeyCandidates(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const candidates = [
    trimmed,
    trimmed.toLowerCase(),
    trimmed.replace(/\s+/g, "-").toLowerCase(),
    normalizeKeySegment(trimmed),
  ];
  return Array.from(new Set(candidates));
}

function readBoardsFromEnv(tournamentId: string): string[] | null {
  const normalizedId = sanitizeInput(tournamentId);
  const scopedKey = `TOURNAMENT_${normalizeKeySegment(normalizedId)}_BOARDS`;
  const scoped = process.env[scopedKey];
  if (scoped) {
    const parsed = parseBoardListString(scoped);
    if (parsed && parsed.length > 0) return parsed;
  }

  const jsonRaw = process.env.TOURNAMENT_BOARDS_JSON;
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (Array.isArray(parsed)) {
        const sanitized = sanitizeBoardIds(parsed);
        if (sanitized && sanitized.length > 0) return sanitized;
      } else if (parsed && typeof parsed === "object") {
        const mapping = parsed as Record<string, unknown>;
        const lowerKey = normalizedId.toLowerCase();
        const camelKey = normalizedId.replace(/\s+/g, "-").toLowerCase();
        const candidate =
          mapping[normalizedId] ??
          mapping[lowerKey] ??
          mapping[camelKey] ??
          mapping[normalizeKeySegment(normalizedId)];
        if (candidate) {
          const sanitizedCandidate = Array.isArray(candidate)
            ? sanitizeBoardIds(candidate)
            : parseBoardListString(String(candidate));
          if (sanitizedCandidate && sanitizedCandidate.length > 0) {
            return sanitizedCandidate;
          }
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const globalRaw = process.env.TOURNAMENT_BOARDS;
  if (globalRaw) {
    const parsed = parseBoardListString(globalRaw);
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  }

  return null;
}

function sanitizeBoardIds(values: unknown): string[] | null {
  if (values === undefined || values === null) return null;
  const seen = new Set<string>();
  const visit = (input: unknown) => {
    if (input === null || input === undefined) return;
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    const str = String(input).trim();
    if (!str) return;
    seen.add(str);
  };
  visit(values);
  return seen.size > 0 ? Array.from(seen) : null;
}

function parseBoardListString(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return sanitizeBoardIds(parsed);
      }
      if (parsed && typeof parsed === "object") {
        const aggregated = Object.values(parsed as Record<string, unknown>);
        return sanitizeBoardIds(aggregated);
      }
    } catch {
      // Ignore malformed JSON and fall back to CSV parsing below.
    }
  }
  const parts = trimmed
    .split(/[,;\n\r]+/)
    .map(part => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? Array.from(new Set(parts)) : null;
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In progress",
  finished: "Finished",
  upcoming: "Upcoming",
};

function mapStatusLabel(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return STATUS_LABELS[normalized] ?? value.trim();
}
