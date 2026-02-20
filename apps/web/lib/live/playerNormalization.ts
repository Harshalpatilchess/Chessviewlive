import type { DgtBoardPlayer } from "@/lib/live/dgtPayload";

type PlayerSide = "white" | "black";

type NameSource = NonNullable<DgtBoardPlayer["nameSource"]>;

type PlayerMetadata = {
  title?: string | null;
  rating?: number | null;
  federation?: string | null;
  country?: string | null;
  flag?: string | null;
};

type NormalizePlayerOptions = {
  side: PlayerSide;
  sideValue?: unknown;
  aliasName?: unknown;
  aliasMetadata?: PlayerMetadata;
  manifest?: PlayerMetadata & { name?: string | null };
  pgn?: string | null;
  allowManifestFallback?: boolean;
};

export type NormalizeBoardPlayersOptions = {
  white?: unknown;
  black?: unknown;
  whiteName?: unknown;
  blackName?: unknown;
  whiteTitle?: unknown;
  blackTitle?: unknown;
  whiteRating?: unknown;
  blackRating?: unknown;
  whiteFederation?: unknown;
  blackFederation?: unknown;
  whiteCountry?: unknown;
  blackCountry?: unknown;
  whiteFlag?: unknown;
  blackFlag?: unknown;
  pgn?: string | null;
  manifestWhite?: PlayerMetadata & { name?: string | null };
  manifestBlack?: PlayerMetadata & { name?: string | null };
  allowManifestFallback?: boolean;
};

const NAME_SOURCES = new Set<NameSource>(["direct", "first+last", "pgn", "manifest", "unknown"]);

const PLACEHOLDER_PLAYER_NAMES = new Set([
  "?",
  "unknown",
  "white player",
  "black player",
  "tbd",
]);

const DIRECT_NAME_KEYS = ["name", "fullName", "displayName", "username", "playerName"] as const;
const FIRST_NAME_KEYS = ["firstName", "fname", "givenName", "first"] as const;
const LAST_NAME_KEYS = ["lastName", "lname", "familyName", "last"] as const;

const TITLE_KEYS = ["title", "fideTitle"] as const;
const RATING_KEYS = ["rating", "elo", "fideRating", "fideElo"] as const;
const FEDERATION_KEYS = ["federation", "fed", "fideFederation"] as const;
const COUNTRY_KEYS = ["country", "countryCode", "nation", "nat"] as const;
const FLAG_KEYS = ["flag", "flagEmoji", "emoji", "countryFlag"] as const;

type NameCandidate = {
  name: string | null;
  source: NameSource | null;
  placeholder: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toCleanString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : null;
  }
  return null;
};

const getIgnoreCase = (record: Record<string, unknown>, key: string): unknown => {
  if (key in record) return record[key];
  const lowerKey = key.toLowerCase();
  const matched = Object.keys(record).find(candidate => candidate.toLowerCase() === lowerKey);
  return matched ? record[matched] : undefined;
};

const getStringFromKeys = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = toCleanString(getIgnoreCase(record, key));
    if (value) return value;
  }
  return null;
};

const getIntFromKeys = (record: Record<string, unknown>, keys: readonly string[]): number | null => {
  for (const key of keys) {
    const value = toPositiveInt(getIgnoreCase(record, key));
    if (value != null) return value;
  }
  return null;
};

const toNameSource = (value: unknown): NameSource | null => {
  const normalized = toCleanString(value)?.toLowerCase() as NameSource | undefined;
  if (!normalized) return null;
  return NAME_SOURCES.has(normalized) ? normalized : null;
};

const parsePgnTag = (pgn: string | null | undefined, tag: "White" | "Black"): string | null => {
  if (typeof pgn !== "string" || !pgn.trim()) return null;
  const matcher = new RegExp(`^\\[${tag}\\s+\"([^\"]+)\"\\]$`, "im");
  const match = pgn.match(matcher);
  return match?.[1] ? match[1].trim() : null;
};

export const isPlaceholderPlayerName = (value?: string | null): boolean => {
  const normalized = toCleanString(value)?.toLowerCase();
  if (!normalized) return true;
  return PLACEHOLDER_PLAYER_NAMES.has(normalized);
};

const readNameCandidate = (value: unknown): NameCandidate => {
  const directString = toCleanString(value);
  if (directString) {
    if (!isPlaceholderPlayerName(directString)) {
      return { name: directString, source: "direct", placeholder: null };
    }
    return { name: null, source: null, placeholder: directString };
  }

  if (!isRecord(value)) {
    return { name: null, source: null, placeholder: null };
  }

  const explicitSource = toNameSource(getIgnoreCase(value, "nameSource"));

  const directNamed = getStringFromKeys(value, DIRECT_NAME_KEYS);
  if (directNamed) {
    if (!isPlaceholderPlayerName(directNamed)) {
      return {
        name: directNamed,
        source: explicitSource && explicitSource !== "unknown" ? explicitSource : "direct",
        placeholder: null,
      };
    }
    return { name: null, source: null, placeholder: directNamed };
  }

  const first = getStringFromKeys(value, FIRST_NAME_KEYS);
  const last = getStringFromKeys(value, LAST_NAME_KEYS);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) {
    if (!isPlaceholderPlayerName(combined)) {
      return {
        name: combined,
        source: explicitSource && explicitSource !== "unknown" ? explicitSource : "first+last",
        placeholder: null,
      };
    }
    return { name: null, source: null, placeholder: combined };
  }

  return { name: null, source: null, placeholder: null };
};

