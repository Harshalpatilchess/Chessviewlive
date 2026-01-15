import type { BoardNavigationEntry } from "@/lib/boards/navigationTypes";

export const normalizeResultValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "*" || trimmed === "\u00b7") return null;
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.includes("\u00bd")) return "1/2-1/2";
  if (compact === "1/2-1/2") return "1/2-1/2";
  return compact;
};

export const formatBoardResultLabel = (value?: string | null) => {
  const normalized = normalizeResultValue(value);
  if (!normalized) return null;
  return normalized === "1/2-1/2" ? "\u00bd-\u00bd" : normalized;
};

export const getBoardStatusLabel = (entry: BoardNavigationEntry): string => {
  const normalizedResult = normalizeResultValue(entry.result);
  if (entry.status === "final" && normalizedResult) return normalizedResult;
  if (entry.status === "live") return "Live";
  if (entry.status === "scheduled") return "Not started";
  if (!entry.status || entry.status === "unknown") {
    return normalizedResult ?? "Not started";
  }
  return normalizedResult ?? "Not started";
};
