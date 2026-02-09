import type { Metadata } from "next";

type ResultsLeaderboardRow = {
  name: string;
  points?: number | null;
};

type ResultsSeoInput = {
  tournamentName: string;
  slug: string;
  roundLabel?: string | null;
  round?: number | null;
  leaderboard?: ResultsLeaderboardRow[] | null;
};

const buildResultsTitle = (tournamentName: string, roundLabel?: string | null) => {
  const baseTitle = `${tournamentName} Results`;
  if (!roundLabel) return baseTitle;
  return `${baseTitle} \u2022 ${roundLabel}`;
};

const buildResultsDescription = (tournamentName: string) =>
  `Standings and round results for ${tournamentName}.`;

const buildResultsCanonical = (slug: string) => `/broadcast/${encodeURIComponent(slug)}/results`;

const formatPointsValue = (points?: number | null) => {
  if (!Number.isFinite(points ?? NaN)) return null;
  if (Number.isInteger(points)) return String(points);
  return (points as number).toFixed(1);
};

export const buildResultsMetadata = (input: ResultsSeoInput): Metadata => {
  const title = buildResultsTitle(input.tournamentName, input.roundLabel);
  const description = buildResultsDescription(input.tournamentName);
  const canonical = buildResultsCanonical(input.slug);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
    },
  };
};

export const buildResultsJsonLd = (input: ResultsSeoInput) => {
  const title = buildResultsTitle(input.tournamentName, input.roundLabel);
  const url = buildResultsCanonical(input.slug);
  const performers =
    input.leaderboard
      ?.map(player => {
        const points = formatPointsValue(player.points);
        if (!points) return null;
        return {
          "@type": "Person",
          name: player.name,
          description: `Points: ${points}`,
        };
      })
      .filter(Boolean)
      .slice(0, 10) ?? [];

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: title,
    url,
    sport: "Chess",
  };

  if (performers.length > 0) {
    jsonLd.performer = performers;
  }

  return jsonLd;
};
