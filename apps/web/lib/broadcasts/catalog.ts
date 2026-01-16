export type BroadcastTournament = {
  slug: string;
  title: string;
  sourceType: "livechesscloud" | "lichessBroadcast";
  tournamentId?: string;
  lichessBroadcastId?: string;
  defaultRound: number;
  isLiveHint: boolean;
};

export const BROADCASTS: BroadcastTournament[] = [
  {
    slug: "armenian-championship-highest-league-2026",
    title: "Armenian Championship Highest League 2026",
    sourceType: "lichessBroadcast",
    lichessBroadcastId: "SAYAMr6W",
    defaultRound: 1,
    isLiveHint: false,
  },
  {
    slug: "2025-chinese-chess-league-division-a",
    title: "2025 Chinese Chess League Division A — Relegation Playoffs",
    sourceType: "lichessBroadcast",
    lichessBroadcastId: "ff2A5Qzo",
    defaultRound: 1,
    isLiveHint: true,
  },
];

export const getBroadcastTournament = (value?: string | null) => {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return null;
  return BROADCASTS.find(entry => entry.slug === slug) ?? null;
};
