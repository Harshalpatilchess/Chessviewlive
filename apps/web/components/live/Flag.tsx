type FlagProps = {
  country: string;
  className?: string;
};

export type FlagSourceValue = {
  flag?: string | null;
  federation?: string | null;
  country?: string | null;
};

export type ResolvedFlagDisplay = {
  sourceValue: string | null;
  normalized: string;
  emoji: string | null;
  display: string;
  isUnknown: boolean;
};

// Non-exhaustive mapping used for 3-letter federation/country codes seen in feeds.
const ISO3_TO_ISO2: Record<string, string> = {
  AFG: "AF",
  ALB: "AL",
  ALG: "DZ",
  AND: "AD",
  ANG: "AO",
  ARG: "AR",
  ARM: "AM",
  AUS: "AU",
  AUT: "AT",
  AZE: "AZ",
  BAN: "BD",
  BEL: "BE",
  BEN: "BJ",
  BHR: "BH",
  BOL: "BO",
  BIH: "BA",
  BLR: "BY",
  BOT: "BW",
  BRA: "BR",
  BRN: "BN",
  BUL: "BG",
  CAN: "CA",
  CHI: "CL",
  CHN: "CN",
  COL: "CO",
  CRC: "CR",
  CRO: "HR",
  CYP: "CY",
  CZE: "CZ",
  DEN: "DK",
  DJI: "DJ",
  ECU: "EC",
  EGY: "EG",
  ENG: "GB",
  EST: "EE",
  ETH: "ET",
  FIN: "FI",
  FRA: "FR",
  GEO: "GE",
  GER: "DE",
  GRE: "GR",
  HKG: "HK",
  HUN: "HU",
  IND: "IN",
  INA: "ID",
  IRI: "IR",
  IRL: "IE",
  ISL: "IS",
  ISR: "IL",
  ITA: "IT",
  JAM: "JM",
  JPN: "JP",
  KAZ: "KZ",
  KEN: "KE",
  KGZ: "KG",
  KOR: "KR",
  KSA: "SA",
  KUW: "KW",
  LAT: "LV",
  LBN: "LB",
  LIE: "LI",
  LTU: "LT",
  LUX: "LU",
  MAD: "MG",
  MAR: "MA",
  MAS: "MY",
  MDA: "MD",
  MEX: "MX",
  MGL: "MN",
  MKD: "MK",
  MNE: "ME",
  MOZ: "MZ",
  NED: "NL",
  NEP: "NP",
  NGA: "NG",
  NOR: "NO",
  NZL: "NZ",
  PER: "PE",
  PHI: "PH",
  POL: "PL",
  POR: "PT",
  QAT: "QA",
  ROU: "RO",
  RSA: "ZA",
  RUS: "RU",
  SCO: "GB",
  SGP: "SG",
  SRB: "RS",
  SUI: "CH",
  SVK: "SK",
  SLO: "SI",
  ESP: "ES",
  SWE: "SE",
  TUR: "TR",
  TUN: "TN",
  UGA: "UG",
  UKR: "UA",
  URU: "UY",
  USA: "US",
  UZB: "UZ",
  VEN: "VE",
  VIE: "VN",
  WAL: "GB",
};

const toTrimmedString = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const iso2ToFlagEmoji = (alpha2: string): string | null => {
  const normalized = toTrimmedString(alpha2)?.toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  const base = 0x1f1e6;
  const chars = Array.from(normalized).map(char => base + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...chars);
};

const iso3ToIso2 = (alpha3: string): string | null => {
  const normalized = toTrimmedString(alpha3)?.toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return ISO3_TO_ISO2[normalized] ?? null;
};

const isRegionalIndicator = (codePoint: number): boolean =>
  codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;

const isFlagEmojiLiteral = (value: string): boolean => {
  const chars = Array.from(value);
  if (chars.length !== 2) return false;
  return chars.every(char => {
    const codePoint = char.codePointAt(0);
    return codePoint != null && isRegionalIndicator(codePoint);
  });
};

const isFlagSourceValue = (value: unknown): value is FlagSourceValue =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const resolveSourceValue = (input: string | FlagSourceValue | null | undefined): string | null => {
  if (typeof input === "string") {
    return toTrimmedString(input);
  }
  if (!isFlagSourceValue(input)) return null;
  return toTrimmedString(input.flag) ?? toTrimmedString(input.federation) ?? toTrimmedString(input.country) ?? null;
};

export const resolveFlagEmoji = (
  country: string
): { normalized: string; emoji: string | null } => {
  const trimmed = toTrimmedString(country);
  if (!trimmed) return { normalized: "", emoji: null };
  if (isFlagEmojiLiteral(trimmed)) {
    return { normalized: trimmed, emoji: trimmed };
  }
  const normalized = trimmed.toUpperCase();
  if (normalized.length === 2) {
    return { normalized, emoji: iso2ToFlagEmoji(normalized) };
  }
  if (normalized.length === 3) {
    const iso2 = iso3ToIso2(normalized);
    return { normalized, emoji: iso2 ? iso2ToFlagEmoji(iso2) : null };
  }
  return { normalized, emoji: null };
};

export const resolveFlagDisplay = (
  input: string | FlagSourceValue | null | undefined
): ResolvedFlagDisplay => {
  const sourceValue = resolveSourceValue(input);
  if (!sourceValue) {
    return {
      sourceValue: null,
      normalized: "",
      emoji: null,
      display: "",
      isUnknown: true,
    };
  }

  const { normalized, emoji } = resolveFlagEmoji(sourceValue);
  if (emoji) {
    return {
      sourceValue,
      normalized,
      emoji,
      display: emoji,
      isUnknown: false,
    };
  }

  return {
    sourceValue,
    normalized,
    emoji: null,
    display: "",
    isUnknown: true,
  };
};

const Flag = ({ country, className }: FlagProps) => {
  const resolved = resolveFlagDisplay(country);

  if (!resolved.emoji) {
    return null;
  }

  return (
    <span role="img" aria-label={resolved.normalized} className={className}>
      {resolved.display}
    </span>
  );
};

export default Flag;
