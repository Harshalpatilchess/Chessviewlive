import { isEngineProfileId, type EngineProfileId } from "./config";

const STORAGE_KEY = "chessviewlive.engineProfile";
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

// Backwards-compatible aliases for callers still using the old naming.
export const getSavedStrengthProfile = getSavedEngineProfileId;
export const saveStrengthProfile = saveEngineProfileId;
