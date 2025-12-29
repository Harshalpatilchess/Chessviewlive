import { isEngineProfileId, type EngineProfileId } from "./config";

const STORAGE_KEY = "chessviewlive.engineProfile";
const STORAGE_MULTI_PV_KEY = "chessviewlive.engineMultiPv";
const LEGACY_KEYS = ["cv:engine:strengthProfile"];

function readProfileFromStorage(key: string): EngineProfileId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (isEngineProfileId(raw)) return raw;
  } catch {
    // ignore storage errors
  }
  return null;
}

export function getSavedEngineProfileId(): EngineProfileId | null {
  const primary = readProfileFromStorage(STORAGE_KEY);
  if (primary) return primary;

  for (const key of LEGACY_KEYS) {
    const legacy = readProfileFromStorage(key);
    if (legacy) return legacy;
  }
  return null;
}

export function saveEngineProfileId(profile: EngineProfileId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // ignore storage errors
  }
}

function clampMultiPv(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(3, Math.round(value)));
}

export function getSavedEngineMultiPv(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_MULTI_PV_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampMultiPv(parsed) : null;
  } catch {
    // ignore storage errors
  }
  return null;
}

export function saveEngineMultiPv(value: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_MULTI_PV_KEY, String(clampMultiPv(value)));
  } catch {
    // ignore storage errors
  }
}

// Backwards-compatible aliases for callers still using the old naming.
export const getSavedStrengthProfile = getSavedEngineProfileId;
export const saveStrengthProfile = saveEngineProfileId;
