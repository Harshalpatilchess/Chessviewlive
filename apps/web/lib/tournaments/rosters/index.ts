import tataSteelMasters2026Roster from "@/lib/tournaments/rosters/tata-steel-masters-2026.json";

export type TournamentRosterPlayer = {
  name: string;
  country2?: string;
  federation3?: string;
};

export type TournamentRoster = {
  sourceUrl: string;
  updatedAt: string;
  players: TournamentRosterPlayer[];
};

const ROSTER_SLUG_ALIASES: Record<string, string> = {
  "tata-steel-2026": "tata-steel-masters-2026",
};

const TOURNAMENT_ROSTERS: Record<string, TournamentRoster> = {
  "tata-steel-masters-2026": tataSteelMasters2026Roster as TournamentRoster,
};

const normalizeSlug = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

const resolveRosterSlug = (value?: string | null): string => {
  const normalized = normalizeSlug(value);
  if (!normalized) return "";
  return ROSTER_SLUG_ALIASES[normalized] ?? normalized;
};

export const getTournamentRoster = (slug?: string | null): TournamentRoster | null => {
  const resolved = resolveRosterSlug(slug);
  if (!resolved) return null;
  return TOURNAMENT_ROSTERS[resolved] ?? null;
};
