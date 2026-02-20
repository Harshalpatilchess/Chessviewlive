import type { DgtBoardPlayer } from "@/lib/live/dgtPayload";
import { getTournamentRoster } from "@/lib/tournaments/rosters";

type PlayerMetaSource = NonNullable<DgtBoardPlayer["__metaSource"]>;

type EnrichPlayerFromRosterOptions = {
  debug?: boolean;
};

const PLACEHOLDER_PLAYER_METADATA = new Set([
  "-",
  "--",
  "?",
  "??",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

const toTrimmedString = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeMetadataCode = (value?: string | null): string | null => {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return null;
  if (PLACEHOLDER_PLAYER_METADATA.has(trimmed.toLowerCase())) return null;
  return trimmed.toUpperCase();
};

const hasMissingMetadata = (value?: string | null): boolean => normalizeMetadataCode(value) == null;

const hasUsableMetadata = (value?: string | null): boolean => !hasMissingMetadata(value);

export const normalizePlayerNameKey = (value?: string | null): string => {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return "";
  return trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const tokenizeNameKey = (value: string): string[] =>
  value
    .split(" ")
    .map(token => token.trim())
    .filter(Boolean);

const isInitialLikeToken = (token: string): boolean => token.length <= 2;

const tokensMatch = (left: string, right: string): boolean => {
  if (left === right) return true;
  if (left.length === 1) return right.startsWith(left);
  if (right.length === 1) return left.startsWith(right);
  return false;
};

const hasTokenCoverage = (requiredTokens: string[], availableTokens: string[]): boolean => {
  if (requiredTokens.length === 0 || availableTokens.length === 0) return false;
  const used = new Set<number>();
  for (const requiredToken of requiredTokens) {
    const matchIndex = availableTokens.findIndex(
      (availableToken, idx) => !used.has(idx) && tokensMatch(requiredToken, availableToken)
    );
    if (matchIndex < 0) return false;
    used.add(matchIndex);
  }
  return true;
};

const hasLooseTokenCoverage = (leftTokens: string[], rightTokens: string[]): boolean => {
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  // Avoid overly broad one-token fuzzy matches.
  if (Math.min(leftTokens.length, rightTokens.length) < 2) return false;
  return hasTokenCoverage(leftTokens, rightTokens) || hasTokenCoverage(rightTokens, leftTokens);
};

const buildTokenVariants = (tokens: string[]): string[][] => {
  const variants: string[][] = [tokens];
  const withoutInitials = tokens.filter(token => !isInitialLikeToken(token));
  if (withoutInitials.length > 0 && withoutInitials.length !== tokens.length) {
    variants.push(withoutInitials);
  }
  return variants;
};

const isLooseNameMatch = (leftKey: string, rightKey: string): boolean => {
  const leftTokens = tokenizeNameKey(leftKey);
  const rightTokens = tokenizeNameKey(rightKey);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const leftVariants = buildTokenVariants(leftTokens);
  const rightVariants = buildTokenVariants(rightTokens);
  return leftVariants.some(leftVariant =>
    rightVariants.some(rightVariant => hasLooseTokenCoverage(leftVariant, rightVariant))
  );
};

const resolveMetaSource = (player: DgtBoardPlayer, usedRoster: boolean): PlayerMetaSource => {
  if (usedRoster) return "roster";
  if (
    hasUsableMetadata(player.flag) ||
    hasUsableMetadata(player.federation) ||
    hasUsableMetadata(player.country)
  ) {
    return "upstream";
  }
  return "missing";
};

export const enrichPlayerFromRoster = (
  slug: string,
  player: DgtBoardPlayer,
  options?: EnrichPlayerFromRosterOptions
): DgtBoardPlayer => {
  const debug = options?.debug === true;
  const upstreamHasGap =
    hasMissingMetadata(player.flag) ||
    hasMissingMetadata(player.country) ||
    hasMissingMetadata(player.federation);
  const finalize = (next: DgtBoardPlayer, usedRoster: boolean): DgtBoardPlayer => {
    if (!debug) {
      const { __metaSource, ...withoutMetaSource } = next;
      void __metaSource;
      return withoutMetaSource;
    }
    return {
      ...next,
      __metaSource: resolveMetaSource(next, usedRoster),
    };
  };

  if (!upstreamHasGap) {
    return finalize(player, false);
  }

  const roster = getTournamentRoster(slug);
  if (!roster || !Array.isArray(roster.players) || roster.players.length === 0) {
    return finalize(player, false);
  }

  const nameKey = normalizePlayerNameKey(player.name);
  if (!nameKey) {
    return finalize(player, false);
  }

  const rosterMatch =
    roster.players.find(entry => {
      const rosterNameKey = normalizePlayerNameKey(entry?.name ?? null);
      if (!rosterNameKey) return false;
      if (rosterNameKey === nameKey) return true;
      return isLooseNameMatch(rosterNameKey, nameKey);
    }) ?? null;
  if (!rosterMatch) {
    return finalize(player, false);
  }

  const rosterCountry = normalizeMetadataCode(rosterMatch.country2 ?? null);
  const rosterFederation =
    normalizeMetadataCode(rosterMatch.federation3 ?? null) ?? rosterCountry;

  let usedRoster = false;
  const nextPlayer: DgtBoardPlayer = { ...player };

  if (hasMissingMetadata(nextPlayer.country) && rosterCountry) {
    nextPlayer.country = rosterCountry;
    usedRoster = true;
  }

  if (hasMissingMetadata(nextPlayer.federation) && rosterFederation) {
    nextPlayer.federation = rosterFederation;
    usedRoster = true;
  }

  if (hasMissingMetadata(nextPlayer.flag) && rosterCountry) {
    nextPlayer.flag = rosterCountry;
    usedRoster = true;
  }

  return finalize(nextPlayer, usedRoster);
};
