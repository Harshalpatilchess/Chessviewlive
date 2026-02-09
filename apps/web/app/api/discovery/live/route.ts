import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const UPSTREAM_PATH = "/broadcast";
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const LIVE_SECTION_CUTOFF = "past broadcasts";
const IS_DEV = process.env.NODE_ENV !== "production";

type ProviderRef = {
  tournamentSlug: string;
  roundSlug: string;
  roundId: string;
};

type LiveItem = {
  tournament: {
    slug: string;
    name: string;
  };
  current: {
    kind: "live";
    round: {
      id: string;
      slug: string;
      name: string;
    };
  };
};

type LiveResponse = {
  source: "discovery";
  fetchedAt: string;
  items: LiveItem[];
  error: "upstream_fetch_failed" | "upstream_fetch_failed_served_stale" | "missing_upstream_origin" | null;
  debug?: {
    stage?: string;
    hasStaleCache?: boolean;
    errorCode?: "dns" | "tls" | "timeout" | "unknown";
    envPresentBroadcastOrigin?: boolean;
    envPresentDiscoveryOrigin?: boolean;
    runtime?: "nodejs" | "unknown";
    upstreamStatus?: number;
    reason?: string;
    cachedAgeMs?: number;
  };
};

type CacheEntry = {
  fetchedAtMs: number;
  payload: LiveResponse;
};

type FetchResult = {
  payload: LiveResponse;
  meta: {
    upstreamStatus?: number;
    errorCode?: "dns" | "tls" | "timeout" | "unknown";
  };
};

let cacheEntry: CacheEntry | null = null;
let inflight: Promise<FetchResult> | null = null;

const getUpstreamUrl = () => {
  const broadcastOrigin = process.env.BROADCAST_UPSTREAM_ORIGIN?.trim() ?? "";
  const discoveryOrigin = process.env.DISCOVERY_UPSTREAM_ORIGIN?.trim() ?? "";
  const upstreamOrigin = broadcastOrigin || discoveryOrigin;
  if (!upstreamOrigin) return null;
  try {
    return new URL(UPSTREAM_PATH, upstreamOrigin).toString();
  } catch {
    return null;
  }
};

const extractLiveSection = (html: string) => {
  const lower = html.toLowerCase();
  const cutoffIndex = lower.indexOf(LIVE_SECTION_CUTOFF);
  if (cutoffIndex === -1) return html;
  return html.slice(0, cutoffIndex);
};

