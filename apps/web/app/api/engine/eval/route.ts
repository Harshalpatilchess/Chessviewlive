import { NextResponse } from "next/server";
import { CLOUD_ENGINE_URL, ENGINE_DISPLAY_NAME, type CloudEngineRequest, type CloudEngineResponse } from "@/lib/engine/config";

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const readNumberEnv = (key: string, fallback: number, min: number, max: number): number => {
  const raw = typeof process !== "undefined" ? process.env[key] : undefined;
  const parsed = typeof raw === "string" ? Number(raw) : NaN;
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return clampNumber(resolved, min, max);
};

const DEFAULT_DEV_ENGINE_URL = "http://localhost:4000/engine/eval";
const FAST_DEPTH = 12;
const REFINE_DEPTH_MIN = 20;
const REFINE_DEPTH_MAX = 30;
const LITE_MOVETIME_MS = readNumberEnv("ENGINE_LITE_MOVETIME_MS", 220, 80, 600);
const LITE_THREADS = readNumberEnv("ENGINE_LITE_THREADS", 1, 1, 2);
const LITE_HASH_MB = readNumberEnv("ENGINE_LITE_HASH_MB", 64, 16, 256);
const DEBUG_ENGINE_LOGS = typeof process !== "undefined" && process.env.DEBUG_ENGINE_LOGS === "true";
const FAST_MOVETIME_MS = (() => {
  const raw = typeof process !== "undefined" ? process.env.ENGINE_FAST_MOVETIME_MS : undefined;
  const parsed = typeof raw === "string" ? Number(raw) : NaN;
  const resolved = Number.isFinite(parsed) ? Math.floor(parsed) : 250;
  return clampNumber(resolved, 200, 300);
})();

const CACHE_TTL_MS = readNumberEnv("ENGINE_EVAL_CACHE_TTL_MS", 10000, 0, 60000);
const MIN_REEVAL_MS = readNumberEnv("ENGINE_EVAL_MIN_REEVAL_MS", 1200, 0, 10000);
const CACHE_MAX_ENTRIES = Math.round(readNumberEnv("ENGINE_EVAL_CACHE_MAX_ENTRIES", 256, 16, 2000));

type CacheEntry = {
  payload: CloudEngineResponse;
  fetchedAt: number;
};

type EngineDebugMeta = {
  source: "cache" | "upstream";
  cacheHit: boolean;
  upstreamOk: boolean;
  upstreamStatus: number | "error";
  engineHost?: string;
};

type UpstreamResult =
  | { ok: true; payload: CloudEngineResponse; status: number }
  | { ok: false; status: number | "error"; errorMessage: string };

const evalCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<UpstreamResult>>();

const normalizeFen = (fen: string) => fen.trim().split(/\s+/).join(" ");

const buildCacheKey = (fen: string, payload: CloudEngineRequest, engineLabel: string, modeTag?: string) => {
  const normalizedFen = normalizeFen(fen);
  const modeTagValue = modeTag ?? "standard";
  const mode = payload.searchMode ?? "time";
  const targetDepth = payload.targetDepth ?? "";
  const movetimeMs = payload.movetimeMs ?? "";
  const threads = payload.threads ?? "";
  const hashMb = payload.hashMb ?? "";
  const skillLevel = payload.skillLevel ?? "";
  const profileId = payload.profileId ?? "";
  return [
    `fen:${normalizedFen}`,
    `engine:${engineLabel}`,
    `modeTag:${modeTagValue}`,
    `mode:${mode}`,
    `depth:${targetDepth}`,
    `movetime:${movetimeMs}`,
    `multipv:${payload.multiPv}`,
    `threads:${threads}`,
    `hash:${hashMb}`,
    `skill:${skillLevel}`,
    `profile:${profileId}`,
  ].join("|");
};

const hashCacheKey = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const attachDebugMeta = (payload: CloudEngineResponse, meta?: EngineDebugMeta | null) =>
  meta ? { ...payload, debug: meta } : payload;

const withCacheHeaders = (
  payload: CloudEngineResponse,
  status: "HIT" | "MISS" | "DEDUP",
  keyHash: string,
  meta?: EngineDebugMeta | null
) =>
  NextResponse.json(attachDebugMeta(payload, meta), {
    headers: {
      "X-Engine-Cache": status,
      "X-Engine-Cache-Key": keyHash,
    },
  });

