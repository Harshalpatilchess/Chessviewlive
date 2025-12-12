const SPEED_KEY_PREFIX = "cv_replay_speed_v1";
const GLOBAL_KEY = `${SPEED_KEY_PREFIX}:global`;

export function getReplaySpeed(boardId?: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const keys = buildKeySequence(boardId);
    for (const key of keys) {
      const value = readNumber(key);
      if (typeof value === "number") {
        return value;
      }
    }
  } catch {
    // ignore storage errors
  }
  return undefined;
}

export function setReplaySpeed(speed: number, boardId?: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = buildKey(boardId);
    window.localStorage.setItem(key, String(speed));
  } catch {
    // ignore storage errors
  }
}

function buildKey(boardId?: string) {
  const trimmed = typeof boardId === "string" ? boardId.trim() : "";
  if (trimmed) {
    return `${SPEED_KEY_PREFIX}:${trimmed}`;
  }
  return GLOBAL_KEY;
}

function buildKeySequence(boardId?: string) {
  const keys = [buildKey(boardId)];
  if (boardId && boardId.trim()) {
    keys.push(GLOBAL_KEY);
  }
  return keys;
}

function readNumber(key: string): number | undefined {
  const raw = window.localStorage.getItem(key);
  if (raw === null || raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}
