const REPLAY_PROGRESS_PREFIX = "cv_replay_progress_v1";

export function getReplayProgress(recordingId: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  if (!recordingId) return undefined;
  try {
    const key = buildKey(recordingId);
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === undefined) return undefined;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function setReplayProgress(recordingId: string, seconds: number): void {
  if (typeof window === "undefined") return;
  if (!recordingId) return;
  if (!Number.isFinite(seconds) || seconds < 0) return;
  try {
    const key = buildKey(recordingId);
    window.localStorage.setItem(key, seconds.toString());
  } catch {
    // ignore storage errors
  }
}

export function clearReplayProgress(recordingId: string): void {
  if (typeof window === "undefined") return;
  if (!recordingId) return;
  try {
    const key = buildKey(recordingId);
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

function buildKey(recordingId: string) {
  return `${REPLAY_PROGRESS_PREFIX}:${recordingId}`;
}
