"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CURRENT_ENGINE_CONFIG,
  ANALYSIS_QUALITY_PASSES_MS,
  DEFAULT_ENGINE_PROFILE_ID,
  type CloudEngineLine,
  type CloudEngineRequest,
  type CloudEngineResponse,
  type EngineBackend,
  type EngineProfileConfig,
  type EngineProfileId,
  getEngineProfileConfig,
  isEngineProfileId,
} from "./config";
import {
  getSavedEngineMultiPv,
  getSavedEngineProfileId,
  saveEngineMultiPv,
  saveEngineProfileId,
} from "./persistence";
import type { StockfishEval, StockfishLine } from "./useStockfishEvaluation";

type UseCloudEngineEvaluationOptions = {
  enabled?: boolean;
  multiPv?: number;
  depthIndex?: number;
  profileId?: EngineProfileId;
  targetDepth?: number;
};

const ENGINE_CONFIG = CURRENT_ENGINE_CONFIG;
const DEFAULT_PROFILE_CONFIG = getEngineProfileConfig(DEFAULT_ENGINE_PROFILE_ID);
const CLOUD_ENGINE_NAME =
  (ENGINE_CONFIG.backends?.cloud as { engineName?: string } | undefined)?.engineName ?? "Stockfish (cloud)";
const ENGINE_BACKEND: EngineBackend = "cloud";
const REFINE_TTL_MS = 20_000;

type CachedEvalPayload = {
  eval: StockfishEval;
  bestLines: StockfishLine[];
  engineName?: string;
  depth?: number;
  at: number;
  movetimeMs?: number;
};

type CachedFenEval = {
  byMovetimeMs?: Map<number, CachedEvalPayload>;
};

const fenEvalCache = new Map<string, CachedFenEval>();

const getEvalComparable = (value: StockfishEval): { kind: "cp"; value: number } | { kind: "mate"; value: number } | null => {
  if (!value) return null;
  if (typeof value.mate === "number" && Number.isFinite(value.mate)) return { kind: "mate", value: value.mate };
  if (typeof value.cp === "number" && Number.isFinite(value.cp)) return { kind: "cp", value: value.cp };
  return null;
};

const getPvPrefix = (line?: StockfishLine | null, plies: number = 4): string | null => {
  const pv = typeof line?.pv === "string" ? line.pv.trim() : "";
  if (!pv) return null;
  const tokens = pv.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.slice(0, Math.max(1, Math.floor(plies))).join(" ");
};

const clampLineCount = (value?: number | null) => {
  const fallback = 1;
  const normalized = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(3, Math.round(normalized)));
};

const clampDepthIndex = (value: number | undefined, steps: number[]): number => {
  const maxIndex = Math.max(steps.length - 1, 0);
  const normalized = Number.isFinite(value ?? NaN) ? Math.round(value as number) : 0;
  return Math.max(0, Math.min(maxIndex, normalized));
};

const resolveDepthSteps = (profile: EngineProfileConfig): number[] => {
  const profileSteps = Array.isArray(profile.depthSteps) ? profile.depthSteps.filter(step => Number.isFinite(step)) : [];
  const fallbackSteps =
    (Array.isArray(ENGINE_CONFIG.defaults?.depthSteps) && ENGINE_CONFIG.defaults?.depthSteps?.length
      ? ENGINE_CONFIG.defaults.depthSteps
      : []) || DEFAULT_PROFILE_CONFIG.depthSteps;
  return profileSteps.length ? profileSteps : fallbackSteps;
};

const mapCloudLineToStockfishLine = (line: CloudEngineLine): StockfishLine => {
  const multipv = Number.isFinite(line?.multipv) ? Number(line.multipv) : 1;
  const cp = Number.isFinite(line?.scoreCp ?? NaN) ? Number(line.scoreCp) : undefined;
  const mate = Number.isFinite(line?.scoreMate ?? NaN) ? Number(line.scoreMate) : undefined;
  const depth = Number.isFinite(line?.depth ?? NaN) ? Number(line.depth) : undefined;
  const pv = Array.isArray(line?.pvMoves) ? line.pvMoves.join(" ") : "";

  return { multipv, cp, mate, depth, pv };
};

