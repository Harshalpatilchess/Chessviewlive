export const MINI_BOARD_CLOCK_PLACEHOLDER = "--:--";

export type ClockUnit = "ms" | "seconds";

export const normalizeClockValueToMs = (
  value?: number | null,
  unit: ClockUnit = "ms"
): number | null => {
  if (!Number.isFinite(value ?? NaN)) return null;
  const numeric = Math.max(0, Number(value));
  if (unit === "seconds") {
    return Math.floor(numeric * 1000);
  }
  return Math.floor(numeric);
};

export const formatMiniBoardClockMs = (value?: number | null): string => {
  if (!Number.isFinite(value ?? NaN)) return MINI_BOARD_CLOCK_PLACEHOLDER;
  const totalSeconds = Math.max(0, Math.floor(Number(value) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export const formatMiniBoardClockValue = (
  value?: number | null,
  options: { unit?: ClockUnit } = {}
): string => {
  const normalized = normalizeClockValueToMs(value, options.unit ?? "ms");
  return formatMiniBoardClockMs(normalized);
};
