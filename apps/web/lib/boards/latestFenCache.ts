import { Chess } from "chess.js";

export type LatestFenKeyInput = {
  boardId?: string | null;
  tournamentSlug?: string | null;
  round?: number | null;
  boardNumber?: number | null;
};

export type LatestFenEntry = {
  fen: string;
  explicitStart: boolean;
  updatedAt: number;
};

type LatestFenStoragePayload = {
  version: number;
  entries: Array<{
    key: string;
    fen: string;
    explicitStart: boolean;
    updatedAt: number;
  }>;
};

const START_FEN = new Chess().fen();
const STORAGE_KEY = "cv-mini-latest-fen:v1";
const STORAGE_VERSION = 1;
const STORAGE_MAX_ENTRIES = 400;

const LATEST_FEN_CACHE = new Map<string, LatestFenEntry>();
let hydrated = false;
let dirty = false;

const normalizeFen = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBoardId = (value?: string | null) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "";
};

const normalizeTournamentSlug = (value?: string | null) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "";
};

const normalizeRound = (value?: number | null) => {
  if (!Number.isFinite(value ?? NaN)) return null;
  const rounded = Math.floor(Number(value));
  return rounded >= 1 ? rounded : null;
};

const normalizeBoardNumber = (value?: number | null) => {
  if (!Number.isFinite(value ?? NaN)) return null;
  const rounded = Math.floor(Number(value));
  return rounded >= 1 ? rounded : null;
};

const shouldPersistFen = (fen: string, explicitStart: boolean) => !isStartFen(fen) || explicitStart;

export const isStartFen = (fen?: string | null) => normalizeFen(fen) === START_FEN;

export const getStartFen = () => START_FEN;

export const buildTileKey = (input: LatestFenKeyInput): string | null => {
  const boardId = normalizeBoardId(input.boardId);
  if (boardId) return boardId;
  const slug = normalizeTournamentSlug(input.tournamentSlug);
  const round = normalizeRound(input.round);
  const boardNumber = normalizeBoardNumber(input.boardNumber);
  if (!slug || round == null || boardNumber == null) return null;
  return `${slug}-board${round}.${boardNumber}`;
};

const pruneCache = () => {
  if (LATEST_FEN_CACHE.size <= STORAGE_MAX_ENTRIES) return;
  const retained = [...LATEST_FEN_CACHE.entries()]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, STORAGE_MAX_ENTRIES);
  LATEST_FEN_CACHE.clear();
  retained.forEach(([key, entry]) => {
    LATEST_FEN_CACHE.set(key, entry);
  });
};

const persistCache = () => {
  if (typeof window === "undefined") return;
  try {
    pruneCache();
    const payload: LatestFenStoragePayload = {
      version: STORAGE_VERSION,
      entries: [...LATEST_FEN_CACHE.entries()]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, STORAGE_MAX_ENTRIES)
        .map(([key, entry]) => ({
          key,
          fen: entry.fen,
          explicitStart: entry.explicitStart,
          updatedAt: entry.updatedAt,
        })),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort storage only.
  }
};

export const hydrateLatestFenCache = () => {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<LatestFenStoragePayload>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return;
    parsed.entries.slice(0, STORAGE_MAX_ENTRIES).forEach(entry => {
      if (!entry || typeof entry !== "object") return;
      const key = normalizeBoardId((entry as { key?: string }).key);
      if (!key) return;
      const fen = normalizeFen((entry as { fen?: string }).fen);
      if (!fen) return;
      const explicitStart = (entry as { explicitStart?: boolean }).explicitStart === true;
      if (!shouldPersistFen(fen, explicitStart)) return;
      const updatedAtRaw = Number((entry as { updatedAt?: number }).updatedAt);
      const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
      LATEST_FEN_CACHE.set(key, { fen, explicitStart, updatedAt });
    });
    pruneCache();
  } catch {
    // Ignore corrupted data.
  }
};

export const readLatestFen = (input: LatestFenKeyInput): LatestFenEntry | null => {
  hydrateLatestFenCache();
  const key = buildTileKey(input);
  if (!key) return null;
  return LATEST_FEN_CACHE.get(key) ?? null;
};

export const writeLatestFen = (
  input: LatestFenKeyInput,
  fen: string,
  options: { explicitStart?: boolean } = {}
) => {
  hydrateLatestFenCache();
  const key = buildTileKey(input);
  const normalizedFen = normalizeFen(fen);
  if (!key || !normalizedFen) return false;
  const explicitStart = options.explicitStart === true;
  if (!shouldPersistFen(normalizedFen, explicitStart)) return false;

  const next: LatestFenEntry = {
    fen: normalizedFen,
    explicitStart,
    updatedAt: Date.now(),
  };
  const existing = LATEST_FEN_CACHE.get(key);
  if (
    existing &&
    existing.fen === next.fen &&
    existing.explicitStart === next.explicitStart
  ) {
    existing.updatedAt = next.updatedAt;
    LATEST_FEN_CACHE.set(key, existing);
    return true;
  }
  LATEST_FEN_CACHE.set(key, next);
  dirty = true;
  return true;
};

export const flushLatestFenCache = () => {
  if (!dirty) return;
  dirty = false;
  persistCache();
};
