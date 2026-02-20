export type PlayerDisplayInput = {
  name?: string | null;
  fullName?: string | null;
  username?: string | null;
  rating?: number | string | null;
  elo?: number | string | null;
  title?: string | null;
  flag?: string | null;
  federation?: string | null;
  country?: string | null;
};

const toCleanString = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const toFlagEmoji = (iso2: string): string | null => {
  if (!/^[A-Z]{2}$/.test(iso2)) return null;
  const base = 0x1f1e6;
  const chars = Array.from(iso2).map(char => base + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...chars);
};

const resolveFlag = (player?: PlayerDisplayInput | null): string | null => {
  if (!player) return null;
  const rawFlag =
    toCleanString(player.flag) ||
    toCleanString(player.federation) ||
    toCleanString(player.country);
  if (!rawFlag) return null;
  const upper = rawFlag.toUpperCase();
  const emoji = toFlagEmoji(upper);
  return emoji ?? upper;
};

const resolveTitle = (player?: PlayerDisplayInput | null): string | null => {
  if (!player) return null;
  const title = toCleanString(player.title);
  return title ? title.toUpperCase() : null;
};

const resolveName = (player?: PlayerDisplayInput | null): string => {
  if (!player) return "Unknown";
  const name =
    toCleanString(player.name) ||
    toCleanString(player.fullName) ||
    toCleanString(player.username);
  return name || "Unknown";
};

const resolveRating = (player?: PlayerDisplayInput | null): string | null => {
  if (!player) return null;
  const raw = player.rating ?? player.elo;
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(Math.trunc(raw)) : null;
  }
  const normalized = toCleanString(raw);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? String(Math.trunc(parsed)) : null;
};

export const formatPlayerDisplay = (player?: PlayerDisplayInput | null): string => {
  const parts: string[] = [];
  const flag = resolveFlag(player);
  const title = resolveTitle(player);
  const name = resolveName(player);
  const rating = resolveRating(player);

  if (flag) parts.push(flag);
  if (title) parts.push(title);
  parts.push(name);
  if (rating) parts.push(rating);

  return parts.join(" • ");
};
