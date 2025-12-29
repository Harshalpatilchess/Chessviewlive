export const DEFAULT_TIME_TROUBLE_MS = 2 * 60 * 1000;

export function formatChessClockMs(ms?: number | null): string {
  if (!Number.isFinite(ms ?? NaN) || (ms ?? 0) < 0) return "00:00";
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function isTimeTrouble(
  ms: number | null | undefined,
  options: { enabled?: boolean; timeTroubleMs?: number } = {}
): boolean {
  const enabled = options.enabled ?? true;
  const threshold = Number.isFinite(options.timeTroubleMs ?? NaN) ? Number(options.timeTroubleMs) : DEFAULT_TIME_TROUBLE_MS;
  if (!enabled) return false;
  return Number.isFinite(ms ?? NaN) ? Number(ms) <= threshold : false;
}