const withErrorPayload = (message: string, status: number, meta?: EngineDebugMeta | null) =>
  NextResponse.json(meta ? { error: message, debug: meta } : { error: message }, { status });

const applyRequestId = (payload: CloudEngineResponse, requestId?: string | null) => {
  if (!requestId) return payload;
  return { ...payload, requestId, id: requestId };
};

const touchCacheEntry = (key: string, entry: CacheEntry) => {
  evalCache.delete(key);
  evalCache.set(key, entry);
};

const pruneCache = () => {
  while (evalCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = evalCache.keys().next().value;
    if (!oldestKey) return;
    evalCache.delete(oldestKey);
  }
};

const resolveCloudEngineUrl = (rawUrl: string | undefined): string | null => {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    return process.env.NODE_ENV === "development" ? DEFAULT_DEV_ENGINE_URL : null;
  }
  try {
    const url = new URL(trimmed);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (!normalizedPath || normalizedPath === "/") {
      url.pathname = "/engine/eval";
    } else if (normalizedPath === "/engine") {
      url.pathname = "/engine/eval";
    }
    return url.toString();
  } catch {
    return trimmed;
  }
};

let warnedEngineUrlConfig = false;
const warnEngineUrlIfNeeded = () => {
  if (warnedEngineUrlConfig) return;
  if (typeof process === "undefined" || process.env.NODE_ENV === "production") return;
  const raw = typeof CLOUD_ENGINE_URL === "string" ? CLOUD_ENGINE_URL.trim() : "";
  if (!raw) {
    console.warn("[engine/eval] CLOUD_ENGINE_URL is not set; upstream engine calls will fail.");
    warnedEngineUrlConfig = true;
    return;
  }
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
    if (isLocalhost && !parsed.port) {
      console.warn("[engine/eval] CLOUD_ENGINE_URL points to localhost without a port:", raw);
      warnedEngineUrlConfig = true;
      return;
    }
    if (!parsed.pathname || parsed.pathname === "/") {
      console.warn("[engine/eval] CLOUD_ENGINE_URL path looks unexpected (missing /engine/eval):", raw);
      warnedEngineUrlConfig = true;
    }
  } catch {
    if (!raw.includes("://")) {
      console.warn("[engine/eval] CLOUD_ENGINE_URL is not a valid URL (missing scheme?):", raw);
      warnedEngineUrlConfig = true;
    }
  }
};

