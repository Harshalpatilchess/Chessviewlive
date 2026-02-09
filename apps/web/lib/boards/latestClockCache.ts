import { buildTileKey, type LatestFenKeyInput } from "@/lib/boards/latestFenCache";

export type LatestClockSource = "live_payload" | "broadcast_payload" | "replay_endpoint" | "replay_input";

export type LatestClockEntry = {
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  source: LatestClockSource;
  updatedAt: number;
};

type LatestClockStoragePayload = {
  version: number;
  entries: Array<{
    key: string;
    whiteTimeMs: number | null;
    blackTimeMs: number | null;
    source: LatestClockSource;
    updatedAt: number;
  }>;
};

const STORAGE_KEY = "cv-mini-latest-clock:v2";
const STORAGE_VERSION = 2;
const STORAGE_MAX_ENTRIES = 400;

const LATEST_CLOCK_CACHE = new Map<string, LatestClockEntry>();
let hydrated = false;
let dirty = false;

const normalizeClockMs = (value?: number | null): number | null => {
  if (!Number.isFinite(value ?? NaN)) return null;
  return Math.max(0, Math.floor(Number(value)));
};

const normalizeClockSource = (value?: unknown): LatestClockSource | null => {
  if (value === "live_payload") return "live_payload";
  if (value === "broadcast_payload") return "broadcast_payload";
  if (value === "replay_endpoint") return "replay_endpoint";
  if (value === "replay_input") return "replay_input";
  return null;
};

export const isReplayClockSource = (value?: LatestClockSource | null): boolean =>
  value === "replay_endpoint" || value === "replay_input";

const hasClockValue = (whiteTimeMs: number | null, blackTimeMs: number | null) =>
  Number.isFinite(whiteTimeMs ?? NaN) || Number.isFinite(blackTimeMs ?? NaN);

const pruneCache = () => {
  if (LATEST_CLOCK_CACHE.size <= STORAGE_MAX_ENTRIES) return;
  const retained = [...LATEST_CLOCK_CACHE.entries()]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, STORAGE_MAX_ENTRIES);
  LATEST_CLOCK_CACHE.clear();
  retained.forEach(([key, entry]) => {
    LATEST_CLOCK_CACHE.set(key, entry);
  });
};

const persistCache = () => {
  if (typeof window === "undefined") return;
  try {
    pruneCache();
    const payload: LatestClockStoragePayload = {
      version: STORAGE_VERSION,
      entries: [...LATEST_CLOCK_CACHE.entries()]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, STORAGE_MAX_ENTRIES)
        .map(([key, entry]) => ({
          key,
          whiteTimeMs: entry.whiteTimeMs,
          blackTimeMs: entry.blackTimeMs,
          source: entry.source,
          updatedAt: entry.updatedAt,
        })),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort storage only.
  }
};

export const hydrateLatestClockCache = () => {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<LatestClockStoragePayload>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return;
    parsed.entries.slice(0, STORAGE_MAX_ENTRIES).forEach(entry => {
      if (!entry || typeof entry !== "object") return;
      const key =
        typeof (entry as { key?: string }).key === "string"
          ? ((entry as { key?: string }).key as string).trim()
          : "";
      if (!key) return;
      const whiteTimeMs = normalizeClockMs((entry as { whiteTimeMs?: number | null }).whiteTimeMs);
      const blackTimeMs = normalizeClockMs((entry as { blackTimeMs?: number | null }).blackTimeMs);
      const source = normalizeClockSource((entry as { source?: unknown }).source);
      if (!hasClockValue(whiteTimeMs, blackTimeMs)) return;
      if (!source) return;
      const updatedAtRaw = Number((entry as { updatedAt?: number }).updatedAt);
      const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
      LATEST_CLOCK_CACHE.set(key, { whiteTimeMs, blackTimeMs, source, updatedAt });
    });
    pruneCache();
  } catch {
    // Ignore corrupted data.
  }
};

export const readLatestClock = (input: LatestFenKeyInput): LatestClockEntry | null => {
  hydrateLatestClockCache();
  const key = buildTileKey(input);
  if (!key) return null;
  return LATEST_CLOCK_CACHE.get(key) ?? null;
};

export const writeLatestClock = (
  input: LatestFenKeyInput,
  values: { whiteTimeMs?: number | null; blackTimeMs?: number | null; source: LatestClockSource }
) => {
  hydrateLatestClockCache();
  const key = buildTileKey(input);
  if (!key) return false;
  const whiteTimeMs = normalizeClockMs(values.whiteTimeMs);
  const blackTimeMs = normalizeClockMs(values.blackTimeMs);
  const source = normalizeClockSource(values.source);
  if (!hasClockValue(whiteTimeMs, blackTimeMs)) return false;
  if (!source) return false;

  const next: LatestClockEntry = {
    whiteTimeMs,
    blackTimeMs,
    source,
    updatedAt: Date.now(),
  };
  const existing = LATEST_CLOCK_CACHE.get(key);
  if (
    existing &&
    existing.whiteTimeMs === next.whiteTimeMs &&
    existing.blackTimeMs === next.blackTimeMs &&
    existing.source === next.source
  ) {
    existing.updatedAt = next.updatedAt;
    LATEST_CLOCK_CACHE.set(key, existing);
    return true;
  }
  LATEST_CLOCK_CACHE.set(key, next);
  dirty = true;
  return true;
};

export const flushLatestClockCache = () => {
  if (!dirty) return;
  dirty = false;
  persistCache();
};
