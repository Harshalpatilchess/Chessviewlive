type FlagProps = {
  country: string;
  className?: string;
};

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

const toFlagEmoji = (iso2: string) => {
  if (!/^[A-Z]{2}$/.test(iso2)) {
    return null;
  }
  const base = 0x1f1e6;
  const chars = Array.from(iso2).map(char => base + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...chars);
};

const Flag = ({ country, className }: FlagProps) => {
  const normalized = country.trim().toUpperCase();
  const iso2 = normalized.length === 2 ? normalized : ISO3_TO_ISO2[normalized];
  const emoji = iso2 ? toFlagEmoji(iso2) : null;

  if (!emoji) {
    return (
      <span className={className} aria-hidden>
        {normalized || ""}
      </span>
    );
  }

  return (
    <span role="img" aria-label={normalized} className={className}>
      {emoji}
    </span>
  );
};

export default Flag;
