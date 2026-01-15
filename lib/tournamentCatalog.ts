import { DEFAULT_TOURNAMENT_SLUG, normalizeTournamentSlug } from "@/lib/boardId";

export type TournamentConfig = {
  slug: string;
  name: string;
  round: number;
  heroImage?: string | null;
  placeholderFlag?: string | null;
  defaultFederation?: string | null;
  roundLabel?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  participants?: number;
  timeControl?: string | null;
  location?: string | null;
  topPlayers?: Array<{ name: string; rating: number }>;
};

export const DEFAULT_ROUND = 1;

export const TOURNAMENTS: TournamentConfig[] = [
  {
    slug: DEFAULT_TOURNAMENT_SLUG,
    name: "Worldcup 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 1",
    startsAt: "2025-08-02T12:00:00Z",
    endsAt: "2025-08-30T12:00:00Z",
    participants: 128,
    timeControl: "90+30",
    location: "Goa, IND",
    // Dev check: ensure /tournaments/worldcup2025/hero.jpg exists under /public.
    heroImage: "/tournaments/worldcup2025/hero.jpg",
    topPlayers: [
      { name: "Carlsen", rating: 2830 },
      { name: "Nepomniachtchi", rating: 2778 },
      { name: "Aronian", rating: 2765 },
      { name: "Firouzja", rating: 2760 },
      { name: "Caruana", rating: 2798 },
    ],
  },
  {
    slug: "armenian-championship-highest-league-2026",
    name: "Armenian Championship Highest League 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 1",
    defaultFederation: "ARM",
    startsAt: "2026-01-13T12:00:00Z",
    endsAt: "2026-01-21T12:00:00Z",
    participants: 10,
    timeControl: "90 min/40 moves + 30 min + 30 sec/move",
    location: "Yerevan, Armenia",
    heroImage: "/tournaments/armenian-championship-highest-league-2026/hero.svg",
  },
  {
    slug: "candidates2026",
    name: "Candidates 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 3",
    startsAt: "2026-03-12T14:00:00Z",
    placeholderFlag: "\uD83C\uDDEE\uD83C\uDDF3",
    topPlayers: [
      { name: "Praggnanandhaa", rating: 2766 },
      { name: "Nakamura", rating: 2775 },
      { name: "Abdusattorov", rating: 2768 },
      { name: "So", rating: 2757 },
    ],
  },
  {
    slug: "norway-chess-2026",
    name: "Norway Chess 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 5",
    startsAt: "2026-05-18T12:00:00Z",
    placeholderFlag: "\uD83C\uDDF3\uD83C\uDDF4",
    topPlayers: [
      { name: "Carlsen", rating: 2830 },
      { name: "Firouzja", rating: 2760 },
      { name: "Gukesh", rating: 2765 },
      { name: "Caruana", rating: 2798 },
    ],
  },
  {
    slug: "tata-steel-2026",
    name: "Tata Steel 2026",
    round: DEFAULT_ROUND,
    roundLabel: "Round 7",
    startsAt: "2026-01-20T11:00:00Z",
    placeholderFlag: "\uD83C\uDDF3\uD83C\uDDF1",
    topPlayers: [
      { name: "Ding", rating: 2791 },
      { name: "Nepomniachtchi", rating: 2778 },
      { name: "Wei Yi", rating: 2759 },
      { name: "Aronian", rating: 2765 },
    ],
  },
  {
    slug: "grandprix-2025",
    name: "FIDE Grand Prix 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Stage 2",
    startsAt: "2025-11-02T15:00:00Z",
    placeholderFlag: "\uD83C\uDDFA\uD83C\uDDF8",
    topPlayers: [
      { name: "So", rating: 2757 },
      { name: "Dominguez", rating: 2740 },
      { name: "Aronian", rating: 2765 },
      { name: "Duda", rating: 2750 },
    ],
  },
  {
    slug: "sinquefield-2025",
    name: "Sinquefield Cup 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 4",
    startsAt: "2025-08-20T17:00:00Z",
    placeholderFlag: "\uD83C\uDDFA\uD83C\uDDF8",
    topPlayers: [
      { name: "Caruana", rating: 2798 },
      { name: "Nakamura", rating: 2775 },
      { name: "So", rating: 2757 },
      { name: "Aronian", rating: 2765 },
    ],
  },
  {
    slug: "us-championship-2025",
    name: "US Championship 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 6",
    startsAt: "2025-10-05T16:00:00Z",
    placeholderFlag: "\uD83C\uDDFA\uD83C\uDDF8",
    topPlayers: [
      { name: "Nakamura", rating: 2775 },
      { name: "So", rating: 2757 },
      { name: "Sevian", rating: 2715 },
      { name: "Xiong", rating: 2705 },
    ],
  },
  {
    slug: "india-open-2025",
    name: "India Open 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 2",
    startsAt: "2025-09-12T09:00:00Z",
    placeholderFlag: "\uD83C\uDDEE\uD83C\uDDF3",
    topPlayers: [
      { name: "Gukesh", rating: 2765 },
      { name: "Arjun", rating: 2751 },
      { name: "Vidit", rating: 2736 },
      { name: "Praggnanandhaa", rating: 2766 },
    ],
  },
  {
    slug: "qatar-masters-2025",
    name: "Qatar Masters 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Round 8",
    startsAt: "2025-12-01T10:00:00Z",
    placeholderFlag: "\uD83C\uDDF6\uD83C\uDDE6",
    topPlayers: [
      { name: "Mamedyarov", rating: 2746 },
      { name: "Firouzja", rating: 2760 },
      { name: "Carlsen", rating: 2830 },
      { name: "Aronian", rating: 2765 },
    ],
  },
  {
    slug: "speed-chess-2025",
    name: "Speed Chess 2025",
    round: DEFAULT_ROUND,
    roundLabel: "Stage 1",
    startsAt: "2025-07-28T18:00:00Z",
    placeholderFlag: "\uD83C\uDDEC\uD83C\uDDE7",
    topPlayers: [
      { name: "Nakamura", rating: 2775 },
      { name: "Carlsen", rating: 2830 },
      { name: "Firouzja", rating: 2760 },
      { name: "So", rating: 2757 },
    ],
  },
];

export const getTournamentConfig = (value?: string | null) => {
  const normalized = normalizeTournamentSlug(value ?? "", DEFAULT_TOURNAMENT_SLUG);
  return TOURNAMENTS.find(tournament => tournament.slug === normalized) ?? null;
};