const readMetadata = (value: unknown): PlayerMetadata => {
  if (!isRecord(value)) return {};

  const title = getStringFromKeys(value, TITLE_KEYS);
  const rating = getIntFromKeys(value, RATING_KEYS);
  const federation = getStringFromKeys(value, FEDERATION_KEYS);
  const country = getStringFromKeys(value, COUNTRY_KEYS);
  const flag = getStringFromKeys(value, FLAG_KEYS);

  return {
    ...(title ? { title } : {}),
    ...(rating != null ? { rating } : {}),
    ...(federation ? { federation } : {}),
    ...(country ? { country } : {}),
    ...(flag ? { flag } : {}),
  };
};

const buildAliasMetadata = (options: NormalizeBoardPlayersOptions, side: PlayerSide): PlayerMetadata => {
  if (side === "white") {
    return {
      title: toCleanString(options.whiteTitle),
      rating: toPositiveInt(options.whiteRating),
      federation: toCleanString(options.whiteFederation),
      country: toCleanString(options.whiteCountry),
      flag: toCleanString(options.whiteFlag),
    };
  }

  return {
    title: toCleanString(options.blackTitle),
    rating: toPositiveInt(options.blackRating),
    federation: toCleanString(options.blackFederation),
    country: toCleanString(options.blackCountry),
    flag: toCleanString(options.blackFlag),
  };
};

const normalizePlayer = (options: NormalizePlayerOptions): DgtBoardPlayer => {
  const {
    side,
    sideValue,
    aliasName,
    aliasMetadata,
    manifest,
    pgn,
    allowManifestFallback = true,
  } = options;

  const sideCandidate = readNameCandidate(sideValue);
  const aliasCandidate = readNameCandidate(aliasName);

  const pgnName = parsePgnTag(pgn, side === "white" ? "White" : "Black");
  const validPgnName = pgnName && !isPlaceholderPlayerName(pgnName) ? pgnName : null;

  const manifestName = toCleanString(manifest?.name ?? null);
  const validManifestName = manifestName && !isPlaceholderPlayerName(manifestName) ? manifestName : null;

  const missingReasonFromSide = isRecord(sideValue)
    ? toCleanString(getIgnoreCase(sideValue, "missingReason"))
    : null;

  const placeholders = [sideCandidate.placeholder, aliasCandidate.placeholder].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  let name = sideCandidate.name ?? aliasCandidate.name;
  let nameSource: NameSource = sideCandidate.source ?? aliasCandidate.source ?? "unknown";

  if (!name && validPgnName) {
    name = validPgnName;
    nameSource = "pgn";
  }

  if (!name && allowManifestFallback && validManifestName) {
    name = validManifestName;
    nameSource = "manifest";
  }

  if (!name) {
    name = "Unknown";
    nameSource = "unknown";
  }

  const sideMetadata = readMetadata(sideValue);
  const mergedTitle = sideMetadata.title ?? aliasMetadata?.title ?? manifest?.title ?? null;
  const mergedRating = sideMetadata.rating ?? aliasMetadata?.rating ?? manifest?.rating ?? null;
  const mergedFederation =
    sideMetadata.federation ?? aliasMetadata?.federation ?? manifest?.federation ?? null;
  const mergedCountry = sideMetadata.country ?? aliasMetadata?.country ?? manifest?.country ?? null;
  const mergedFlag = sideMetadata.flag ?? aliasMetadata?.flag ?? manifest?.flag ?? null;

  const missingReason =
    nameSource === "unknown"
      ? missingReasonFromSide ??
        (placeholders.length > 0
          ? `placeholder ${side} name '${placeholders[0]}'`
          : `missing ${side} name field`)
      : null;

  return {
    name,
    nameSource,
    ...(mergedTitle ? { title: mergedTitle } : {}),
    ...(mergedRating != null ? { rating: mergedRating } : {}),
    ...(mergedFederation ? { federation: mergedFederation } : {}),
    ...(mergedCountry ? { country: mergedCountry } : {}),
    ...(mergedFlag ? { flag: mergedFlag } : {}),
    ...(missingReason ? { missingReason } : {}),
  };
};

export const normalizeBoardPlayers = (options: NormalizeBoardPlayersOptions) => {
  const allowManifestFallback = options.allowManifestFallback !== false;

  const white = normalizePlayer({
    side: "white",
    sideValue: options.white,
    aliasName: options.whiteName,
    aliasMetadata: buildAliasMetadata(options, "white"),
    manifest: options.manifestWhite,
    pgn: options.pgn,
    allowManifestFallback,
  });

  const black = normalizePlayer({
    side: "black",
    sideValue: options.black,
    aliasName: options.blackName,
    aliasMetadata: buildAliasMetadata(options, "black"),
    manifest: options.manifestBlack,
    pgn: options.pgn,
    allowManifestFallback,
  });

  return {
    white,
    black,
    whiteName: white.name,
    blackName: black.name,
  };
};

export const readPlayerNameFromBoardSide = (value: unknown): string | null => {
  const candidate = readNameCandidate(value);
  return candidate.name ?? null;
};
