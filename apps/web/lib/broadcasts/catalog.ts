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
    slug: "worldcup2025",
    title: "World Cup 2025",
    sourceType: "lichessBroadcast",
    lichessBroadcastId: "pYWxUzLr",
    defaultRound: 1,
    isLiveHint: true,
  },
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
  {
    slug: "tata-steel-2026",
    title: "Tata Steel Chess 2026 | Masters",
    sourceType: "lichessBroadcast",
    lichessBroadcastId: "3COxSfdj",
    defaultRound: 1,
    isLiveHint: false,
  },
];

const BROADCAST_SLUG_ALIASES: Record<string, string> = {
  "tata-steel-masters-2026": "tata-steel-2026",
};

export const getBroadcastTournament = (value?: string | null) => {
  const rawSlug = typeof value === "string" ? value.trim().toLowerCase() : "";
  const slug = BROADCAST_SLUG_ALIASES[rawSlug] ?? rawSlug;
  if (!slug) return null;
  return BROADCASTS.find(entry => entry.slug === slug) ?? null;
};
