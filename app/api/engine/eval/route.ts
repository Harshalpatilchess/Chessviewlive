import { NextResponse } from "next/server";
import { CLOUD_ENGINE_URL, type CloudEngineRequest, type CloudEngineResponse } from "@/lib/engine/config";

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const BACKEND_ID: CloudEngineResponse["backend"] = "cloud-nnue";
const FAST_DEPTH = 12;
const REFINE_DEPTH_MIN = 20;
const REFINE_DEPTH_MAX = 30;
const DEBUG_ENGINE_LOGS = typeof process !== "undefined" && process.env.DEBUG_ENGINE_LOGS === "true";
const FAST_MOVETIME_MS = (() => {
  const raw = typeof process !== "undefined" ? process.env.ENGINE_FAST_MOVETIME_MS : undefined;
  const parsed = typeof raw === "string" ? Number(raw) : NaN;
  const resolved = Number.isFinite(parsed) ? Math.floor(parsed) : 250;
  return clampNumber(resolved, 200, 300);
})();

export async function POST(request: Request) {
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
  const forwardPayload: CloudEngineRequest = {
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

  const forwardToExternal = async (): Promise<CloudEngineResponse | null> => {
    if (!CLOUD_ENGINE_URL) return null;
    try {
      const externalResponse = await fetch(CLOUD_ENGINE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forwardPayload),
      });
      if (!externalResponse.ok) {
        const errorPayload = await externalResponse.json().catch(() => ({}));
        throw new Error(
          `External engine HTTP ${externalResponse.status}: ${errorPayload?.error ?? "Unknown error from external cloud backend"}`
        );
      }
      const externalJson = (await externalResponse.json()) as CloudEngineResponse;
      if (!externalJson || !Array.isArray(externalJson.lines)) {
        throw new Error("External engine returned invalid payload");
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
      return externalJson;
    } catch (error) {
      console.warn("[ENGINE CORE] (cloud api fallback) External call failed", {
        requestId,
        fenPreview: fen.slice(0, 60),
        error: error instanceof Error ? error.message : String(error ?? "Unknown error"),
      });
      return null;
    }
  };

  const forwarded = await forwardToExternal();
  if (forwarded) {
    return NextResponse.json(forwarded);
  }
  const sideToMove = fen.split(/\s+/)[1] === "b" ? "b" : "w";
  const cpSign = sideToMove === "b" ? -1 : 1;
  const pvCatalog: string[][] =
    sideToMove === "w"
      ? [
          ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"],
          ["d2d4", "d7d5", "c2c4", "c7c6", "g1f3"],
          ["c2c4", "e7e6", "b1c3", "d7d5", "d2d4"],
        ]
      : [
          ["e7e5", "g1f3", "b8c6", "f1c4", "g8f6"],
          ["c7c5", "g1f3", "d7d6", "d2d4", "c5d4"],
          ["e7e6", "d2d4", "d7d5", "c2c4", "g8f6"],
        ];

  const lines = Array.from({ length: safeMultiPv }, (_, idx) => {
    const baseScore = Math.max(10, 34 - idx * 8);
    const depth = 20 + idx % 3;
    const selDepth = depth + 4;
    const pvMoves = pvCatalog[idx] ?? pvCatalog[pvCatalog.length - 1];
    return {
      multipv: idx + 1,
      scoreCp: cpSign * baseScore,
      depth,
      selDepth,
      pvMoves,
      nodes: 1_000_000 + idx * 80_000,
      nps: 1_400_000 + idx * 50_000,
    } satisfies CloudEngineResponse["lines"][number];
  });

  const response: CloudEngineResponse = {
    id: requestId,
    requestId,
    backend: BACKEND_ID,
    lines,
    nodes: lines.reduce((sum, line) => sum + (line.nodes ?? 0), 0),
    nps: 1_500_000 + safeMultiPv * 50_000,
    engineName: "Stockfish (cloud stub)",
  };

  if (DEBUG_ENGINE_LOGS) {
    console.log("[ENGINE CORE] (cloud api) Responding", {
      requestId,
      fenPreview: fen.slice(0, 60),
      movetimeMs: forwardPayload.movetimeMs,
      searchMode: forwardPayload.searchMode,
      targetDepth: forwardPayload.targetDepth,
      multiPv: safeMultiPv,
      depth: lines[0]?.depth,
      scoreCp: lines[0]?.scoreCp,
    });
  }

  return NextResponse.json(response);
}