const deriveEvalFromCloudLines = (lines: CloudEngineLine[]): StockfishEval => {
  if (!Array.isArray(lines) || !lines.length) return null;
  const [primary] = lines;
  if (typeof primary?.scoreMate === "number") return { mate: primary.scoreMate };
  if (typeof primary?.scoreCp === "number") return { cp: primary.scoreCp };
  return null;
};

export default function useCloudEngineEvaluation(
  fen: string | null,
  options: UseCloudEngineEvaluationOptions = {}
) {
  const enabled = options.enabled ?? true;
  const initialProfileId = (() => {
    const preferred = options.profileId ?? getSavedEngineProfileId();
    if (preferred && isEngineProfileId(preferred)) return preferred;
    return DEFAULT_ENGINE_PROFILE_ID;
  })();
  const initialProfileConfig = getEngineProfileConfig(initialProfileId);
  const initialDepthSteps = resolveDepthSteps(initialProfileConfig);

  const [activeProfileId, setActiveProfileIdState] = useState<EngineProfileId>(initialProfileId);
  const [depthIndex, setDepthIndexState] = useState<number>(() =>
    clampDepthIndex(options.depthIndex ?? initialProfileConfig.defaultDepthIndex, initialDepthSteps)
  );
  const [multiPv, setMultiPvState] = useState<number>(() =>
    clampLineCount(options.multiPv ?? getSavedEngineMultiPv() ?? 1)
  );
  const [evalResult, setEvalResult] = useState<StockfishEval>(null);
  const [bestLines, setBestLines] = useState<StockfishLine[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [engineName, setEngineName] = useState<string | undefined>(CLOUD_ENGINE_NAME);
  const [evaluatedFen, setEvaluatedFen] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const appliedBudgetMsRef = useRef<number>(0);
  const controllersRef = useRef<{
    controller: AbortController | null;
  }>({ controller: null });
  const lastFenRef = useRef<string | null>(null);
  const lastEvalKeyRef = useRef<string | null>(null);

  const activeProfileConfig = useMemo(
    () => getEngineProfileConfig(activeProfileId),
    [activeProfileId]
  );
  const depthSteps = useMemo(() => resolveDepthSteps(activeProfileConfig), [activeProfileConfig]);
  const effectiveDepthIndex = clampDepthIndex(depthIndex, depthSteps);
  const targetDepth = options.targetDepth ?? depthSteps[effectiveDepthIndex];
  const effectiveMultiPv = clampLineCount(multiPv);

  useEffect(() => {
    setDepthIndexState(prev => clampDepthIndex(prev, depthSteps));
    setMultiPvState(prev => clampLineCount(prev));
  }, [depthSteps]);

  useEffect(() => {
    if (options.profileId && isEngineProfileId(options.profileId) && options.profileId !== activeProfileId) {
      const profile = getEngineProfileConfig(options.profileId);
      const profileSteps = resolveDepthSteps(profile);
      setActiveProfileIdState(profile.id);
      setDepthIndexState(clampDepthIndex(profile.defaultDepthIndex, profileSteps));
    }
  }, [activeProfileId, options.profileId]);

  useEffect(() => {
    if (!enabled || !fen) {
      controllersRef.current.controller?.abort();
      controllersRef.current = { controller: null };
      setIsEvaluating(false);
      setLastError(null);
      runIdRef.current = null;
      return;
    }

    controllersRef.current.controller?.abort();
    const controller = new AbortController();
    controllersRef.current.controller = controller;
    appliedBudgetMsRef.current = 0;

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    runIdRef.current = runId;
    setLastError(null);

    void targetDepth;
    const cacheKey = `${fen}::${effectiveMultiPv}::${activeProfileId}`;
    const isNewEvalKey = cacheKey !== lastEvalKeyRef.current;
    const cached = fenEvalCache.get(cacheKey);
    lastFenRef.current = fen;
    lastEvalKeyRef.current = cacheKey;

    const cachedByMs = cached?.byMovetimeMs
      ? Array.from(cached.byMovetimeMs.entries()).sort((a, b) => b[0] - a[0])
      : [];
    const bestCachedMs = cachedByMs[0]?.[0] ?? 0;
    const bestCached = cachedByMs[0]?.[1];
    if (bestCached) {
      setEngineName(bestCached.engineName ?? CLOUD_ENGINE_NAME);
      setEvalResult(bestCached.eval);
      setBestLines(bestCached.bestLines);
      setEvaluatedFen(fen);
      appliedBudgetMsRef.current = bestCachedMs;
    } else if (isNewEvalKey) {
      // Keep the last known evaluation/lines visible until the new FEN result arrives.
      setEngineName(prev => prev ?? CLOUD_ENGINE_NAME);
    }

    setIsEvaluating(true);

    const payloadBase: Omit<CloudEngineRequest, "requestId"> = {
      fen,
      multiPv: effectiveMultiPv,
      searchMode: "time",
      threads: activeProfileConfig.threads ?? ENGINE_CONFIG.defaults?.threads,
      hashMb: activeProfileConfig.hashMb ?? ENGINE_CONFIG.defaults?.hashMb,
      skillLevel: activeProfileConfig.skillLevel,
      profileId: activeProfileId,
    };

    const storePassResult = (movetimeMs: number, json: CloudEngineResponse) => {
      const lines = Array.isArray(json.lines) ? json.lines : [];
      const mappedLines = lines.map(mapCloudLineToStockfishLine).sort((a, b) => a.multipv - b.multipv);
      const payload: CachedEvalPayload = {
        engineName: json.engineName ?? CLOUD_ENGINE_NAME,
        eval: deriveEvalFromCloudLines(lines),
        bestLines: mappedLines,
        depth: typeof lines[0]?.depth === "number" ? lines[0].depth : undefined,
        at: Date.now(),
        movetimeMs,
      };
      const entry: CachedFenEval = fenEvalCache.get(cacheKey) ?? {};
      entry.byMovetimeMs = entry.byMovetimeMs ?? new Map();
      entry.byMovetimeMs.set(movetimeMs, payload);
      fenEvalCache.set(cacheKey, entry);
      return payload;
    };

    const shouldSkipPass = (movetimeMs: number) => {
      const now = Date.now();
      const entry = fenEvalCache.get(cacheKey);
      const byMs = entry?.byMovetimeMs;
      if (!byMs || byMs.size === 0) return false;
      if (activeProfileId === "pro") {
        const existing = byMs.get(movetimeMs);
        return Boolean(existing && now - existing.at < REFINE_TTL_MS);
      }
      const fresh = Array.from(byMs.entries())
        .filter(([, payload]) => now - payload.at < REFINE_TTL_MS)
        .sort((a, b) => b[0] - a[0]);
      const bestMs = fresh[0]?.[0];
      return typeof bestMs === "number" && bestMs >= movetimeMs;
    };

    const analysisQuality = activeProfileId;
    const passes = ANALYSIS_QUALITY_PASSES_MS[analysisQuality] ?? ANALYSIS_QUALITY_PASSES_MS.standard;
    const allowEarlyStop = analysisQuality === "light" || analysisQuality === "standard";

    const runPasses = async () => {
      try {
        let previousEval: StockfishEval | null = null;
        let previousPvPrefix: string | null = null;

        for (const movetimeMs of passes) {
          if (controller.signal.aborted || runIdRef.current !== runId || lastFenRef.current !== fen) return;
          if (shouldSkipPass(movetimeMs)) continue;

          const requestId = `${runId}-t${movetimeMs}`;
          const payload: CloudEngineRequest = { ...payloadBase, requestId, movetimeMs };

          const response = await fetch("/api/engine/eval", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(
              `Cloud eval HTTP ${response.status}: ${errorPayload?.error ?? "Unknown error from cloud backend"}`
            );
          }
          const json = (await response.json()) as CloudEngineResponse;
          if (controller.signal.aborted || runIdRef.current !== runId || lastFenRef.current !== fen) return;

          const cachedPayload = storePassResult(movetimeMs, json);
          if (movetimeMs >= appliedBudgetMsRef.current) {
            appliedBudgetMsRef.current = movetimeMs;
            setEngineName(cachedPayload.engineName ?? CLOUD_ENGINE_NAME);
            setEvalResult(cachedPayload.eval);
            setBestLines(cachedPayload.bestLines);
            setEvaluatedFen(fen);
          }

          if (allowEarlyStop) {
            const currentPvPrefix = getPvPrefix(cachedPayload.bestLines[0] ?? null, 4);
            const currentEval = cachedPayload.eval;
            const prevScore = getEvalComparable(previousEval);
            const nextScore = getEvalComparable(currentEval);

            const pvMatches =
              typeof currentPvPrefix === "string" &&
              typeof previousPvPrefix === "string" &&
              currentPvPrefix === previousPvPrefix;

            const scoreStable = (() => {
              if (!prevScore || !nextScore) return false;
              if (prevScore.kind !== nextScore.kind) return false;
              if (prevScore.kind === "mate") return prevScore.value === nextScore.value;
              return Math.abs(nextScore.value - prevScore.value) <= 10;
            })();

            if (pvMatches && scoreStable) {
              break;
            }

            previousEval = currentEval;
            previousPvPrefix = currentPvPrefix;
          } else if (analysisQuality === "pro") {
            // Pro explicitly bypasses stability checks: always run full pass schedule unless aborted.
          }
        }
        setIsEvaluating(false);
      } catch (error) {
        if (controller.signal.aborted || runIdRef.current !== runId || lastFenRef.current !== fen) return;
        setLastError(error instanceof Error ? error.message : String(error ?? "Unknown error"));
        setIsEvaluating(false);
      }
    };

    runPasses();

    return () => {
      controller.abort();
    };
  }, [
    activeProfileConfig.hashMb,
    activeProfileConfig.skillLevel,
    activeProfileConfig.threads,
    activeProfileId,
    effectiveMultiPv,
    enabled,
    fen,
    targetDepth,
  ]);

  const setActiveProfileId = (next: EngineProfileId) => {
    if (!isEngineProfileId(next)) return;
    const profile = getEngineProfileConfig(next);
    const profileSteps = resolveDepthSteps(profile);
    setActiveProfileIdState(profile.id);
    setDepthIndexState(clampDepthIndex(profile.defaultDepthIndex, profileSteps));
    saveEngineProfileId(profile.id);
  };

  const setDepthIndex = (value: number) => {
    setDepthIndexState(clampDepthIndex(value, depthSteps));
  };

  const setMultiPv = (value: number) => {
    const next = clampLineCount(value);
    setMultiPvState(next);
    saveEngineMultiPv(next);
  };

  return {
    eval: evalResult,
    bestLines,
    isEvaluating,
    isUpdating: Boolean(enabled && fen && isEvaluating && evaluatedFen !== fen),
    evaluatedFen,
    engineName,
    engineBackend: ENGINE_BACKEND,
    setEngineBackend: undefined,
    activeProfileId,
    activeProfileConfig,
    multiPv: effectiveMultiPv,
    targetDepth,
    depthIndex: effectiveDepthIndex,
    depthSteps,
    setDepthIndex,
    setMultiPv,
    setActiveProfileId,
    lastError,
    lastFen: lastFenRef.current,
  };
}
