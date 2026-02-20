import TitleBadge from "@/components/boards/TitleBadge";
import { resolveFlagDisplay } from "@/components/live/Flag";
import type { BoardNavigationPlayer } from "@/lib/boards/navigationTypes";

type BoardPlayerIdentity = Pick<
  BoardNavigationPlayer,
  "name" | "firstName" | "lastName" | "title" | "rating" | "flag" | "federation" | "country"
>;

type ResolvedBoardPlayerFlag = {
  value: string | null;
  source: "flag" | "federation" | "country" | null;
};

type BoardPlayerIdentityInlineProps = {
  player: BoardPlayerIdentity;
  showRating?: boolean;
  debugFlagFallback?: boolean;
  containerClassName?: string;
  flagClassName?: string;
  titleClassName?: string;
  titleCompact?: boolean;
  nameClassName?: string;
  ratingClassName?: string;
};

const toTrimmedString = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toRating = (value?: number | null): number | null => {
  if (!Number.isFinite(Number(value ?? NaN))) return null;
  return Math.trunc(Number(value));
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const resolveBoardPlayerFlag = (
  player?: Pick<BoardNavigationPlayer, "flag" | "federation" | "country"> | null
): ResolvedBoardPlayerFlag => {
  const flag = toTrimmedString(player?.flag);
  if (flag) return { value: flag, source: "flag" };
  const federation = toTrimmedString(player?.federation);
  if (federation) return { value: federation, source: "federation" };
  const country = toTrimmedString(player?.country);
  if (country) return { value: country, source: "country" };
  return { value: null, source: null };
};

const parseLastCommaFirst = (value: string): { first: string; last: string } | null => {
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) return null;
  const last = normalizeWhitespace(value.slice(0, commaIndex));
  const first = normalizeWhitespace(value.slice(commaIndex + 1));
  if (!first || !last) return null;
  return { first, last };
};

const inferFirstLastFromName = (value: string): { first: string | null; last: string | null } => {
  const commaName = parseLastCommaFirst(value);
  if (commaName) return { first: commaName.first, last: commaName.last };

  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: null, last: null };
  if (tokens.length === 1) return { first: tokens[0], last: null };

  return {
    first: tokens.slice(0, -1).join(" "),
    last: tokens[tokens.length - 1],
  };
};

export const resolveBoardPlayerDisplayName = (player: BoardPlayerIdentity): string => {
  const fallbackName = normalizeWhitespace(toTrimmedString(player?.name) ?? "Unknown") || "Unknown";
  const explicitFirst = toTrimmedString(player?.firstName);
  const explicitLast = toTrimmedString(player?.lastName);
  const normalizedFirst = explicitFirst ? normalizeWhitespace(explicitFirst) : null;
  const normalizedLast = explicitLast ? normalizeWhitespace(explicitLast) : null;

  if (normalizedFirst || normalizedLast) {
    const inferred = inferFirstLastFromName(fallbackName);
    const first = normalizedFirst ?? inferred.first;
    const last = normalizedLast ?? inferred.last;
    const combined = normalizeWhitespace([first, last].filter(Boolean).join(" "));
    return combined || fallbackName;
  }

  const commaName = parseLastCommaFirst(fallbackName);
  if (commaName) return `${commaName.first} ${commaName.last}`;
  return fallbackName;
};

export default function BoardPlayerIdentityInline({
  player,
  showRating = true,
  debugFlagFallback = false,
  containerClassName = "flex min-w-0 flex-wrap items-center gap-1",
  flagClassName = "text-[11px] leading-none",
  titleClassName,
  titleCompact = false,
  nameClassName = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  ratingClassName = "text-slate-400",
}: BoardPlayerIdentityInlineProps) {
  const name = resolveBoardPlayerDisplayName(player);
  const rating = toRating(player?.rating);
  const resolvedFlagDisplay = resolveFlagDisplay(player);
  void debugFlagFallback;

  return (
    <div className={containerClassName}>
      {resolvedFlagDisplay.emoji ? (
        <span role="img" aria-label={resolvedFlagDisplay.normalized} className={flagClassName}>
          {resolvedFlagDisplay.display}
        </span>
      ) : null}
      {player?.title ? (
        <TitleBadge title={player.title} compact={titleCompact} className={titleClassName} />
      ) : null}
      <span className={nameClassName}>{name}</span>
      {showRating && rating != null ? <span className={ratingClassName}>{rating}</span> : null}
    </div>
  );
}