const resolveEngineHostLabel = (engineUrl: string | null): string | null => {
  if (!engineUrl) return null;
  try {
    return new URL(engineUrl).hostname || null;
  } catch {
    const withoutScheme = engineUrl.replace(/^[a-z]+:\/\//i, "");
    const hostPort = withoutScheme.split(/[/?#]/)[0] ?? "";
    const hostOnly = hostPort.split("@").pop() ?? "";
    const hostname = hostOnly.split(":")[0] ?? "";
    return hostname || null;
  }
};

const resolveUpstreamStatusCode = (status: number | "error") => (status === "error" ? 502 : status);

warnEngineUrlIfNeeded();

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const isLiteMode = requestUrl.searchParams.get("mode") === "lite";
  const isExplicitDebug = requestUrl.searchParams.get("debug") === "1";
  const isDevEnv = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
  const debugEnabled = isExplicitDebug || isDevEnv;
  let payload: CloudEngineRequest;
  try {
    payload = (await request.json()) as CloudEngineRequest;
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const fen = payload?.fen;
  const requestId = payload?.requestId;
  const multiPv = Number(payload?.multiPv ?? NaN);
  const rawSearchMode = payload?.searchMode;
  const hasTargetDepth = Number.isFinite(Number(payload?.targetDepth ?? NaN));
  const searchMode: CloudEngineRequest["searchMode"] =
    rawSearchMode === "depth" || (!rawSearchMode && hasTargetDepth) ? "depth" : "time";
  const targetDepth =
    searchMode === "depth" && hasTargetDepth ? Math.max(1, Math.floor(Number(payload.targetDepth))) : undefined;
  const movetimeMs = Number(payload?.movetimeMs ?? NaN);
  const threads = Number.isFinite(Number(payload?.threads ?? NaN)) ? Number(payload?.threads) : undefined;
  const hashMb = Number.isFinite(Number(payload?.hashMb ?? NaN)) ? Number(payload?.hashMb) : undefined;
  const skillLevel = Number.isFinite(Number(payload?.skillLevel ?? NaN)) ? Number(payload?.skillLevel) : undefined;
  const profileId = payload?.profileId;
  const refine = payload?.refine === true;
  const refineTargetDepthRaw = Number(payload?.refineTargetDepth ?? NaN);
  const refineTargetDepth = Number.isFinite(refineTargetDepthRaw)
    ? Math.max(1, Math.floor(refineTargetDepthRaw))
    : undefined;
  const isRefineRequest = refine || Number.isFinite(refineTargetDepthRaw);

  if (
    !isNonEmptyString(fen) ||
    !Number.isFinite(multiPv) ||
    multiPv < 1 ||
    !isNonEmptyString(requestId) ||
    (searchMode === "depth" && !Number.isFinite(targetDepth) && !Number.isFinite(refineTargetDepthRaw)) ||
    (searchMode !== "depth" && (!Number.isFinite(movetimeMs) || movetimeMs <= 0))
  ) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const safeMultiPv = clampNumber(Math.floor(multiPv), 1, 4);
  const effectiveTargetDepth =
    searchMode === "depth"
      ? clampNumber(
          Math.floor(isRefineRequest ? (refineTargetDepth ?? targetDepth ?? FAST_DEPTH) : (targetDepth ?? FAST_DEPTH)),
          1,
          64
        )
      : undefined;
  const shouldFastPath = !isRefineRequest && searchMode === "depth" && (effectiveTargetDepth ?? 0) >= REFINE_DEPTH_MIN;
  const forwardSearchMode: CloudEngineRequest["searchMode"] = shouldFastPath ? "time" : searchMode;
  const forwardTargetDepth =
    forwardSearchMode === "depth"
      ? isRefineRequest
        ? clampNumber(effectiveTargetDepth ?? REFINE_DEPTH_MIN, REFINE_DEPTH_MIN, REFINE_DEPTH_MAX)
        : effectiveTargetDepth
      : undefined;
  const forwardMovetimeMs =
    forwardSearchMode === "time"
      ? shouldFastPath
        ? clampNumber(
            Number.isFinite(movetimeMs) && movetimeMs > 0 ? Math.floor(movetimeMs) : FAST_MOVETIME_MS,
            200,
            300
          )
        : clampNumber(
            Number.isFinite(movetimeMs) && movetimeMs > 0 ? Math.floor(movetimeMs) : FAST_MOVETIME_MS,
            150,
            5000
          )
      : undefined;
  let forwardPayload: CloudEngineRequest = {
    fen,
    movetimeMs: forwardMovetimeMs,
    multiPv: safeMultiPv,
    requestId,
    searchMode: forwardSearchMode,
    targetDepth: forwardTargetDepth,
    threads,
    hashMb,
    skillLevel,
    profileId,
  };

  if (isLiteMode) {
    forwardPayload = {
      fen,
      requestId,
      searchMode: "time",
      movetimeMs: LITE_MOVETIME_MS,
      multiPv: 1,
      threads: LITE_THREADS,
      hashMb: LITE_HASH_MB,
      skillLevel,
      profileId: "light",
    };
  }

  const cacheKey = buildCacheKey(fen, forwardPayload, ENGINE_DISPLAY_NAME, isLiteMode ? "lite" : "standard");
  const cacheKeyHash = hashCacheKey(cacheKey);
  const now = Date.now();
  const engineUrl = resolveCloudEngineUrl(CLOUD_ENGINE_URL);
  const engineHostLabel = resolveEngineHostLabel(engineUrl);
  const buildDebugMeta = (meta: Omit<EngineDebugMeta, "engineHost">): EngineDebugMeta | null => {
    if (!debugEnabled) return null;
    return {
      ...meta,
      engineHost: engineHostLabel ?? undefined,
    };
  };
  const cached = evalCache.get(cacheKey);
  let cachedPayload: CloudEngineResponse | null = null;
  if (cached) {
    const age = now - cached.fetchedAt;
    if (age < MIN_REEVAL_MS || age < CACHE_TTL_MS) {
      touchCacheEntry(cacheKey, cached);
      cachedPayload = cached.payload;
      if (!debugEnabled) {
        return withCacheHeaders(applyRequestId(cached.payload, requestId), "HIT", cacheKeyHash);
      }
    } else {
      evalCache.delete(cacheKey);
    }
  }

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    const result = await inflight;
    if (result.ok) {
      return withCacheHeaders(
        applyRequestId(result.payload, requestId),
        "DEDUP",
        cacheKeyHash,
        buildDebugMeta({
          source: "upstream",
          cacheHit: false,
          upstreamOk: true,
          upstreamStatus: result.status,
        })
      );
    }
    if (cachedPayload) {
      return withCacheHeaders(
        applyRequestId(cachedPayload, requestId),
        "HIT",
        cacheKeyHash,
        buildDebugMeta({
          source: "cache",
          cacheHit: true,
          upstreamOk: false,
          upstreamStatus: result.status,
        })
      );
    }
    return withErrorPayload(
      result.errorMessage,
      resolveUpstreamStatusCode(result.status),
      buildDebugMeta({
        source: "upstream",
        cacheHit: false,
        upstreamOk: false,
        upstreamStatus: result.status,
      })
    );
  }

  const forwardToExternal = async (): Promise<UpstreamResult> => {
    if (!engineUrl) {
      return { ok: false, status: "error", errorMessage: "Cloud engine URL not configured" };
    }
    try {
      const externalResponse = await fetch(engineUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forwardPayload),
      });
      if (!externalResponse.ok) {
        const errorPayload = await externalResponse.json().catch(() => ({}));
        const errorMessage =
          errorPayload?.error ?? `External engine HTTP ${externalResponse.status}: Unknown error from external cloud backend`;
        console.warn("[ENGINE CORE] (cloud api fallback) External call failed", {
          requestId,
          fenPreview: fen.slice(0, 60),
          status: externalResponse.status,
          error: errorMessage,
        });
        return { ok: false, status: externalResponse.status, errorMessage };
      }
      const externalJson = (await externalResponse.json()) as CloudEngineResponse;
      if (!externalJson || !Array.isArray(externalJson.lines)) {
        return { ok: false, status: "error", errorMessage: "External engine returned invalid payload" };
      }
      if (DEBUG_ENGINE_LOGS) {
        console.log("[ENGINE CORE] (cloud api → external) Forwarded response", {
          requestId,
          fenPreview: fen.slice(0, 60),
          backend: externalJson.backend,
          searchMode: forwardPayload.searchMode,
          targetDepth: forwardPayload.targetDepth,
          depth: externalJson.lines[0]?.depth,
          scoreCp: externalJson.lines[0]?.scoreCp,
        });
      }
      return { ok: true, payload: externalJson, status: externalResponse.status };
    } catch (error) {
      console.warn("[ENGINE CORE] (cloud api fallback) External call failed", {
        requestId,
        fenPreview: fen.slice(0, 60),
        error: error instanceof Error ? error.message : String(error ?? "Unknown error"),
      });
      return {
        ok: false,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error ?? "Unknown error"),
      };
    }
  };

  const requestPromise = forwardToExternal();
  inflightRequests.set(cacheKey, requestPromise);
  try {
    const result = await requestPromise;
    if (result.ok) {
      evalCache.set(cacheKey, { payload: result.payload, fetchedAt: Date.now() });
      pruneCache();
      if (cachedPayload) {
        return withCacheHeaders(
          applyRequestId(cachedPayload, requestId),
          "HIT",
          cacheKeyHash,
          buildDebugMeta({
            source: "cache",
            cacheHit: true,
            upstreamOk: true,
            upstreamStatus: result.status,
          })
        );
      }
      return withCacheHeaders(
        applyRequestId(result.payload, requestId),
        "MISS",
        cacheKeyHash,
        buildDebugMeta({
          source: "upstream",
          cacheHit: false,
          upstreamOk: true,
          upstreamStatus: result.status,
        })
      );
    }
    if (cachedPayload) {
      return withCacheHeaders(
        applyRequestId(cachedPayload, requestId),
        "HIT",
        cacheKeyHash,
        buildDebugMeta({
          source: "cache",
          cacheHit: true,
          upstreamOk: false,
          upstreamStatus: result.status,
        })
      );
    }
    return withErrorPayload(
      result.errorMessage,
      resolveUpstreamStatusCode(result.status),
      buildDebugMeta({
        source: "upstream",
        cacheHit: false,
        upstreamOk: false,
        upstreamStatus: result.status,
      })
    );
  } finally {
    inflightRequests.delete(cacheKey);
  }
}
