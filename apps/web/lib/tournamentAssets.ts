export type TournamentAssetOverride = {
  banner?: string;
  logo?: string;
  country?: string;
};

export const FLAG_ASSETS: Record<string, string> = {
  am: "/flags/am.svg",
  cn: "/flags/cn.svg",
  gb: "/flags/gb.svg",
  in: "/flags/in.svg",
  nl: "/flags/nl.svg",
  no: "/flags/no.svg",
  qa: "/flags/qa.svg",
  us: "/flags/us.svg",
};

export const DEFAULT_TOURNAMENT_PLACEHOLDER = "/tournaments/placeholder.svg";

export const TOURNAMENT_ASSET_OVERRIDES: Record<string, TournamentAssetOverride> = {
  "2025-chinese-chess-league-division-a": {
    country: "cn",
  },
  "us-championship-2025": {
    banner: "/tournaments/us-championship/hero.webp",
    country: "us",
  },
};
