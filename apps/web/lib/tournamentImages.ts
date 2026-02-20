import { DEFAULT_TOURNAMENT_SLUG, normalizeTournamentSlug } from "@/lib/boardId";
import { TOURNAMENTS } from "@/lib/tournamentCatalog";
import {
  DEFAULT_TOURNAMENT_PLACEHOLDER,
  FLAG_ASSETS,
  TOURNAMENT_ASSET_OVERRIDES,
} from "@/lib/tournamentAssets";

export type TournamentImage = {
  heroImage?: string | null;
  logoImage?: string | null;
  flagCode?: string | null;
  placeholderImage?: string | null;
};

export type TournamentThumbnail = {
  candidates: Array<{ src: string; fit: "cover" | "contain" }>;
};

const normalizeSrc = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const resolveFlagAsset = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return FLAG_ASSETS[normalized] ?? null;
};

export const resolveTournamentThumbnail = (image: TournamentImage): TournamentThumbnail => {
  const heroSrc = normalizeSrc(image.heroImage);
  const logoSrc = normalizeSrc(image.logoImage);
  const flagSrc = resolveFlagAsset(image.flagCode);
  const placeholderSrc =
    normalizeSrc(image.placeholderImage) ?? DEFAULT_TOURNAMENT_PLACEHOLDER;
  const candidates: TournamentThumbnail["candidates"] = [];

  if (heroSrc) candidates.push({ src: heroSrc, fit: "cover" });
  if (logoSrc) candidates.push({ src: logoSrc, fit: "contain" });
  if (flagSrc) candidates.push({ src: flagSrc, fit: "cover" });
  if (placeholderSrc) candidates.push({ src: placeholderSrc, fit: "cover" });

  const dedupedCandidates = candidates.filter(({ src }, index) => {
    return candidates.findIndex(candidate => candidate.src === src) === index;
  });

  return { candidates: dedupedCandidates };
};

export const normalizeTournamentKey = (name: string): string => {
  const normalized = name
    .toLowerCase()
    .replace(/[—–]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.replace(/\b(?:19|20)\d{2}\b$/, "").trim();
};

const curatedImagesBySlug = new Map<string, TournamentImage>();
const curatedImagesByName = new Map<string, TournamentImage>();

TOURNAMENTS.forEach(tournament => {
  const normalizedSlug = normalizeTournamentSlug(tournament.slug, tournament.slug);
  const entry: TournamentImage = {
    heroImage: tournament.heroImage ?? null,
    logoImage: null,
    flagCode: tournament.flagCode ?? null,
    placeholderImage: null,
  };
  curatedImagesBySlug.set(normalizedSlug, entry);

  const normalizedName = normalizeTournamentKey(tournament.name);
  if (normalizedName) {
    curatedImagesByName.set(normalizedName, entry);
  }
});

const tournamentImageOverridesBySlug: Record<string, TournamentImage> = Object.entries(
  TOURNAMENT_ASSET_OVERRIDES
).reduce<Record<string, TournamentImage>>((acc, [slug, override]) => {
  acc[slug] = {
    heroImage: override.banner ?? null,
    logoImage: override.logo ?? null,
    flagCode: override.country ?? null,
    placeholderImage: null,
  };
  return acc;
}, {});

const mergeImages = (...candidates: Array<TournamentImage | null | undefined>) => {
  const merged: TournamentImage = {};

  candidates.forEach(candidate => {
    if (!candidate) return;
    if (candidate.heroImage) merged.heroImage = candidate.heroImage;
    if (candidate.logoImage) merged.logoImage = candidate.logoImage;
    if (candidate.flagCode) merged.flagCode = candidate.flagCode;
    if (candidate.placeholderImage) merged.placeholderImage = candidate.placeholderImage;
  });

  return merged;
};

const hasImageData = (image: TournamentImage) =>
  Boolean(image.heroImage || image.logoImage || image.flagCode || image.placeholderImage);

const withFallbackPlaceholder = (image: TournamentImage): TournamentImage => ({
  ...image,
  placeholderImage: image.placeholderImage ?? DEFAULT_TOURNAMENT_PLACEHOLDER,
});

export const getTournamentImageBySlug = (
  slug?: string | null,
  name?: string | null
): TournamentImage => {
  const normalizedSlug = normalizeTournamentSlug(slug ?? "", DEFAULT_TOURNAMENT_SLUG);
  const slugImage = mergeImages(
    curatedImagesBySlug.get(normalizedSlug),
    tournamentImageOverridesBySlug[normalizedSlug]
  );

  if (hasImageData(slugImage)) {
    return withFallbackPlaceholder(slugImage);
  }

  const normalizedName = typeof name === "string" ? normalizeTournamentKey(name) : "";
  const nameImage = mergeImages(
    normalizedName ? curatedImagesByName.get(normalizedName) : null
  );

  if (hasImageData(nameImage)) {
    return withFallbackPlaceholder(nameImage);
  }

  return withFallbackPlaceholder({});
};