const parseLiveItems = (html: string): ProviderRef[] => {
  const liveSection = extractLiveSection(html);
  const anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const items: ProviderRef[] = [];

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(liveSection)) !== null) {
    const href = match[1];
    const hrefMatch = href.match(/^\/broadcast\/([^\/]+)\/(round-[^\/]+)\/([^\/?#"]+)$/);
    if (!hrefMatch) continue;

    const [, tournamentSlug, roundSlug, roundId] = hrefMatch;
    const dedupeKey = `${tournamentSlug}/${roundSlug}/${roundId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    items.push({
      tournamentSlug,
      roundSlug,
      roundId,
    });
  }

  return items;
};

const buildResponse = (payload: LiveResponse) => NextResponse.json(payload, { status: 200 });

const withDebug = (payload: LiveResponse, debug?: LiveResponse["debug"]) => {
  if (!IS_DEV || !debug) return payload;
  const broadcastOrigin = process.env.BROADCAST_UPSTREAM_ORIGIN?.trim() ?? "";
  const discoveryOrigin = process.env.DISCOVERY_UPSTREAM_ORIGIN?.trim() ?? "";
  const runtimeValue: "nodejs" | "unknown" = runtime === "nodejs" ? "nodejs" : "unknown";
  return {
    ...payload,
    debug: {
      envPresentBroadcastOrigin: Boolean(broadcastOrigin),
      envPresentDiscoveryOrigin: Boolean(discoveryOrigin),
      runtime: runtimeValue,
      ...debug,
    },
  };
};

const humanizeSlug = (slug: string) => {
  const withEmDash = slug.replace(/--/g, " — ");
  const withSpaces = withEmDash.replace(/-/g, " ");
  const collapsed = withSpaces.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map(token => {
      if (!token) return "";
      const isAllCaps = token === token.toUpperCase() && /[A-Z]/.test(token);
      if (isAllCaps) return token;
      const lower = token.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .filter(Boolean)
    .join(" ");
};

const normalizeDisplayName = (value: string) => {
  return value
    .replace(/—/g, " - ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
};

const buildDisplayItems = (refs: ProviderRef[]) => {
  const seenTournaments = new Set<string>();
  const items: LiveItem[] = [];

  for (const ref of refs) {
    const { tournamentSlug, roundSlug, roundId } = ref;
    if (!tournamentSlug || !roundSlug || !roundId) {
      if (IS_DEV) {
        console.warn("[discovery.live] Malformed slugs detected", { tournamentSlug, roundSlug, roundId });
      }
      continue;
    }
    if (seenTournaments.has(tournamentSlug)) continue;
    seenTournaments.add(tournamentSlug);

    const tournamentName = normalizeDisplayName(humanizeSlug(tournamentSlug));
    const roundName = normalizeDisplayName(humanizeSlug(roundSlug));

    if (IS_DEV && (!tournamentName || !roundName)) {
      console.warn("[discovery.live] Empty display name from slug", { tournamentSlug, roundSlug });
    }

    items.push({
      tournament: {
        slug: tournamentSlug,
        name: tournamentName || tournamentSlug,
      },
      current: {
        kind: "live",
        round: {
          id: roundId,
          slug: roundSlug,
          name: roundName || roundSlug,
        },
      },
    });
  }

  return items;
};

const getErrorCode = (error: unknown): "dns" | "tls" | "timeout" | "unknown" => {
  if (!error || typeof error !== "object") return "unknown";
  const maybeError = error as { name?: string; code?: string; cause?: { code?: string } };
  if (maybeError.name === "AbortError") return "timeout";
  const code = maybeError.code ?? maybeError.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (typeof code === "string" && (code.startsWith("ERR_TLS") || code.includes("TLS"))) return "tls";
  return "unknown";
};

const fetchLiveBroadcasts = async (upstreamUrl: string): Promise<FetchResult> => {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "chessviewlive/1.0",
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      if (IS_DEV) {
        console.debug("[discovery.live] Upstream non-OK", { status: res.status });
      }
      return {
        payload: {
          source: "discovery",
          fetchedAt,
          items: [],
          error: "upstream_fetch_failed",
        },
        meta: { upstreamStatus: res.status },
      };
    }

    const html = await res.text();
    const refs = parseLiveItems(html);
    const items = buildDisplayItems(refs);
    return {
      payload: { source: "discovery", fetchedAt, items, error: null },
      meta: {},
    };
  } catch (error) {
    if (IS_DEV) {
      console.debug("[discovery.live] Upstream fetch error", error);
    }
    return {
      payload: {
        source: "discovery",
        fetchedAt,
        items: [],
        error: "upstream_fetch_failed",
      },
      meta: { errorCode: getErrorCode(error) },
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

export async function GET() {
  const now = Date.now();
  const cachedAgeMs = cacheEntry ? now - cacheEntry.fetchedAtMs : undefined;
  const hasStaleCache = Boolean(cacheEntry && cachedAgeMs !== undefined && cachedAgeMs >= CACHE_TTL_MS);

  if (cacheEntry && cachedAgeMs !== undefined && cachedAgeMs < CACHE_TTL_MS) {
    return buildResponse(
      withDebug(cacheEntry.payload, {
        stage: "cache_fresh",
        hasStaleCache: false,
        cachedAgeMs,
      }),
    );
  }

  const upstreamUrl = getUpstreamUrl();
  if (!upstreamUrl) {
    return buildResponse(
      withDebug(
        {
          source: "discovery",
          fetchedAt: new Date().toISOString(),
          items: [],
          error: "missing_upstream_origin",
        },
        {
          stage: "missing_origin",
          hasStaleCache,
          cachedAgeMs,
          reason: "missing_upstream_origin",
        },
      ),
    );
  }

  if (!inflight) {
    inflight = fetchLiveBroadcasts(upstreamUrl).finally(() => {
      inflight = null;
    });
  }

  const { payload, meta } = await inflight;
  if (payload.error === null) {
    cacheEntry = { fetchedAtMs: Date.now(), payload };
    return buildResponse(
      withDebug(payload, {
        stage: "fetch_success",
        hasStaleCache: false,
        cachedAgeMs: 0,
      }),
    );
  }

  if (cacheEntry) {
    const stalePayload: LiveResponse = {
      ...cacheEntry.payload,
      error: "upstream_fetch_failed_served_stale",
    };
    return buildResponse(
      withDebug(stalePayload, {
        stage: "serve_stale",
        hasStaleCache: true,
        cachedAgeMs,
        errorCode: meta.errorCode,
        upstreamStatus: meta.upstreamStatus,
        reason: "fetch_failed_served_stale",
      }),
    );
  }

  return buildResponse(
    withDebug(payload, {
      stage: "fetch_failed",
      hasStaleCache: false,
      errorCode: meta.errorCode,
      upstreamStatus: meta.upstreamStatus,
      reason: "fetch_failed",
    }),
  );
}
